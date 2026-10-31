import UIKit
import PomeloLynxStorage
import PomeloLynxPlatform
import PomeloLynxMedia
import PomeloLynxFilesystem

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
  /// 冷启动只从 prefs 应用一次 UIKit 外观;之后由 PomeloPlatform 更新。
  private var storedAppearanceModeApplied = false
  /// 左边缘返回手势;只有 JS 路由处于子页时启用。
  private var edgePanGesture: UIScreenEdgePanGestureRecognizer?
  /// 侧滑期间的透明遮罩:阻断 LynxView 滚动,但不禁用触摸序列。
  private var swipeShield: UIView?
  /// 遮罩/手势异常中断时的安全回收。
  private var swipeSafety: DispatchWorkItem?
  /// 冷启动时没有 dev cache,先用内置 bundle 渲染,等远端下载成功再切。
  private var pendingDevURL: String?
  private var loadingView: UIView?
  private var loadingSpinner: UIActivityIndicatorView?
  private var loadingLabel: UILabel?

  init() {
    // `PomeloLynx --bundle probe` selects the alignment probe page.
    if ProcessInfo.processInfo.arguments.contains("--bundle"),
      let index = ProcessInfo.processInfo.arguments.firstIndex(of: "--bundle"),
      ProcessInfo.processInfo.arguments.count > index + 1,
      ProcessInfo.processInfo.arguments[index + 1] == "probe"
    {
      self.bundleURL = HostTemplateProvider.probeBundle
    } else if let devURL = Self.storedDevServerURL() {
      // 冷启动不能等待远端 dev bundle:有缓存先读缓存,没有就用内置
      // bundle 立即出首屏,远端在后台下载成功后再 reload。
      if HostTemplateProvider.cachedDevBundle(for: devURL) != nil {
        self.bundleURL = devURL
      } else {
        self.bundleURL = HostTemplateProvider.mainBundle
        self.pendingDevURL = devURL
      }
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
    // Lynx 页面没有 UINavigationController,系统不会自带 interactivePop。
    // 左边缘手势只负责告诉 JS“用户想返回”,由 JS 路由决定是否 pop。
    let edgePan = UIScreenEdgePanGestureRecognizer(
      target: self, action: #selector(handleEdgePan(_:)))
    edgePan.edges = .left
    // 手势一旦识别就取消 LynxView 内的触摸,避免侧滑同时滚动页面。
    edgePan.cancelsTouchesInView = true
    edgePan.delegate = self
    edgePan.isEnabled = false
    edgePanGesture = edgePan
    view.addGestureRecognizer(edgePan)
  }

  /// 由 JS 根据当前路由开关:根 tab 不接管边缘手势。
  func setEdgeBackEnabled(_ enabled: Bool) {
    edgePanGesture?.isEnabled = enabled
  }

  /// 左边缘拖拽:持续上报位移让 JS 页面跟手,松手由 JS 提交或回弹。
  @objc private func handleEdgePan(
    _ gesture: UIScreenEdgePanGestureRecognizer
  ) {
    let translation = max(0, gesture.translation(in: view).x)
    switch gesture.state {
    case .began:
      beginSwipeShield()
      sendNavigationSwipe(phase: "begin", translation: 0, commit: false)
    case .changed:
      sendNavigationSwipe(
        phase: "change", translation: translation, commit: false)
    case .ended:
      endSwipeShield()
      let velocity = gesture.velocity(in: view).x
      let width = max(view.bounds.width, 1)
      let commit = translation > width * 0.28 || velocity > 500
      sendNavigationSwipe(
        phase: "end", translation: translation, commit: commit)
    case .cancelled, .failed:
      endSwipeShield()
      sendNavigationSwipe(
        phase: "end", translation: translation, commit: false)
    default:
      break
    }
  }

  /// 透明遮罩挡在 LynxView 上方:手指仍由父 view 的边缘手势接管,但
  /// scroll-view 收不到触摸,侧滑就不会同时滚页。
  private func beginSwipeShield() {
    guard swipeShield == nil else { return }
    let shield = UIView(frame: view.bounds)
    shield.backgroundColor = .clear
    shield.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(shield)
    swipeShield = shield
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.swipeShield != nil else { return }
      self.endSwipeShield()
      self.sendNavigationSwipe(
        phase: "end", translation: 0, commit: false)
    }
    swipeSafety = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
  }

  private func endSwipeShield() {
    swipeSafety?.cancel()
    swipeSafety = nil
    swipeShield?.removeFromSuperview()
    swipeShield = nil
  }

  /// 把拖拽进度发给 JS;`translation` 为 pt,`progress` 供 JS 判断阈值。
  private func sendNavigationSwipe(
    phase: String, translation: CGFloat, commit: Bool
  ) {
    guard let lynxView else { return }
    let width = max(view.bounds.width, 1)
    let progress = min(1, max(0, translation / width))
    lynxView.sendGlobalEvent(
      "PomeloNavigation.swipe",
      withParams: [[
        "phase": phase,
        "translation": Double(translation),
        "width": Double(width),
        "progress": Double(progress),
        "commit": commit,
      ]])
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    // Full screen, NOT `safeAreaLayoutGuide.layoutFrame`: the page avoids the
    // status bar / home indicator itself (deviation 1).
    let frame = view.bounds
    guard frame.width > 0, frame.height > 0 else { return }
    loadingView?.frame = frame
    applyStoredAppearanceModeIfNeeded()

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
    showLoadingOverlay(frame: frame)

    // `LynxLoadMeta` carries the globalProps *into* the load, so the very
    // first frame already knows who is hosting it.
    let meta = LynxLoadMeta()
    meta.url = bundleURL
    let info = Bundle.main.infoDictionary ?? [:]
    var globalProps: [String: Any] = [
      "hostName": "pomelo-host-ios",
      // 客户端更新必须看安装包本身的版本,不能用热更新后的 bundle 身份。
      "hostVersion": info["CFBundleShortVersionString"] as? String ?? "",
      "hostBuild": info["CFBundleVersion"] as? String ?? "",
      "hostChannel": info["PomeloChannel"] as? String ?? "dev",
      "isDebug": ProcessInfo.processInfo.environment["POMELO_DEBUG"] != nil,
      "language": Locale.preferredLanguages.first ?? "zh",
    ]
    // 首帧就带上深浅色与安全区;运行中变化由 PomeloAppearance.changed 补齐。
    globalProps.merge(appearancePayload) { _, new in new }
    meta.globalProps = LynxTemplateData(dictionary: globalProps)
    firstScreenReached = false
    lynxView.loadTemplate(meta)
    Log.info("launch", "loadTemplate(\(bundleURL)) invoked")
    refreshPendingDevBundle()
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
    // 从后台回来时 trait 可能刚从后台瞬态恢复;延后一拍重读,避免把
    // 后台期间的临时 dark trait 留在页面上。
    DispatchQueue.main.async { [weak self] in
      self?.pushAppearance(reason: "foreground", includeColorScheme: true)
    }
    // 回到前台后 trait 可能还要一拍才稳定,再补一次。
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
      self?.pushAppearance(reason: "foreground", includeColorScheme: true)
    }
  }

  // MARK: - Dev server 热切换(PomeloPlatform 调用)

  /// 连接新的 dev server:先完整下载并校验 bundle,成功后才切换来源并
  /// 重建 LynxView。失败时当前页面保持不动,不会再把坏 URL 写进 prefs。
  func applyDevServer(
    _ urlString: String, completion: @escaping (String?) -> Void
  ) {
    let url = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard Self.isDevServerURL(url) else {
      completion("devserver_invalid_url")
      return
    }
    prepareDevServer(url) { error in
      guard error == nil else {
        completion(error)
        return
      }
      let prefs = UserDefaults(suiteName: "pomelo_prefs") ?? .standard
      if let previous = prefs.string(forKey: "dev_server_url"),
        previous != url
      {
        HostTemplateProvider.clearDevBundleCache(for: previous)
      }
      prefs.set(url, forKey: "dev_server_url")
      completion(nil)
    }
  }

  /// 刷新当前来源:有已配置的 dev URL 时重新下载它(即使当前是启动失败
  /// 后的内嵌回退),否则重建内嵌 bundle。服务器重启后无需冷启动。
  func reloadCurrentBundle(completion: @escaping (String?) -> Void) {
    if Self.isDevServerURL(bundleURL) {
      prepareDevServer(bundleURL, completion: completion)
      return
    }
    let prefs = UserDefaults(suiteName: "pomelo_prefs") ?? .standard
    if let configured = prefs.string(forKey: "dev_server_url"),
      Self.isDevServerURL(configured)
    {
      prepareDevServer(configured, completion: completion)
      return
    }
    reloadLynxView()
    completion(nil)
  }

  /// 断开 dev server:清配置并立即重建内嵌 bundle,无需冷启动。
  func clearDevServer(completion: @escaping () -> Void) {
    let prefs = UserDefaults(suiteName: "pomelo_prefs") ?? .standard
    if let configured = prefs.string(forKey: "dev_server_url"),
      Self.isDevServerURL(configured)
    {
      HostTemplateProvider.clearDevBundleCache(for: configured)
    }
    pendingDevURL = nil
    prefs.removeObject(forKey: "dev_server_url")
    bundleURL = HostTemplateProvider.mainBundle
    completion()
    DispatchQueue.main.async { [weak self] in
      self?.reloadLynxView()
    }
  }

  /// 下载校验成功后再切换来源。回调先交还 JS,下一拍才拆 LynxView,
  /// 避免 Promise 回调随旧 LynxContext 一起销毁。
  private func prepareDevServer(
    _ url: String, completion: @escaping (String?) -> Void
  ) {
    HostTemplateProvider.fetchRemoteData(url) { [weak self] data, error in
      DispatchQueue.main.async {
        guard let self else {
          completion("devserver_host_gone")
          return
        }
        guard let data else {
          completion(error?.localizedDescription ?? "devserver_download_failed")
          return
        }
        self.templateProvider.stageRemoteTemplate(data, for: url)
        self.bundleURL = url
        completion(nil)
        DispatchQueue.main.async { [weak self] in
          self?.reloadLynxView()
        }
      }
    }
  }

  /// 只接受指向 `.lynx.bundle` 的 http(s) 地址;bundle 内容仍由
  /// `HostTemplateProvider` 做头部校验。
  private static func isDevServerURL(_ value: String) -> Bool {
    guard let url = URL(string: value),
      let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      url.host != nil
    else { return false }
    return url.path.hasSuffix(".lynx.bundle")
  }

  /// 冷启动无 dev cache 时:内置 bundle 先出首屏,远端成功后再 reload。
  private func refreshPendingDevBundle() {
    guard let devURL = pendingDevURL else { return }
    pendingDevURL = nil
    HostTemplateProvider.fetchRemoteData(devURL) { [weak self] data, error in
      DispatchQueue.main.async {
        guard let self else { return }
        guard let data else {
          Log.warn(
            "devserver",
            "cold-start refresh failed: \(error?.localizedDescription ?? "unknown")")
          return
        }
        self.templateProvider.stageRemoteTemplate(data, for: devURL)
        self.bundleURL = devURL
        self.reloadLynxView()
      }
    }
  }

  private func showLoadingOverlay(frame: CGRect) {
    if let overlay = loadingView {
      overlay.frame = frame
      overlay.isHidden = false
      loadingLabel?.text = "正在加载…"
      loadingLabel?.textColor = .secondaryLabel
      loadingSpinner?.startAnimating()
      return
    }
    let overlay = UIView(frame: frame)
    overlay.backgroundColor = .systemBackground
    let spinner = UIActivityIndicatorView(style: .large)
    spinner.startAnimating()
    let label = UILabel()
    label.text = "正在加载…"
    label.font = .systemFont(ofSize: 15)
    label.textColor = .secondaryLabel
    spinner.translatesAutoresizingMaskIntoConstraints = false
    label.translatesAutoresizingMaskIntoConstraints = false
    overlay.addSubview(spinner)
    overlay.addSubview(label)
    NSLayoutConstraint.activate([
      spinner.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: overlay.centerYAnchor, constant: -18),
      label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 12),
    ])
    view.addSubview(overlay)
    loadingView = overlay
    loadingSpinner = spinner
    loadingLabel = label
  }

  private func hideLoadingOverlay() {
    loadingSpinner?.stopAnimating()
    loadingView?.removeFromSuperview()
    loadingView = nil
    loadingSpinner = nil
    loadingLabel = nil
  }

  /// 拆掉当前 LynxView,让 `viewDidLayoutSubviews` 用新的 `bundleURL`
  /// 重建。启动状态与外观签名必须一起重置,否则新实例会误判首屏/跳过推送。
  private func reloadLynxView() {
    firstScreenReached = false
    lastAppearanceSignature = ""
    if let lynxView {
      lynxView.removeFromSuperview()
      self.lynxView = nil
    }
    view.setNeedsLayout()
  }

  /// 把应用外观偏好同步到 UIKit:状态栏、键盘、系统弹窗都跟随选择,
  /// 而不是只在 JS 层换 token。
  func applyAppearanceMode(_ mode: String) {
    let style: UIUserInterfaceStyle
    switch mode {
    case "light":
      style = .light
    case "dark":
      style = .dark
    default:
      style = .unspecified
    }
    view.overrideUserInterfaceStyle = style
    view.window?.overrideUserInterfaceStyle = style
    setNeedsStatusBarAppearanceUpdate()
  }

  /// 冷启动时读取 JS 写入的 `appearance_mode`,保证首帧系统 UI 就正确。
  private func applyStoredAppearanceModeIfNeeded() {
    guard !storedAppearanceModeApplied else { return }
    storedAppearanceModeApplied = true
    let prefs = UserDefaults(suiteName: "pomelo_prefs") ?? .standard
    applyAppearanceMode(prefs.string(forKey: "appearance_mode") ?? "system")
  }

  /// 当前深浅色与安全区。globalProps 初值与变更事件共用同一形状。
  private var appearancePayload: [String: Any] {
    let insets = view.safeAreaInsets
    // VC 在前后台切换时可能是瞬态 trait;窗口 trait 才是最终值。
    let style = (view.window?.traitCollection ?? traitCollection).userInterfaceStyle
    return [
      "colorScheme": style == .dark ? "dark" : "light",
      "safeTop": Double(insets.top),
      "safeBottom": Double(insets.bottom),
      "safeLeft": Double(insets.left),
      "safeRight": Double(insets.right),
    ]
  }

  /// 只在值变化时推送;首帧值已由 globalProps 带入,首屏后再补一次。
  /// `includeColorScheme` 为 false 时只推安全区:后台/前台恢复会触发
  /// safe-area 回调,不能让它顺带把主题切成后台瞬态的 trait。
  private func pushAppearance(reason: String, includeColorScheme: Bool) {
    guard let lynxView else { return }
    var payload = appearancePayload
    if !includeColorScheme {
      payload.removeValue(forKey: "colorScheme")
    }
    let signature = payload.keys.sorted()
      .map { "\($0)=\(payload[$0] ?? "")" }
      .joined(separator: "|")
    guard signature != lastAppearanceSignature else { return }
    lastAppearanceSignature = signature
    Log.debug("appearance", "push \(reason) \(payload)")
    // 新版 JS 只接受带明确 reason 的外观事件;值签名仍只用几何/主题字段,
    // 避免 reason 变化导致重复发送。
    payload["reason"] = reason
    lynxView.sendGlobalEvent("PomeloAppearance.changed", withParams: [payload])
  }

  override func traitCollectionDidChange(
    _ previousTraitCollection: UITraitCollection?
  ) {
    super.traitCollectionDidChange(previousTraitCollection)
    // 只忽略真正进入后台时的 trait。切换系统主题时 app 可能短暂处于
    // inactive(控制中心/设置页),若仍按 app 活跃状态过滤,主题要等回到
    // 前台才更新,表现为明显延迟。
    let appInBackground = UIApplication.shared.applicationState == .background
    let sceneInBackground =
      view.window?.windowScene?.activationState == .background
    let inBackground = appInBackground || sceneInBackground
    let windowStyle =
      (view.window?.traitCollection ?? traitCollection).userInterfaceStyle
    let styleChanged =
      previousTraitCollection?.userInterfaceStyle != windowStyle
    pushAppearance(
      reason: "trait",
      includeColorScheme: !inBackground && styleChanged,
    )
  }

  override func viewSafeAreaInsetsDidChange() {
    super.viewSafeAreaInsetsDidChange()
    pushAppearance(reason: "safeArea", includeColorScheme: false)
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
    config.register(PomeloLogModule.self)
    config.register(PomeloDebugTunnelModule.self)
    config.register(PomeloPlatformModule.self)
    config.register(PomeloPlayerModule.self)
    config.register(PomeloStorageModule.self)
    config.register(PomeloFileSystemModule.self)
    config.register(PomeloHostModule.self)
    return config
  }
}

extension ViewController: LynxViewLifecycle {
  func lynxViewDidFirstScreen(_ view: LynxView) {
    Log.info("launch", "FIRST SCREEN reached")
    firstScreenReached = true
    hideLoadingOverlay()
    pushAppearance(reason: "firstScreen", includeColorScheme: true)
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
    // 热切换会拆掉旧 LynxView;旧实例随后上报的错误不能影响新来源。
    guard let current = lynxView, view === current else { return }
    let lynxError = error as? LynxError
    let isFatal = lynxError?.isFatal == true
    Log.error("lynx", "error: \(error.localizedDescription) (fatal=\(isFatal))")
    // 399/301 这类 sourcemap/devtool 错误是 fatal=false,dev bundle 其实已经
    // 渲染出首屏;不能因为它回退。只有 fatal,或还没出首屏(下载/解码失败)
    // 时才回退;配置保留,开发者页可以在服务器恢复后重试,无需冷启动。
    if bundleURL.hasPrefix("http://") || bundleURL.hasPrefix("https://") {
      guard isFatal || !firstScreenReached else { return }
      Log.error("devserver", "dev URL load failed; falling back to embedded bundle (pref kept for retry)")
      fallbackToEmbeddedBundle()
      return
    }
    guard isFatal else { return }
    DispatchQueue.global(qos: .utility).async {
      try? BundleUpdateStore.shared?.failStartup()
    }
  }

  /// 丢掉当前 dev 来源、切回内嵌 bundle,但**不清除** `dev_server_url`。
  /// 服务器重启期间冷启动会走这里;开发者页仍能看到配置并自动重试。
  private func fallbackToEmbeddedBundle() {
    if Self.isDevServerURL(bundleURL) {
      HostTemplateProvider.clearDevBundleCache(for: bundleURL)
    }
    bundleURL = HostTemplateProvider.mainBundle
    DispatchQueue.main.async { [weak self] in
      self?.reloadLynxView()
    }
  }
}


extension ViewController: UIGestureRecognizerDelegate {
  /// 只接管横向边缘滑动;纵向滑动仍交给页面滚动。
  func gestureRecognizerShouldBegin(
    _ gestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    guard let pan = gestureRecognizer as? UIPanGestureRecognizer else {
      return true
    }
    let velocity = pan.velocity(in: view)
    if abs(velocity.x) > 0 || abs(velocity.y) > 0 {
      return abs(velocity.x) > abs(velocity.y)
    }
    // 极早期速度可能为 0,退回比较位移,避免横向手势被误判掉。
    let translation = pan.translation(in: view)
    return abs(translation.x) >= abs(translation.y)
  }
}
