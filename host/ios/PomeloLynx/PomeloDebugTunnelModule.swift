import Foundation

/**
 * Lynx native module `NativeModules.PomeloDebugTunnel`.
 *
 * Exposes the runtime state of the DebugRouter WS reverse tunnel so the
 * settings page can show 已连接/连接中/未连接 without Console.app, and lets the
 * page retry immediately instead of killing the app. The heavy lifting stays
 * in `DevToolBoot.m` (runtime-resolved, compiles in both pod graphs).
 */
final class PomeloDebugTunnelModule: NSObject, LynxModule {
  @objc static var name: String { "PomeloDebugTunnel" }

  @objc static var methodLookup: [String: String] {
    [
      "getStatus": NSStringFromSelector(#selector(PomeloDebugTunnelModule.getStatus(_:))),
      "reconnect": NSStringFromSelector(#selector(PomeloDebugTunnelModule.reconnect(_:))),
      "disconnect": NSStringFromSelector(#selector(PomeloDebugTunnelModule.disconnect(_:))),
    ]
  }

  @objc(initWithParam:)
  convenience init(param: Any) {
    self.init()
  }

  @objc func getStatus(_ callback: @escaping (Any) -> Void) {
    callback(PomeloDebugTunnelStatus())
  }

  @objc func reconnect(_ callback: @escaping (Any) -> Void) {
    PomeloEnsureDevToolEnabled()
    PomeloDebugTunnelConnect()
    callback(PomeloDebugTunnelStatus())
  }

  @objc func disconnect(_ callback: @escaping (Any) -> Void) {
    PomeloDebugTunnelDisconnect()
    callback(PomeloDebugTunnelStatus())
  }
}
