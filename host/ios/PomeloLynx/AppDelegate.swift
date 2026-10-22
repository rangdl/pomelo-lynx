import UIKit

/**
 * App entry: brings the Lynx runtime up once, before any `LynxView` exists.
 *
 * iOS counterpart of Android's `HostApplication.onCreate()`. Most host
 * services are **not** registered by hand: each pod self-registers through
 * Lynx's lazy-register mechanism (`LYNX_LAZY_LOAD` / `LynxLazyRegister`),
 * which CocoaPods wires up by linking the static libs with `-ObjC`. Touching
 * `LynxEnv.sharedInstance()` is what flushes those pending registrations — so
 * it must happen before the first LynxView is built. Which of those services
 * exist is decided purely by the Podfile (Image / Log / Devtool).
 */
@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    LynxEnv.sharedInstance()
    return true
  }
}
