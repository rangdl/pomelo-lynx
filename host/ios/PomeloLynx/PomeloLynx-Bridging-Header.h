//
//  Bridging header — the Lynx pods are plain static ObjC libraries (no Swift
//  module), so the Swift host reaches them through these imports. Subset of
//  songloft-player-lynx's bridging header (itself from the official
//  integrating-lynx-demo-projects ios/HelloLynxSwift demo): this host registers
//  no custom native modules yet, so the module/context imports are absent —
//  they come back with the PomeloUpdate module (stage 4c).
//

#import <Lynx/LynxConfig.h>
#import <Lynx/LynxEnv.h>
#import <Lynx/LynxTemplateProvider.h>
#import <Lynx/LynxTemplateResourceFetcher.h>
#import <Lynx/LynxView.h>
#import <Lynx/LynxError.h>
#import <Lynx/LynxLoadMeta.h>
#import <Lynx/LynxTemplateData.h>

// Wrap NSData in the SDK response with its explicit Objective-C initializer.
NS_INLINE LynxTemplateResource * _Nonnull PomeloTemplateResourceFromData(NSData * _Nonnull data) {
  return [[LynxTemplateResource alloc] initWithNSData:data];
}
