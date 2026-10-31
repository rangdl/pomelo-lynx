import Foundation
import Lynx
import UIKit

/**
 * Host-only capabilities: dev server controls and UIKit appearance.
 *
 * These methods need the concrete `ViewController`; keeping them out of the
 * reusable platform package avoids a package -> host dependency.
 */
@objc(PomeloHostModule)
final class PomeloHostModule: NSObject, LynxModule {
  @objc static var name: String { "PomeloHost" }

  @objc static var methodLookup: [String: String] {
    [
      "applyDevServer": NSStringFromSelector(#selector(PomeloHostModule.applyDevServer(_:callback:))),
      "clearDevServer": NSStringFromSelector(#selector(PomeloHostModule.clearDevServer(_:))),
      "reloadBundle": NSStringFromSelector(#selector(PomeloHostModule.reloadBundle(_:))),
      "probeDevServer": NSStringFromSelector(#selector(PomeloHostModule.probeDevServer(_:callback:))),
      "setAppearanceMode": NSStringFromSelector(#selector(PomeloHostModule.setAppearanceMode(_:))),
      "setEdgeBackEnabled": NSStringFromSelector(#selector(PomeloHostModule.setEdgeBackEnabled(_:))),
    ]
  }

  @objc(initWithParam:)
  convenience init(param: Any) { self.init() }

  @objc func applyDevServer(_ url: String, callback: @escaping (Any) -> Void) {
    guard Self.isDevServerURL(url) else {
      callback("devserver_invalid_url")
      return
    }
    DispatchQueue.main.async {
      guard let host = Self.hostViewController() else {
        callback("devserver_no_host")
        return
      }
      host.applyDevServer(url) { error in
        if let error {
          callback(error)
        } else {
          callback(NSNull())
        }
      }
    }
  }

  @objc func clearDevServer(_ callback: @escaping (Any) -> Void) {
    DispatchQueue.main.async {
      guard let host = Self.hostViewController() else {
        callback("devserver_no_host")
        return
      }
      host.clearDevServer {
        callback(NSNull())
      }
    }
  }

  @objc func reloadBundle(_ callback: @escaping (Any) -> Void) {
    DispatchQueue.main.async {
      guard let host = Self.hostViewController() else {
        callback("devserver_no_host")
        return
      }
      host.reloadCurrentBundle { error in
        if let error {
          callback(error)
        } else {
          callback(NSNull())
        }
      }
    }
  }

  @objc func probeDevServer(_ urlString: String, callback: @escaping (Any) -> Void) {
    guard Self.isDevServerURL(urlString), let url = URL(string: urlString) else {
      callback(["devserver_invalid_url", -1] as NSArray)
      return
    }
    var request = URLRequest(url: url)
    request.httpMethod = "HEAD"
    request.timeoutInterval = 4
    request.cachePolicy = .reloadIgnoringLocalCacheData
    URLSession.shared.dataTask(with: request) { _, response, error in
      DispatchQueue.main.async {
        if let error {
          callback([error.localizedDescription, -1] as NSArray)
          return
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        if (200...399).contains(status) {
          callback([NSNull(), status] as NSArray)
        } else {
          callback(["devserver_http_\(status)", status] as NSArray)
        }
      }
    }.resume()
  }

  @objc func setEdgeBackEnabled(_ enabled: Bool) {
    DispatchQueue.main.async {
      Self.hostViewController()?.setEdgeBackEnabled(enabled)
    }
  }

  @objc func setAppearanceMode(_ mode: String) {
    guard mode == "system" || mode == "light" || mode == "dark" else {
      return
    }
    let prefs = UserDefaults(suiteName: "pomelo_prefs") ?? .standard
    prefs.set(mode, forKey: "appearance_mode")
    DispatchQueue.main.async {
      Self.hostViewController()?.applyAppearanceMode(mode)
    }
  }

  private static func isHTTPURL(_ value: String) -> Bool {
    guard let parsed = URL(string: value),
      let scheme = parsed.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      parsed.host != nil
    else { return false }
    return true
  }

  private static func isDevServerURL(_ value: String) -> Bool {
    guard isHTTPURL(value), let parsed = URL(string: value) else { return false }
    return parsed.path.hasSuffix(".lynx.bundle")
  }

  private static func hostViewController() -> ViewController? {
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene,
        let root = windowScene.windows.first(where: { $0.isKeyWindow })?
          .rootViewController
      else { continue }
      if let host = root as? ViewController { return host }
    }
    return nil
  }
}
