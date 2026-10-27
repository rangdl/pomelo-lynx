import Foundation

/**
 * Reads a Lynx template bundle out of app resources — the iOS counterpart of
 * Android's `HostTemplateProvider` (which reads the same file names from
 * `assets/`). `url` is the resource base name (e.g. `main.lynx`); the
 * `.bundle` extension is appended here, so the embedded artifact is
 * `main.lynx.bundle`.
 *
 * Local asset loading follows the official `integrating-lynx-demo-projects`
 * ios/HelloLynxSwift provider with one addition: the hot-update selection
 * hook (mirrors the Android provider):
 *
 *   1. `BundleUpdateStore.beginLaunch()` — a downloaded update pending trial,
 *      or the active one, when the disk state says so.
 *   2. Fall back to the embedded resources — always available, the rollback
 *      floor.
 */
class HostTemplateProvider: NSObject, LynxTemplateProvider, LynxTemplateResourceFetcher {
  static let mainBundle = "main.lynx"
  static let probeBundle = "probe.lynx"

  func fetchTemplate(
    _ request: LynxResourceRequest,
    onComplete callback: @escaping LynxTemplateResourceCompletionBlock
  ) {
    loadTemplate(withUrl: request.url) { value, error in
      guard let data = value as? Data, error == nil else {
        callback(nil, error)
        return
      }
      callback(PomeloTemplateResourceFromData(data), nil)
    }
  }

  func fetchSSRData(
    _ request: LynxResourceRequest,
    onComplete callback: @escaping LynxSSRResourceCompletionBlock
  ) {
    callback(nil, NSError(
      domain: "org.pomelo.lynx",
      code: 501,
      userInfo: [NSLocalizedDescriptionKey: "SSR data is not supported"]
    ))
  }

  func loadTemplate(
    withUrl url: String!, onComplete callback: (@escaping LynxTemplateLoadBlock)!
  ) {
    Log.info("template", "loadTemplate url=\(url ?? "<nil>")")
    guard let url else {
      Log.error("template", "template url is nil")
      callback(nil, NSError(
        domain: "org.pomelo.lynx",
        code: 400,
        userInfo: [NSLocalizedDescriptionKey: "Template url is nil"]
      ))
      return
    }
    // Dev-server 分支:URL 是完整 http(s) 地址时直接网络拉取(实时开发,
    // rspeedy dev server 增量编译后 reload 即拿到新 bundle)。失败回落
    // 内嵌资源——坏 URL 不能让 app 永远打不开。
    if url.hasPrefix("http://") || url.hasPrefix("https://") {
      Self.fetchRemote(url, callback: callback)
      return
    }
    guard let path = Bundle.main.path(forResource: url, ofType: "bundle") else {
      Log.error("template", "template \(url).bundle NOT FOUND in app resources")
      callback(nil, NSError(
        domain: "org.pomelo.lynx",
        code: 404,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Template \(url).bundle is missing from app resources — "
            + "run `pnpm build:host` (it copies dist/*.lynx.bundle).",
        ]
      ))
      return
    }
    Log.debug("template", "template path=\(path)")
    do {
      if url == Self.mainBundle, let updates = BundleUpdateStore.shared {
        Log.info("update", "update store available; beginLaunch…")
        do {
          if let candidate = try updates.beginLaunch() {
            Log.info("update", "using UPDATE bundle (\(candidate.count)B)")
            callback(candidate, nil)
            return
          }
          Log.info("update", "no update; fallback embedded")
        } catch {
          Log.error("update", "beginLaunch failed: \(error)")
          try? updates.failStartup()
        }
      } else {
        Log.warn("update", "update store unavailable (builtin native-host or init failure)")
      }
      let data = try Data(contentsOf: URL(fileURLWithPath: path))
      Log.info("template", "embedded \(data.count)B → callback")
      callback(data, nil)
    } catch {
      Log.error("template", "read template failed: \(error.localizedDescription)")
      callback(nil, error)
    }
  }

  /**
   * Dev-server fetch: GET the bundle over HTTP with a hard timeout. On
   * failure the error carries the underlying cause so the log page can show
   * why the dev server was unreachable (wrong IP, server down, …). No retry:
   * the user reloads explicitly from the settings page.
   */
  private static func fetchRemote(
    _ urlString: String, callback: (@escaping LynxTemplateLoadBlock)!
  ) {
    guard let url = URL(string: urlString) else {
      Log.error("devserver", "invalid dev URL: \(urlString)")
      callback(nil, NSError(
        domain: "org.pomelo.lynx",
        code: 400,
        userInfo: [NSLocalizedDescriptionKey: "无效的开发服务器 URL"]
      ))
      return
    }
    Log.info("devserver", "fetching \(urlString)")
    var request = URLRequest(url: url)
    request.timeoutInterval = 15
    URLSession.shared.dataTask(with: request) { data, response, error in
      if let error {
        Log.error("devserver", "fetch failed: \(error.localizedDescription)")
        callback(nil, error)
        return
      }
      guard let http = response as? HTTPURLResponse, http.statusCode == 200,
        let data, !data.isEmpty
      else {
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        Log.error("devserver", "fetch returned status \(status)")
        callback(nil, NSError(
          domain: "org.pomelo.lynx",
          code: status,
          userInfo: [NSLocalizedDescriptionKey: "开发服务器返回 HTTP \(status)"]
        ))
        return
      }
      Log.info("devserver", "fetched \(data.count)B → callback")
      callback(data, nil)
    }.resume()
  }
}
