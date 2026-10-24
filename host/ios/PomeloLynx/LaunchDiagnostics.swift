import UIKit

/// 黑屏排查用:原生层自绘诊断浮层。LynxView 起不来/JS 崩了它也能显示,
/// 事件链以固定顺序展示最近 12 条,便于截屏回报。
enum LaunchDiagnostics {
  private static let lock = NSLock()
  private static var lines: [String] = []
  private static var label: UILabel?
  private static var window: UIWindow?

  static func log(_ text: String) {
    dispatchPrecondition(condition: .onQueue(.main))
    let stamp = String(format: "%.2f", ProcessInfo.processInfo.systemUptime)
    lines.append("\(stamp)  \(text)")
    if lines.count > 12 { lines.removeFirst(lines.count - 12) }
    ensureOverlay()
    label?.text = lines.joined(separator: "\n")
    NSLog("[PomeloLynx] \(text)")
  }

  private static func ensureOverlay() {
    guard label == nil else { return }
    let window = UIWindow(frame: CGRect(x: 0, y: 60, width: UIScreen.main.bounds.width, height: 520))
    window.windowLevel = .alert + 1
    window.backgroundColor = UIColor(white: 0, alpha: 0.85)
    let label = UILabel()
    label.frame = window.bounds.insetBy(dx: 10, dy: 10)
    label.font = .monospacedSystemFont(ofSize: 10, weight: .regular)
    label.textColor = .green
    label.numberOfLines = 0
    window.addSubview(label)
    window.isHidden = false
    window.makeKeyAndVisible()
    self.window = window
    self.label = label
  }
}
