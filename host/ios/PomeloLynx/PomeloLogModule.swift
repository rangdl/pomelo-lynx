import Foundation
import UIKit

/**
 * Lynx native module `NativeModules.PomeloLog` — the JS face of `LogStore`,
 * plus the native→JS push channel the log page lives on.
 *
 * Event contract (mirrors `PomeloUpdate.progress`):
 *   - push:  `sendGlobalEvent("PomeloLog.append", [entriesJSON])` — the array's
 *            first element is the listener's first argument, so JS gets the
 *            JSON string directly. `LogStore` batches for 150 ms first.
 *   - push is **off by default**: the page flips it with `setPushEnabled(true)`
 *    on mount (so nobody is listening ⇒ nothing is sent) and off on unmount.
 *
 * The sink is installed by whichever module instance is created last — a page
 * reload builds a new `LynxContext`, and events must follow it (same rule as
 * songloft's `SongloftAudioModule.sink`).
 */
final class PomeloLogModule: NSObject, LynxContextModule {
  private weak var context: LynxContext?

  @objc static var name: String { "PomeloLog" }

  @objc static var methodLookup: [String: String] {
    [
      "append": NSStringFromSelector(#selector(PomeloLogModule.append(_:))),
      "getRecent": NSStringFromSelector(#selector(PomeloLogModule.getRecent(_:callback:))),
      "setPushEnabled": NSStringFromSelector(#selector(PomeloLogModule.setPushEnabled(_:))),
      "setLevel": NSStringFromSelector(#selector(PomeloLogModule.setLevel(_:callback:))),
      "getLevel": NSStringFromSelector(#selector(PomeloLogModule.getLevel(_:))),
      "setRetentionDays": NSStringFromSelector(#selector(PomeloLogModule.setRetentionDays(_:callback:))),
      "getRetentionDays": NSStringFromSelector(#selector(PomeloLogModule.getRetentionDays(_:))),
      "shareRecent": NSStringFromSelector(#selector(PomeloLogModule.shareRecent(_:callback:))),
    ]
  }

  @objc(initWithParam:)
  convenience init(param: Any) { self.init(context: nil) }
  @objc(initWithLynxContext:)
  convenience init(lynxContext context: LynxContext) { self.init(context: context) }
  @objc(initWithLynxContext:WithParam:)
  convenience init(lynxContext context: LynxContext, withParam param: Any) {
    self.init(context: context)
  }
  override init() { super.init() }

  private init(context: LynxContext?) {
    self.context = context
    super.init()
    // Newest instance owns delivery; `weak self` keeps a dead instance from
    // holding the channel open after a reload.
    LogStore.shared.setSink { [weak self] entries in
      guard let self else { return }
      let json = LogStore.encode(entries)
      DispatchQueue.main.async {
        self.context?.sendGlobalEvent("PomeloLog.append", withParams: [json])
      }
    }
  }

  // MARK: - Methods (JS-facing)

  /// Bulk write of JS-side entries (`logger`/`console` sink). Fire-and-forget:
  /// confirmation reaches the page through the push event when enabled, keyed
  /// by the `entryId` JS generated.
  @objc func append(_ entriesJSON: String) {
    LogStore.shared.appendFromJS(entriesJSON)
  }

  @objc func getRecent(_ limit: Int, callback: @escaping (String) -> Void) {
    LogStore.shared.recent(limit: limit, completion: callback)
  }

  @objc func setPushEnabled(_ enabled: Bool) {
    LogStore.shared.setPushEnabled(enabled)
  }

  @objc func setLevel(_ name: String, callback: @escaping (Any) -> Void) {
    LogStore.shared.setLevel(name)
    callback(LogStore.shared.level.name)
  }

  @objc func getLevel(_ callback: @escaping (Any) -> Void) {
    callback(LogStore.shared.level.name)
  }

  @objc func setRetentionDays(_ days: Int, callback: @escaping (Any) -> Void) {
    LogStore.shared.setRetention(days)
    callback(LogStore.shared.retention)
  }

  @objc func getRetentionDays(_ callback: @escaping (Any) -> Void) {
    callback(LogStore.shared.retention)
  }

  /// Exports the newest `limit` records as plain text through the system
  /// share sheet (Files/AirDrop/Messages — the iOS answer to "导出").
  @objc func shareRecent(_ limit: Int, callback: @escaping (String) -> Void) {
    LogStore.shared.recentText(limit: limit) { text in
      DispatchQueue.main.async {
        guard
          let scene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
          let root = scene.windows.first(where: \.isKeyWindow)?.rootViewController
        else {
          callback("{\"error\":\"no_window\"}")
          return
        }
        var top = root
        while let presented = top.presentedViewController { top = presented }
        let sheet = UIActivityViewController(activityItems: [text], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
          popover.sourceView = top.view
          popover.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 1, width: 1, height: 1)
          popover.permittedArrowDirections = []
        }
        top.present(sheet, animated: true)
        callback("{}")
      }
    }
  }
}
