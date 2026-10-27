// Copyright 2026 The Pomelo Authors. All rights reserved.
// Licensed under the Apache License, Version 2.0 that can be found in the
// LICENSE file of this source tree.

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

// DevTool bootstrap for the dev channel.
//
// Everything is resolved at RUNTIME via NSClassFromString because the two
// Podfiles install different pod graphs:
//   host/ios/Podfile          → LynxService/Devtool (+ LynxDevtool, DebugRouter)
//   host/ios/release/Podfile  → no Devtool subspec at all
// A plain #import would break the release build (headers absent), so this
// file compiles in both graphs and becomes a no-op when the pods are missing.
//
// What this enables (official integrate-lynx-devtool guide):
//   1. DevToolSettings bootstrap development defaults
//   2. LynxServiceDevToolProtocol.enableAllSessions — required for the
//      DevTool desktop / debug-router-connector to attach to any session
//   3. LynxEnv.devtoolEnabled — element inspection + JS debugging master switch
//   4. DebugRouter socket server on device (8901..8920, INADDR_ANY) so the
//      connector can reach the device over LAN without usbmuxd
//
// `dispatch_once` guards the whole chain; callers may invoke it any time.

static void PomeloEnableDevTool(void) {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    // (1) Bootstrap defaults — the Lynx public devtool wrapper.
    Class settingsClass = NSClassFromString(@"DevToolSettings");
    if (settingsClass == nil) {
      NSLog(@"[pomelo-devtool] DevToolSettings class absent — Devtool pod not installed (release channel?), skipping");
      return;
    }
    id settings = ((id (*)(id, SEL)) objc_msgSend)(settingsClass, NSSelectorFromString(@"sharedInstance"));
    id bootstrap = ((id (*)(id, SEL)) objc_msgSend)(settings, NSSelectorFromString(@"bootstrap"));
    ((void (*)(id, SEL)) objc_msgSend)(bootstrap, NSSelectorFromString(@"applyDevelopmentDefaultsIfUnset"));

    // (2) enableAllSessions on the DevTool service (required for desktop
    //     connection). Official macro: LynxService(LynxServiceDevToolProtocol)
    //     which expands to
    //     [LynxServices getInstanceWithProtocol:@protocol(LynxServiceDevToolProtocol)].
    //     Resolved at runtime so the file also compiles in the release graph.
    SEL enableSel = NSSelectorFromString(@"enableAllSessions");
    BOOL sessionsEnabled = NO;

    Class servicesClass = NSClassFromString(@"LynxServices");
    Protocol *devtoolProtocol = objc_getProtocol("LynxServiceDevToolProtocol");
    if (servicesClass != nil && devtoolProtocol != nil) {
      SEL getInstanceSel = NSSelectorFromString(@"getInstanceWithProtocol:");
      id service = ((id (*)(id, SEL, Protocol *)) objc_msgSend)(servicesClass, getInstanceSel, devtoolProtocol);
      if (service != nil && [service respondsToSelector:enableSel]) {
        ((void (*)(id, SEL)) objc_msgSend)(service, enableSel);
        sessionsEnabled = YES;
      }
    }

    // Fallback: DebugRouter instance itself also responds to enableAllSessions
    // (LynxDevToolService.initializeDebugRouterSessions routes through it).
    Class debugRouterClass = NSClassFromString(@"DebugRouter");
    if (!sessionsEnabled && debugRouterClass != nil) {
      id router = ((id (*)(id, SEL)) objc_msgSend)(debugRouterClass, NSSelectorFromString(@"instance"));
      if (router != nil && [router respondsToSelector:enableSel]) {
        ((void (*)(id, SEL)) objc_msgSend)(router, enableSel);
        sessionsEnabled = YES;
      }
    }

    // (3) Master switches on LynxEnv. LynxEnv exists in both pod graphs;
    //     devtoolEnabled / logBoxEnabled are settable BOOL properties.
    Class envClass = NSClassFromString(@"LynxEnv");
    if (envClass != nil) {
      id env = ((id (*)(id, SEL)) objc_msgSend)(envClass, NSSelectorFromString(@"sharedInstance"));
      if (env != nil) {
        ((void (*)(id, SEL, BOOL)) objc_msgSend)(env, NSSelectorFromString(@"setDevtoolEnabled:"), YES);
        ((void (*)(id, SEL, BOOL)) objc_msgSend)(env, NSSelectorFromString(@"setLogBoxEnabled:"), YES);
      }
    }

    // (4) Make sure the DebugRouter core is instantiated: creating the
    //     singleton starts the socket server (8901..8920) when the
    //     MessageTransceiverEnable subspec is linked and the debug channel
    //     is enabled. This mirrors the official iOS README
    //     (`[DebugRouter instance]` in didFinishLaunchingWithOptions).
    if (debugRouterClass != nil) {
      ((void (*)(id, SEL)) objc_msgSend)(debugRouterClass, NSSelectorFromString(@"instance"));
      NSLog(@"[pomelo-devtool] DebugRouter instantiated — device-side debug socket expected on 8901..8920");
    } else {
      NSLog(@"[pomelo-devtool] DebugRouter class absent — skipping router init");
    }

    // (5) WS reverse-tunnel: when the phone and the dev machine are not on
    //     the same LAN (e.g. phone at the office, container at home), the
    //     device dials out to a room-based WS relay instead of listening.
    //     The URL comes from the same prefs store the settings page writes
    //     (`debug_tunnel_ws_url`, suite "pomelo_prefs") — JS and native share
    //     the underlying UserDefaults suite. Schema format per the official
    //     DebugRouter handler: "lynx://remote_debug_lynx/enable?url=..&room=.."
    //     (DebugRouterCore::HandleSchema parses query params url + room).
    NSString *tunnelUrl = [[NSUserDefaults alloc] initWithSuiteName:@"pomelo_prefs"] ?
                          [[[NSUserDefaults alloc] initWithSuiteName:@"pomelo_prefs"] stringForKey:@"debug_tunnel_ws_url"] : nil;
    if ([tunnelUrl isKindOfClass:[NSString class]] && tunnelUrl.length > 0 &&
        ([tunnelUrl hasPrefix:@"ws://"] || [tunnelUrl hasPrefix:@"wss://"])) {
      NSString *room = @"pomelo-lynx";  // room name the connector listens on
      // Percent-encode so ws://1.2.3.4:21783 survives as a query param.
      NSString *encodedUrl = [tunnelUrl stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet URLQueryAllowedCharacterSet]];
      NSString *schema = [NSString stringWithFormat:@"lynx://remote_debug_lynx/enable?url=%@&room=%@", encodedUrl, room];
      id router = ((id (*)(id, SEL)) objc_msgSend)(debugRouterClass, NSSelectorFromString(@"instance"));
      SEL handleSel = NSSelectorFromString(@"handleSchema:");
      if (router != nil && [router respondsToSelector:handleSel]) {
        BOOL handled = ((BOOL (*)(id, SEL, NSString *)) objc_msgSend)(router, handleSel, schema);
        NSLog(@"[pomelo-devtool] tunnel schema handled=%d url=%@ room=%@", handled, tunnelUrl, room);
      } else {
        NSLog(@"[pomelo-devtool] tunnel requested but handleSchema unavailable — DebugRouter too old?");
      }
    }

    NSLog(@"[pomelo-devtool] dev channel bootstrap done (allSessions=%d)", sessionsEnabled);
  });
}

__attribute__((constructor)) static void PomeloDevToolBootCtor(void) {
  // Runs after ObjC classes from all linked static libs are registered, and
  // before application(_:didFinishLaunchingWithOptions:) touches LynxEnv.
  // DevTool activation must precede the first LynxView creation so the
  // inspector can attach from the very first session.
  PomeloEnableDevTool();
}

// Expose an ObjC-visible entry so Swift (or tests) can re-run safely.
void PomeloEnsureDevToolEnabled(void) {
  PomeloEnableDevTool();
}
