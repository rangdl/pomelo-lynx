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

  func loadTemplate(withUrl url: String!, onComplete callback: LynxTemplateLoadBlock!) {
    Log.info("template", "loadTemplate url=\(url ?? "<nil>")")
    guard let url,
      let path = Bundle.main.path(forResource: url, ofType: "bundle")
    else {
      Log.error("template", "template \(url ?? "<nil>").bundle NOT FOUND in app resources")
      callback(nil, NSError(
        domain: "org.pomelo.lynx",
        code: 404,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Template \(url ?? "<nil>").bundle is missing from app resources — "
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
}
