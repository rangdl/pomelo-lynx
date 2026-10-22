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
    guard let url,
      let path = Bundle.main.path(forResource: url, ofType: "bundle")
    else {
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
    do {
      if url == Self.mainBundle, let updates = BundleUpdateStore.shared {
        do {
          if let candidate = try updates.beginLaunch() {
            callback(candidate, nil)
            return
          }
        } catch { try? updates.failStartup() }
      }
      let data = try Data(contentsOf: URL(fileURLWithPath: path))
      callback(data, nil)
    } catch {
      NSLog("[PomeloLynx] failed to read template %@: %@", path, error.localizedDescription)
      callback(nil, error)
    }
  }
}
