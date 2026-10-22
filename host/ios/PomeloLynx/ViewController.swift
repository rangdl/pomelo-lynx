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

    laidOutSize = frame.size
    let screenSize = view.window?.windowScene?.screen.bounds.size ?? view.bounds.size
    let provider = templateProvider
    let lynxView = LynxView { builder in
      builder.config = Self.buildConfig(provider: provider)
      builder.screenSize = screenSize
      builder.fontScale = 1.0
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
    meta.globalProps = LynxTemplateData(dictionary: [
      "hostName": "pomelo-host-ios",
      "isDebug": ProcessInfo.processInfo.environment["POMELO_DEBUG"] != nil,
    ])
    lynxView.loadTemplate(meta)
  }

  /**
   * The `LynxConfig` for our single LynxView. This host registers no custom
   * native modules yet — the provider is the only app-owned piece. When the
   * PomeloUpdate module lands (stage 4c) it registers here.
   */
  private static func buildConfig(provider: HostTemplateProvider) -> LynxConfig {
    LynxConfig(provider: provider)
  }
}

extension ViewController: LynxViewLifecycle {
  func lynxViewDidFirstScreen(_ view: LynxView) {
    // First screen reached: a trial update has proven itself.
    if bundleURL == HostTemplateProvider.mainBundle {
      BundleUpdateStore.shared?.confirmLaunch()
    }
  }

  func lynxView(_ view: LynxView, didRecieveError error: NSError) {
    guard (error as? LynxError)?.isFatal == true else { return }
    DispatchQueue.global(qos: .utility).async {
      try? BundleUpdateStore.shared?.failStartup()
    }
  }
}
