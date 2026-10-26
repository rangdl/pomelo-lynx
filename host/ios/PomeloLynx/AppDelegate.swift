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
    // Logging comes up right after the runtime, so the whole launch chain —
    // including anything below this line — lands in the daily file.
    LogStore.shared.bootstrap()
    Log.info("boot", Self.bootBanner())
    return true
  }

  /// First line of every session: what build, what OS, what hardware.
  /// (channel/commit follow from JS once its logger starts.)
  private static func bootBanner() -> String {
    let info = Bundle.main.infoDictionary ?? [:]
    let version = info["CFBundleShortVersionString"] as? String ?? "?"
    let build = info["CFBundleVersion"] as? String ?? "?"
    var systemInfo = utsname()
    uname(&systemInfo)
    let machine = withUnsafeBytes(of: &systemInfo.machine) { raw -> String in
      let bytes = raw.prefix(while: { $0 != 0 })
      return String(decoding: bytes, as: UTF8.self)
    }
    return "PomeloLynx \(version)(\(build)) iOS \(UIDevice.current.systemVersion) (\(machine))"
  }
}
