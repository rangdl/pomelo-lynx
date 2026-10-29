import Foundation
import UIKit
import UniformTypeIdentifiers

/**
 * Lynx native module `NativeModules.PomeloPlatform` — iOS 侧的宿主平台基础能力。
 *
 * 方法名与 `src/native/platform.ts` 逐字对应:
 *   - `openURL` / `setKeepScreenOn`            写,fire-and-forget
 *   - `setClipboard` / `setClipboardWithResult` 剪贴板,后者用 Callback 回报结果
 *   - `shareFile`                              系统分享面板,Callback 回报结果
 *   - `pickAndUploadFile`                      选择文件并 multipart 上传,Callback 回报 `[error, body]`
 *
 * Lynx 模块方法可能运行在 JS 线程,所有 UIKit / 剪贴板 / 分享面板操作都
 * 切到主线程。回调约定与 JS facade 一致:成功 `nil`,失败为非空字符串错误码。
 */
final class PomeloPlatformModule: NSObject, LynxModule, UIDocumentPickerDelegate {
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
      "pickAndUploadFile": NSStringFromSelector(
        #selector(
          PomeloPlatformModule.pickAndUploadFile(
            _:fieldName:mimeType:callback:))),
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
      callback?(NSNull())
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
        if let error {
          callback(error.localizedDescription)
        } else {
          callback(NSNull())
        }
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

  // MARK: - 选择文件并上传

  /// 单次上传请求:选择器关闭后仍需要它把结果送回 JS。
  private struct PendingUpload {
    let uploadUrl: String
    let fieldName: String
    let mimeType: String
    let callback: (Any) -> Void
  }

  private var pendingUpload: PendingUpload?

  /// 回调形状固定为 `[error, body]`(与 Android 后续实现、JS facade 逐字对齐)。
  /// 空 error 表示成功;body 是服务器响应文本。
  @objc func pickAndUploadFile(
    _ uploadUrl: String,
    fieldName: String,
    mimeType: String,
    callback: @escaping (Any) -> Void
  ) {
    guard Self.isHTTPURL(uploadUrl) else {
      callback(["upload_invalid_url", NSNull()] as NSArray)
      return
    }
    guard fieldName.range(
      of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil
    else {
      callback(["upload_invalid_field", NSNull()] as NSArray)
      return
    }
    guard mimeType.range(
      of: "^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$", options: .regularExpression) != nil
    else {
      callback(["upload_invalid_mime_type", NSNull()] as NSArray)
      return
    }

    DispatchQueue.main.async {
      guard let presenter = Self.topViewController() else {
        callback(["upload_unavailable", NSNull()] as NSArray)
        return
      }
      // 新请求覆盖旧请求;旧请求按取消回调,避免 JS 永远等待。
      self.pendingUpload?.callback(["upload_cancelled", NSNull()] as NSArray)
      self.pendingUpload = PendingUpload(
        uploadUrl: uploadUrl,
        fieldName: fieldName,
        mimeType: mimeType,
        callback: callback)

      let type = UTType(mimeType: mimeType) ?? .data
      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: [type], asCopy: true)
      picker.allowsMultipleSelection = false
      picker.delegate = self
      presenter.present(picker, animated: true)
    }
  }

  func documentPicker(
    _ controller: UIDocumentPickerViewController,
    didPickDocumentsAt urls: [URL]
  ) {
    guard let request = pendingUpload else { return }
    pendingUpload = nil
    guard let url = urls.first else {
      request.callback(["upload_read_failed", NSNull()] as NSArray)
      return
    }
    let accessed = url.startAccessingSecurityScopedResource()
    defer {
      if accessed { url.stopAccessingSecurityScopedResource() }
    }
    do {
      let data = try Data(contentsOf: url)
      guard !data.isEmpty else {
        request.callback(["upload_empty_file", NSNull()] as NSArray)
        return
      }
      guard data.count <= Self.maxUploadBytes else {
        request.callback(["upload_too_large", NSNull()] as NSArray)
        return
      }
      upload(data: data, fileName: url.lastPathComponent, request: request)
    } catch {
      request.callback(["upload_read_failed", NSNull()] as NSArray)
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pendingUpload?.callback(["upload_cancelled", NSNull()] as NSArray)
    pendingUpload = nil
  }

  private func upload(data: Data, fileName: String, request: PendingUpload) {
    guard let url = URL(string: request.uploadUrl) else {
      request.callback(["upload_invalid_url", NSNull()] as NSArray)
      return
    }
    let boundary = "----PomeloBoundary\(UUID().uuidString)"
    let safeName = Self.safeFileName(fileName)
    var body = Data()
    Self.appendUTF8("--\(boundary)\r\n", to: &body)
    Self.appendUTF8(
      "Content-Disposition: form-data; name=\"\(request.fieldName)\"; filename=\"\(safeName)\"\r\n",
      to: &body)
    Self.appendUTF8("Content-Type: \(request.mimeType)\r\n\r\n", to: &body)
    body.append(data)
    Self.appendUTF8("\r\n--\(boundary)--\r\n", to: &body)

    var http = URLRequest(url: url)
    http.httpMethod = "POST"
    http.timeoutInterval = 60
    http.setValue(
      "multipart/form-data; boundary=\(boundary)",
      forHTTPHeaderField: "Content-Type")
    http.httpBody = body

    URLSession.shared.dataTask(with: http) { responseData, response, error in
      DispatchQueue.main.async {
        if let error {
          request.callback([error.localizedDescription, NSNull()] as NSArray)
          return
        }
        guard let httpResponse = response as? HTTPURLResponse else {
          request.callback(["upload_no_response", NSNull()] as NSArray)
          return
        }
        guard (200...299).contains(httpResponse.statusCode) else {
          request.callback(
            ["upload_http_\(httpResponse.statusCode)", NSNull()] as NSArray)
          return
        }
        let responseBody =
          responseData.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        guard responseBody.utf8.count <= Self.maxResponseBytes else {
          request.callback(["upload_response_too_large", NSNull()] as NSArray)
          return
        }
        request.callback([NSNull(), responseBody] as NSArray)
      }
    }.resume()
  }

  private static func isHTTPURL(_ value: String) -> Bool {
    guard let parsed = URL(string: value),
      let scheme = parsed.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      parsed.host != nil
    else { return false }
    return true
  }

  /// multipart 头部里的文件名只保留安全字符,避免引号/换行破坏请求体。
  private static func safeFileName(_ value: String) -> String {
    let cleaned = value.replacingOccurrences(
      of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
    let name = String(cleaned.prefix(128))
    return name.isEmpty ? "upload.bin" : name
  }

  private static func appendUTF8(_ value: String, to data: inout Data) {
    if let encoded = value.data(using: .utf8) { data.append(encoded) }
  }

  /// 当前 key window 上最顶层的控制器;分享面板必须挂在它上面。
  private static func topViewController() -> UIViewController? {    let scenes = UIApplication.shared.connectedScenes.compactMap {
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
  private static let maxUploadBytes = 32 * 1024 * 1024
  private static let maxResponseBytes = 1024 * 1024
}
