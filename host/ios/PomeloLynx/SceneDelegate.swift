import UIKit

/**
 * Scene lifecycle: hands the window to `ViewController` and forwards
 * foreground/background so the page can observe lifecycle if it ever needs to.
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = ViewController()
    self.window = window
    window.makeKeyAndVisible()
  }

  // 前台恢复时通知页面:JS 侧 automatic-update 靠该事件补查到期任务
  // (src/native/app-lifecycle.ts 的 subscribeAppResumed)。
  func sceneDidBecomeActive(_ scene: UIScene) {
    (window?.rootViewController as? ViewController)?.notifyAppResumed()
  }
}
