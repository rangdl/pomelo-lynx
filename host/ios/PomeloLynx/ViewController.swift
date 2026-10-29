import UIKit

/**
 * Single host view controller: builds one `LynxView`, points it at the
 * `HostTemplateProvider` and renders the selected local bundle (main by
 * default, probe via the `--bundle probe` launch argument).
 *
 * Structure (builder block, `preferredLayout*` + `.exact` layout modes,
 * `loadTemplate(fromURL:)`) is copied from the official
 * `integrating-lynx-demo-projects` ios/HelloLynxSwift demo, via
 * songloft-player-lynx, with the same deliberate deviations:
 *
 *  1. **The LynxView fills the whole screen** (`view.bounds`), status bar and
 *     home indicator included, and the *page* keeps its content clear of them
 *     through `env(safe-area-inset-*)`, which Lynx supports.
 *  2. **Everything happens in `viewDidLayoutSubviews`, not `viewDidLoad`**,
 *     because that is the first point where `view.bounds` is the real window
 *     size — building earlier would render the launch frame at the wrong
 *     height and immediately re-lay it out.
 */
final class ViewController: UIViewController {
  /// Resource base name. `HostTemplateProvider` appends the `.bundle`
  /// extension, so this resolves to `main.lynx.bundle` / `probe.lynx.bundle`
  /// in app resources — the same files the Android host reads from `assets/`.
  private var bundleURL: String

  private var lynxView: LynxView?
  private let templateProvider = HostTemplateProvider()
  private var laidOutSize: CGSize = .zero
  /// `LynxEnv` snapshots `keyWindow.safeAreaInsets` when the LynxView is built
  /// (`initLayoutConfig:`), and `getKeyWindow` only accepts a scene in
  /// `foregroundActive`. The first layout pass runs inside
  /// `scene(_:willConnectTo:)`, while the scene is still inactive — building
  /// there freezes every `env(safe-area-inset-*)` at 0, which puts headers
  /// under the status bar and makes the back button untappable. So: wait for
  /// `SceneDelegate` to tell us the scene is active.
  private var sceneIsActive = false
  private var deferralLogged = false
  /// 当前 LynxView 是否已经渲染出首屏;用于区分“加载失败”和首屏后的
  /// sourcemap/devtool 非致命错误(399/301)。
  private var firstScreenReached = false
  /// 上次推给 JS 的外观签名,避免布局/旋转回调重复发同值事件。
  private var lastAppearanceSignature = ""

  init() {
    // `PomeloLynx --bundle probe` selects the alignment probe page.
    if ProcessInfo.processInfo.arguments.contains("--bundle"),
      let index = ProcessInfo.processInfo.arguments.firstIndex(of: "--bundle"),
      ProcessInfo.processInfo.arguments.count > index + 1,
      ProcessInfo.processInfo.arguments[index + 1] == "probe"
    {
      self.bundleURL = HostTemplateProvider.probeBundle
    } else if let devURL = Self.storedDevServerURL() {
      // 设置页配置的开发服务器 URL 优先:实时开发走 rspeedy dev server。
      // `HostTemplateProvider` 识别 http(s) 前缀走网络拉取,失败由
      // Lynx 的加载错误链路上报(见 lynxView(_:didRecieveError:))。
      self.bundleURL = devURL
    } else {
      self.bundleURL = HostTemplateProvider.mainBundle
    }
    super.init(nibName: nil, bundle: nil)
  }

  /// Dev-server URL persisted by the settings page (`PomeloStorageModule`
  /// prefs suite, key `dev_server_url`). `nil` → normal embedded loading.
  /// Only http(s) values are honored; anything else is treated as unset.
  private static func storedDevServerURL() -> String? {
    let prefs = UserDefaults(suiteName: "pomelo_prefs") ?? .standard
    guard let raw = prefs.string(forKey: "dev_server_url"),
      raw.hasPrefix("http://") || raw.hasPrefix("https://")
    else { return nil }
    return raw
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    // Full screen, NOT `safeAreaLayoutGuide.layoutFrame`: the page avoids the
    // status bar / home indicator itself (deviation 1).
    let frame = view.bounds
    guard frame.width > 0, frame.height > 0 else { return }

    if let lynxView {
      // Rotation / window resize: Lynx does not observe UIKit layout, so the
      // new viewport has to be pushed in explicitly.
      guard frame.size != laidOutSize else { return }
      laidOutSize = frame.size
      lynxView.frame = frame
      lynxView.updateViewport(withPreferredLayoutWidth: frame.width,
                              preferredLayoutHeight: frame.height)
      return
    }

    guard sceneIsActive || view.window?.windowScene?.activationState == .foregroundActive else {
      if !deferralLogged {
        deferralLogged = true
        Log.debug("launch", "deferring LynxView until the scene is foreground-active")
      }
      return
    }

    Log.debug("launch", "creating LynxView (screen=\(NSCoder.string(for: view.window?.windowScene?.screen.bounds.size ?? .zero)), frame=\(NSCoder.string(for: frame.size)), safe=\(NSCoder.string(for: view.safeAreaInsets)))")
    laidOutSize = frame.size
    let screenSize = view.window?.windowScene?.screen.bounds.size ?? view.bounds.size
    let provider = templateProvider
    let lynxView = LynxView { builder in
      Log.debug("launch", "builder: enter")
      builder.config = Self.buildConfig(provider: provider)
      Log.debug("launch", "builder: config set")
      builder.screenSize = screenSize
      Log.debug("launch", "builder: screenSize set")
      builder.fontScale = 1.0
      Log.debug("launch", "builder: done")
    }
    if lynxView == nil {
      Log.error("launch", "LynxView NIL!")
    } else {
      Log.debug("launch", "LynxView created ok")
    }
    lynxView.preferredLayoutWidth = frame.width
    lynxView.preferredLayoutHeight = frame.height
    lynxView.layoutWidthMode = .exact
    lynxView.layoutHeightMode = .exact
    lynxView.frame = frame
    view.addSubview(lynxView)
    self.lynxView = lynxView
    lynxView.addLifecycleClient(self)

    // `LynxLoadMeta` carries the globalProps *into* the load, so the very
    // first frame already knows who is hosting it.
    let meta = LynxLoadMeta()
    meta.url = bundleURL
    var globalProps: [String: Any] = [
      "hostName": "pomelo-host-ios",
      "isDebug": ProcessInfo.processInfo.environment["POMELO_DEBUG"] != nil,
      "language": Locale.preferredLanguages.first ?? "zh",
    ]
    // 首帧就带上深浅色与安全区;运行中变化由 PomeloAppearance.changed 补齐。
    globalProps.merge(appearancePayload) { _, new in new }
    meta.globalProps = LynxTemplateData(dictionary: globalProps)
    firstScreenReached = false
    lynxView.loadTemplate(meta)
    Log.info("launch", "loadTemplate(\(bundleURL)) invoked")
  }

  /**
   * Called from `SceneDelegate.sceneDidBecomeActive`: the earliest point where
   * `LynxEnv` can read a real `keyWindow` safe area. A deferred first layout
   * is re-requested here; if the view laid out already (e.g. warm start), this
   * is a harmless no-op.
   */
  func sceneBecameActive() {
    sceneIsActive = true
    if lynxView == nil {
      view.setNeedsLayout()
    }
  }

  /// 当前深浅色与安全区。globalProps 初值与变更事件共用同一形状。
  private var appearancePayload: [String: Any] {
    let insets = view.safeAreaInsets
    return [
      "colorScheme": traitCollection.userInterfaceStyle == .dark ? "dark" : "light",
      "safeTop": Double(insets.top),
      "safeBottom": Double(insets.bottom),
      "safeLeft": Double(insets.left),
      "safeRight": Double(insets.right),
    ]
  }

  /// 只在值变化时推送;首帧值已由 globalProps 带入,首屏后再补一次。
  private func pushAppearance() {
    guard let lynxView else { return }
    let payload = appearancePayload
    let signature =
      "\(payload["colorScheme"] ?? "")-\(payload["safeTop"] ?? 0)-"
      + "\(payload["safeBottom"] ?? 0)-\(payload["safeLeft"] ?? 0)-"
      + "\(payload["safeRight"] ?? 0)"
    guard signature != lastAppearanceSignature else { return }
    lastAppearanceSignature = signature
    lynxView.sendGlobalEvent("PomeloAppearance.changed", withParams: [payload])
  }

  override func traitCollectionDidChange(
    _ previousTraitCollection: UITraitCollection?
  ) {
    super.traitCollectionDidChange(previousTraitCollection)
    pushAppearance()
  }

  override func viewSafeAreaInsetsDidChange() {
    super.viewSafeAreaInsetsDidChange()
    pushAppearance()
  }

  /**
   * The `LynxConfig` for our single LynxView: the template provider plus the
   * three Pomelo native modules (`NativeModules.PomeloUpdate` /
   * `PomeloStorage` / `PomeloLog` in JS, global event `PomeloLog.append` for
   * log push and `PomeloUpdate.progress` for download progress).
   *
   * These three were commented out during black-screen triage on a hunch that
   * `config.register` hung the constructor — that diagnosis was wrong (the
   * stall was TanStack's missing `self` bootstrap; the overlay had also
   * stopped updating because of the `ensureOverlay` bug). songloft registers
   * nine modules the same way on the same call, so restore all three here.
   */
  private static func buildConfig(provider: HostTemplateProvider) -> LynxConfig {
    let config = LynxConfig(provider: provider)
    config.register(PomeloUpdateModule.self)
    config.register(PomeloStorageModule.self)
    config.register(PomeloLogModule.self)
    config.register(PomeloDebugTunnelModule.self)
    config.register(PomeloPlatformModule.self)
    return config
  }
}

extension ViewController: LynxViewLifecycle {
  func lynxViewDidFirstScreen(_ view: LynxView) {
    Log.info("launch", "FIRST SCREEN reached")
    firstScreenReached = true
    pushAppearance()
  }

  /// 前台恢复(SceneDelegate sceneDidBecomeActive):推 JS 全局事件,
  /// 页面的自动更新调度靠它补查到期任务。
  func notifyAppResumed() {
    Log.info("lifecycle", "app resumed event → JS")
    let params = [["state": "resumed"]]
    lynxView?.sendGlobalEvent("PomeloLifecycle.resumed", withParams: params)
  }

  // LynxViewLifecycle 的可选方法要求 `Error`,写成 NSError 时 Swift 只会
  // 产生 "nearly matches" 警告而不会进 ObjC 分发表——回退逻辑从未执行。
  // 显式选择器 + Error 签名两者都要。
  @objc(lynxView:didRecieveError:)
  func lynxView(_ view: LynxView, didRecieveError error: Error) {
    let lynxError = error as? LynxError
    let isFatal = lynxError?.isFatal == true
    Log.error("lynx", "error: \(error.localizedDescription) (fatal=\(isFatal))")
    // 399/301 这类 sourcemap/devtool 错误是 fatal=false,dev bundle 其实已经
    // 渲染出首屏;不能因为它清掉 dev URL 并回退。只有 fatal,或还没出首屏
    // (下载/解码失败)时才回退。
    if bundleURL.hasPrefix("http://") || bundleURL.hasPrefix("https://") {
      guard isFatal || !firstScreenReached else { return }
      Log.error("devserver", "dev URL load failed; clearing and falling back to embedded bundle")
      let prefs = UserDefaults(suiteName: "pomelo_prefs") ?? .standard
      prefs.removeObject(forKey: "dev_server_url")
      DispatchQueue.main.async { self.reloadWithEmbeddedBundle() }
      return
    }
    guard isFatal else { return }
    DispatchQueue.global(qos: .utility).async {
      try? BundleUpdateStore.shared?.failStartup()
    }
  }

  /// Tear down the current LynxView and rebuild against the embedded bundle.
  private func reloadWithEmbeddedBundle() {
    guard let lynxView else { return }
    // 必须同时把加载地址切回内嵌 bundle;否则 viewDidLayoutSubviews 重建
    // LynxView 时会再次使用旧的 dev URL,错误页会无限循环。
    bundleURL = HostTemplateProvider.mainBundle
    lynxView.removeFromSuperview()
    self.lynxView = nil
    view.setNeedsLayout()
  }
}
