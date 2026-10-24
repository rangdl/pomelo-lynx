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
  private let bundleURL: String

  private var lynxView: LynxView?
  private let templateProvider = HostTemplateProvider()
  private var laidOutSize: CGSize = .zero

  init() {
    // `PomeloLynx --bundle probe` selects the alignment probe page.
    if ProcessInfo.processInfo.arguments.contains("--bundle"),
      let index = ProcessInfo.processInfo.arguments.firstIndex(of: "--bundle"),
      ProcessInfo.processInfo.arguments.count > index + 1,
      ProcessInfo.processInfo.arguments[index + 1] == "probe"
    {
      self.bundleURL = HostTemplateProvider.probeBundle
    } else {
      self.bundleURL = HostTemplateProvider.mainBundle
    }
    super.init(nibName: nil, bundle: nil)
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

    NSLog("[PomeloLynx] creating LynxView (screen=%@, frame=%@)",
          NSCoder.string(for: view.window?.windowScene?.screen.bounds.size ?? .zero),
          NSCoder.string(for: frame.size))
    laidOutSize = frame.size
    let screenSize = view.window?.windowScene?.screen.bounds.size ?? view.bounds.size
    let provider = templateProvider
    let lynxView = LynxView { builder in
      builder.config = Self.buildConfig(provider: provider)
      builder.screenSize = screenSize
      builder.fontScale = 1.0
    }
    NSLog("[PomeloLynx] LynxView created: %@", lynxView == nil ? "NIL!" : "ok")
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
    meta.globalProps = LynxTemplateData(dictionary: [
      "hostName": "pomelo-host-ios",
      "isDebug": ProcessInfo.processInfo.environment["POMELO_DEBUG"] != nil,
    ])
    lynxView.loadTemplate(meta)
  }

  /**
   * The `LynxConfig` for our single LynxView: the template provider plus the
   * PomeloUpdate native module (`NativeModules.PomeloUpdate` in JS, global
   * event `PomeloUpdate.progress` for download progress).
   */
  private static func buildConfig(provider: HostTemplateProvider) -> LynxConfig {
    let config = LynxConfig(provider: provider)
    config.register(PomeloUpdateModule.self)
    config.register(PomeloStorageModule.self)
    return config
  }
}

extension ViewController: LynxViewLifecycle {
  func lynxViewDidFirstScreen(_ view: LynxView) {
    NSLog("[PomeloLynx] FIRST SCREEN reached")
  }

  /// 前台恢复(SceneDelegate sceneDidBecomeActive):推 JS 全局事件,
  /// 页面的自动更新调度靠它补查到期任务。
  func notifyAppResumed() {
    NSLog("[PomeloLynx] app resumed event → JS")
    let params = [["state": "resumed"]]
    lynxView?.sendGlobalEvent("PomeloLifecycle.resumed", withParams: params)
  }

  func lynxView(_ view: LynxView, didRecieveError error: NSError) {
    NSLog("[PomeloLynx] lynx error: %@ (fatal=%d)", error.localizedDescription, ((error as? LynxError)?.isFatal ?? false) ? 1 : 0)
    guard (error as? LynxError)?.isFatal == true else { return }
    DispatchQueue.global(qos: .utility).async {
      try? BundleUpdateStore.shared?.failStartup()
    }
  }
}
