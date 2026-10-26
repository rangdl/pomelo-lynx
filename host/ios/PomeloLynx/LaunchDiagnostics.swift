import UIKit

/// 黑屏排查用:原生层自绘诊断浮层。直接挂在 rootVC.view 顶层(独立
/// UIWindow 不关联 windowScene 在 iOS 13+ 真机上不渲染),事件链以固定
/// 顺序展示最近 12 条,便于截屏回报。
enum LaunchDiagnostics {
  private static let lock = NSLock()
  private static var lines: [String] = []
  private static var label: UILabel?

  static func log(_ text: String) {
    lock.lock(); defer { lock.unlock() }
    let stamp = String(format: "%.2f", ProcessInfo.processInfo.systemUptime)
    lines.append("\(stamp)  \(text)")
    if lines.count > 12 { lines.removeFirst(lines.count - 12) }
    NSLog("[PomeloLynx] \(text)")
    let snapshot = lines.joined(separator: "\n")
    DispatchQueue.main.async {
      let label = ensureOverlay()
      label?.text = snapshot
      label?.superview?.bringSubviewToFront(label!)
    }
  }

  private static func ensureOverlay() -> UILabel? {
    guard label == nil,
      let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
      let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController?.view
    else { return nil }
    let panel = UIView(frame: CGRect(x: 8, y: 60, width: root.bounds.width - 16, height: 480))
    panel.backgroundColor = UIColor(white: 0, alpha: 0.85)
    panel.layer.cornerRadius = 8
    let label = UILabel()
    label.frame = panel.bounds.insetBy(dx: 10, dy: 10)
    label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    label.font = .monospacedSystemFont(ofSize: 10, weight: .regular)
    label.textColor = .green
    label.numberOfLines = 0
    panel.addSubview(label)
    root.addSubview(panel)
    root.bringSubviewToFront(panel)
    self.label = label
    return label
  }
}
