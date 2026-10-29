import Foundation
import UIKit

/**
 * Lynx native module `NativeModules.PomeloPlatform` — iOS 侧的宿主平台基础能力。
 *
 * 方法名与 `src/native/platform.ts` 逐字对应:
 *   - `openURL` / `setKeepScreenOn`            写,fire-and-forget
 *   - `setClipboard` / `setClipboardWithResult` 剪贴板,后者用 Callback 回报结果
 *   - `shareFile`                              系统分享面板,Callback 回报结果
 *
 * Lynx 模块方法可能运行在 JS 线程,所有 UIKit / 剪贴板 / 分享面板操作都
 * 切到主线程。回调约定与 JS facade 一致:成功 `nil`,失败为非空字符串错误码。
 */
final class PomeloPlatformModule: NSObject, LynxModule {
  @objc static var name: String { "PomeloPlatform" }

  @objc static var methodLookup: [String: String] {
    [
      "openURL": NSStringFromSelector(#selector(PomeloPlatformModule.openURL(_:))),
      "setKeepScreenOn": NSStringFromSelector(
        #selector(PomeloPlatformModule.setKeepScreenOn(_:))),
      "setClipboard": NSStringFromSelector(
        #selector(PomeloPlatformModule.setClipboard(_:))),
      "setClipboardWithResult": NSStringFromSelector(
        #selector(PomeloPlatformModule.setClipboardWithResult(_:callback:))),
      "shareFile": NSStringFromSelector(
        #selector(PomeloPlatformModule.shareFile(_:fileName:mimeType:callback:))),
    ]
  }

  @objc(initWithParam:)
  convenience init(param: Any) { self.init() }

  // MARK: - 打开 URL

  /// 只接受 http/https,避免把 `javascript:` / `file:` 交给系统。
  @objc func openURL(_ url: String) {
    guard let parsed = URL(string: url),
      let scheme = parsed.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      parsed.host != nil
    else {
      Log.warn("platform", "openURL rejected unsupported url")
      return
    }
    DispatchQueue.main.async {
      UIApplication.shared.open(parsed, options: [:]) { opened in
        if !opened { Log.warn("platform", "openURL could not open") }
      }
    }
  }

  // MARK: - 屏幕常亮

  /// 进程级开关;App 进入后台时系统会自行恢复休眠。
  @objc func setKeepScreenOn(_ enabled: Bool) {
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = enabled
    }
  }

  // MARK: - 剪贴板

  @objc func setClipboard(_ text: String) {
    writeClipboard(text, callback: nil)
  }

  @objc func setClipboardWithResult(_ text: String, callback: @escaping (Any) -> Void) {
    writeClipboard(text, callback: callback)
  }

  private func writeClipboard(_ text: String, callback: ((Any) -> Void)?) {
    DispatchQueue.main.async {
      UIPasteboard.general.string = text
      callback?(nil)
    }
  }

  // MARK: - 分享文件

  /// 把 base64 写入临时目录后调起分享面板。文件名和 MIME 在 JS 侧已校验,
  /// 这里再做一次纵深防御;分享结束后删除临时文件。
  @objc func shareFile(
    _ base64: String,
    fileName: String,
    mimeType: String,
    callback: @escaping (Any) -> Void
  ) {
    guard !base64.isEmpty, base64.count <= Self.maxBase64Chars else {
      callback("share_invalid_payload")
      return
    }
    guard fileName.range(
      of: "^[A-Za-z0-9._-]{1,128}$", options: .regularExpression) != nil
    else {
      callback("share_invalid_file_name")
      return
    }
    guard mimeType.range(
      of: "^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$", options: .regularExpression) != nil
    else {
      callback("share_invalid_mime_type")
      return
    }
    guard let data = Data(base64Encoded: base64), !data.isEmpty else {
      callback("share_invalid_payload")
      return
    }
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent(fileName)
    do {
      try data.write(to: url, options: .atomic)
    } catch {
      callback("share_write_failed")
      return
    }

    DispatchQueue.main.async {
      guard let presenter = Self.topViewController() else {
        callback("share_unavailable")
        return
      }
      let activity = UIActivityViewController(
        activityItems: [url], applicationActivities: nil)
      activity.completionWithItemsHandler = { _, _, _, error in
        try? FileManager.default.removeItem(at: url)
        callback(error?.localizedDescription)
      }
      if let popover = activity.popoverPresentationController {
        popover.sourceView = presenter.view
        popover.sourceRect = CGRect(
          x: presenter.view.bounds.midX,
          y: presenter.view.bounds.midY,
          width: 0,
          height: 0)
        popover.permittedArrowDirections = []
      }
      presenter.present(activity, animated: true)
    }
  }

  /// 当前 key window 上最顶层的控制器;分享面板必须挂在它上面。
  private static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap {
      $0 as? UIWindowScene
    }
    let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }
    var top = window?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }

  private static let maxBase64Chars = 16 * 1024 * 1024 * 4 / 3 + 4
}
