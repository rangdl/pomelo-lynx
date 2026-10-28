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
//   5. WS reverse tunnel: the device dials out to a room-based relay, so a
//      phone on another network can still be debugged
//
// Steps 1–4 are idempotent and retried once from AppDelegate after
// `LynxEnv.sharedInstance()` (a constructor can run before the lazy Lynx
// registrations exist). Step 5 is separate: it reads the prefs written by the
// settings page and can be re-run from JS/foreground without restarting.

// Implemented by LogStore.swift (`@_cdecl`) so the ObjC side can write into
// the same in-app log ring/file that the JS LogsPage reads.
extern void PomeloLogInfo(const char *tag, const char *message);

static void PomeloTunnelLog(NSString *message) {
  PomeloLogInfo("devtool", message.UTF8String);
}

// MARK: - Shared tunnel state (read by PomeloDebugTunnelModule.swift)

static NSMutableDictionary *gTunnelStatus = nil;
static NSObject *gTunnelLock = nil;

static void PomeloTunnelInit(void) {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    gTunnelStatus = [NSMutableDictionary dictionary];
    gTunnelLock = [NSObject new];
  });
}

static void PomeloTunnelSet(NSString *key, id value) {
  PomeloTunnelInit();
  @synchronized (gTunnelLock) {
    gTunnelStatus[key] = value ?: @"";
  }
}

static NSDictionary *PomeloTunnelSnapshot(void) {
  PomeloTunnelInit();
  @synchronized (gTunnelLock) {
    return [gTunnelStatus copy];
  }
}

// MARK: - DebugRouter accessors

static id PomeloDebugRouterInstance(void) {
  Class cls = NSClassFromString(@"DebugRouter");
  if (cls == nil) return nil;
  SEL sel = NSSelectorFromString(@"instance");
  if (![cls respondsToSelector:sel]) return nil;
  return ((id (*)(id, SEL)) objc_msgSend)(cls, sel);
}

// MARK: - Tunnel lifecycle (constructor, AppDelegate, JS and foreground)

/**
 * Read `debug_tunnel_ws_url` from the shared prefs suite and ask DebugRouter to
 * dial the relay. Safe to call repeatedly: DebugRouter skips a duplicate
 * connect when the same room/url is already connecting/connected.
 *
 * Callable from JS (`PomeloDebugTunnel.reconnect`) and from sceneDidBecomeActive
 * so a socket suspended in the background is re-established without a relaunch.
 */
static void PomeloDebugTunnelConnectInternal(BOOL force) {
  NSString *room = @"pomelo-lynx";
  NSUserDefaults *prefs = [[NSUserDefaults alloc] initWithSuiteName:@"pomelo_prefs"];
  NSString *tunnelUrl = prefs ? [prefs stringForKey:@"debug_tunnel_ws_url"] : nil;
  NSString *prevUrl = PomeloTunnelSnapshot()[@"url"];

  PomeloTunnelSet(@"url", tunnelUrl ?: @"");
  PomeloTunnelSet(@"room", room);

  if (![tunnelUrl isKindOfClass:[NSString class]] || tunnelUrl.length == 0 ||
      (![tunnelUrl hasPrefix:@"ws://"] && ![tunnelUrl hasPrefix:@"wss://"])) {
    PomeloTunnelSet(@"last_error", @"");
    PomeloTunnelLog(@"tunnel not configured");
    return;
  }

  // didFinishLaunching and sceneDidBecomeActive both call us. Re-connecting a
  // live socket tears down the handshake mid-flight (Register without JoinRoom),
  // so bail out unless the saved target actually changed.
  if (!force && [prevUrl isEqualToString:tunnelUrl]) {
    id existing = PomeloDebugRouterInstance();
    SEL stateSel = NSSelectorFromString(@"connection_state");
    if (existing != nil && [existing respondsToSelector:stateSel]) {
      int state = ((int (*)(id, SEL)) objc_msgSend)(existing, stateSel);
      // Public NS_ENUM: DISCONNECTED=0, CONNECTING=1, CONNECTED=2.
      if (state == 1 || state == 2) {  // CONNECTING / CONNECTED
        PomeloTunnelLog(@"tunnel already connecting/connected; skip");
        return;
      }
    }
  }

  PomeloTunnelSet(@"attempted", @NO);
  PomeloTunnelSet(@"handled", @NO);
  PomeloTunnelSet(@"last_event", @"connecting");

  id router = PomeloDebugRouterInstance();
  SEL handleSel = NSSelectorFromString(@"handleSchema:");
  if (router == nil || ![router respondsToSelector:handleSel]) {
    PomeloTunnelSet(@"last_error", @"DebugRouter.handleSchema unavailable");
    PomeloTunnelLog(@"tunnel requested but DebugRouter.handleSchema unavailable");
    return;
  }

  NSString *encodedUrl = [tunnelUrl stringByAddingPercentEncodingWithAllowedCharacters:
                                          [NSCharacterSet URLQueryAllowedCharacterSet]];
  NSString *schema = [NSString stringWithFormat:
                                   @"lynx://remote_debug_lynx/enable?url=%@&room=%@",
                                   encodedUrl, room];
  BOOL handled = ((BOOL (*)(id, SEL, NSString *)) objc_msgSend)(router, handleSel, schema);

  PomeloTunnelSet(@"attempted", @YES);
  PomeloTunnelSet(@"handled", @(handled));
  PomeloTunnelSet(@"schema", schema);
  PomeloTunnelLog([NSString stringWithFormat:@"tunnel handleSchema handled=%d url=%@ room=%@",
                                             handled, tunnelUrl, room]);
}

void PomeloDebugTunnelConnect(void) {
  PomeloDebugTunnelConnectInternal(NO);
}

/** JS-exposed force reconnect: bypasses the "already connected" guard. */
void PomeloDebugTunnelReconnect(void) {
  PomeloDebugTunnelConnectInternal(YES);
}

/**
 * Live status for the settings page. Combines our last-attempt record with
 * DebugRouter's own connection state.
 *
 * Public ConnectionState (DebugRouterCommon.h):
 * DISCONNECTED = 0, CONNECTING = 1, CONNECTED = 2.
 */
NSDictionary *PomeloDebugTunnelStatus(void) {
  NSMutableDictionary *status = [PomeloTunnelSnapshot() mutableCopy]
                                    ?: [NSMutableDictionary dictionary];

  NSInteger state = -2;  // unknown / DebugRouter absent
  id router = PomeloDebugRouterInstance();
  if (router != nil) {
    SEL stateSel = NSSelectorFromString(@"connection_state");
    if ([router respondsToSelector:stateSel]) {
      state = (NSInteger)((int (*)(id, SEL)) objc_msgSend)(router, stateSel);
    }
  }
  // `room_id`/`server_url` are non-atomic std::string getters written by the
  // connect thread; reading them from the JS poll thread is a data race. The
  // configured url/room in our own snapshot are equivalent.
  NSString *roomId = status[@"room"] ?: @"";
  NSString *serverUrl = status[@"url"] ?: @"";

  status[@"state"] = @(state);
  status[@"state_text"] = state == 0 ? @"disconnected"
                          : state == 1 ? @"connecting"
                          : state == 2 ? @"connected"
                                       : @"unknown";
  status[@"connected"] = @(state == 2);
  status[@"room_id"] = roomId;
  status[@"server_url"] = serverUrl;
  return status;
}

/** Close the tunnel without touching the saved URL (the JS page removes it). */
void PomeloDebugTunnelDisconnect(void) {
  id router = PomeloDebugRouterInstance();
  SEL sel = NSSelectorFromString(@"disconnect");
  if (router != nil && [router respondsToSelector:sel]) {
    ((void (*)(id, SEL)) objc_msgSend)(router, sel);
    PomeloTunnelSet(@"attempted", @NO);
    PomeloTunnelSet(@"handled", @NO);
    PomeloTunnelSet(@"last_event", @"disconnect");
    PomeloTunnelLog(@"tunnel disconnect requested");
  }
}

// MARK: - Devtool bootstrap (steps 1–4)

static NSObject *gBootLock = nil;
static BOOL gDevToolBootDone = NO;

// Returns YES when steps 1–4 are (now) applied. A missing DevToolSettings does
// NOT latch the flag: AppDelegate retries after LynxEnv is up.
static BOOL PomeloBootstrapDevTool(void) {
  if (gBootLock == nil) gBootLock = [NSObject new];
  @synchronized (gBootLock) {
    if (gDevToolBootDone) return YES;

    // (1) Bootstrap defaults — the Lynx public devtool wrapper.
    Class settingsClass = NSClassFromString(@"DevToolSettings");
    if (settingsClass == nil) {
      NSLog(@"[pomelo-devtool] DevToolSettings class absent — Devtool pod not installed (release channel?), skipping");
      return NO;
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

    gDevToolBootDone = YES;
    NSLog(@"[pomelo-devtool] dev channel bootstrap done (allSessions=%d)", sessionsEnabled);
    return YES;
  }
}

// Constructor-safe: only the devtool/host bootstrap. The tunnel dial lives in
// PomeloEnsureDevToolEnabled / sceneDidBecomeActive, i.e. after UIApplicationMain
// has brought up NSUserDefaults' container and the log sink.
static void PomeloEnableDevTool(void) {
  PomeloBootstrapDevTool();
}

__attribute__((constructor)) static void PomeloDevToolBootCtor(void) {
  // Runs after ObjC classes from all linked static libs are registered, and
  // before application(_:didFinishLaunchingWithOptions:) touches LynxEnv.
  // DevTool activation must precede the first LynxView creation so the
  // inspector can attach from the very first session.
  PomeloEnableDevTool();
}

// Expose an ObjC-visible entry so Swift (or tests) can re-run safely.
// Called from AppDelegate (after LynxEnv + LogStore bootstrap) and from the
// JS `PomeloDebugTunnel.reconnect` method; idempotent.
void PomeloEnsureDevToolEnabled(void) {
  PomeloBootstrapDevTool();
  PomeloDebugTunnelConnect();
}
