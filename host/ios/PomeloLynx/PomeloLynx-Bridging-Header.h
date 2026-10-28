//
//  Bridging header — the Lynx pods are plain static ObjC libraries (no Swift
//  module), so the Swift host reaches them through these imports. Subset of
//  songloft-player-lynx's bridging header (itself from the official
//  integrating-lynx-demo-projects ios/HelloLynxSwift demo).
//

#import <Lynx/LynxConfig.h>
#import <Lynx/LynxEnv.h>
#import <Lynx/LynxTemplateProvider.h>
#import <Lynx/LynxTemplateResourceFetcher.h>
#import <Lynx/LynxView.h>
#import <Lynx/LynxError.h>
#import <Lynx/LynxLoadMeta.h>
#import <Lynx/LynxTemplateData.h>

// Native modules: `LynxContextModule` is the protocol a module adopts to
// receive a `LynxContext` (needed for `sendGlobalEvent`); it pulls in
// `LynxModule.h` and `LynxContext.h` itself. (PomeloUpdate / PomeloStorage.)
#import <Lynx/LynxContextModule.h>

// Wrap NSData in the SDK response with its explicit Objective-C initializer.
NS_INLINE LynxTemplateResource * _Nonnull PomeloTemplateResourceFromData(NSData * _Nonnull data) {
  return [[LynxTemplateResource alloc] initWithNSData:data];
}

// DevToolBoot.m — DebugRouter WS reverse tunnel (JS: NativeModules.PomeloDebugTunnel).
void PomeloEnsureDevToolEnabled(void);
void PomeloDebugTunnelConnect(void);
void PomeloDebugTunnelDisconnect(void);
NSDictionary * _Nonnull PomeloDebugTunnelStatus(void);
