import Foundation
import Lynx

/**
 * PomeloFileSystem — app directory and file primitives.
 *
 * All paths are expressed as `area + relative path`; absolute paths and `..`
 * traversal are rejected. iOS does not expose Android-style external dirs.
 */
@objc(PomeloFileSystemModule)
public final class PomeloFileSystemModule: NSObject, LynxModule {
  @objc public static var name: String { "PomeloFileSystem" }

  public override init() {
    super.init()
  }

  @objc public static var methodLookup: [String: String] {
    [
      "getPath": NSStringFromSelector(#selector(PomeloFileSystemModule.getPath(_:_:callback:))),
      "list": NSStringFromSelector(#selector(PomeloFileSystemModule.list(_:_:callback:))),
      "stat": NSStringFromSelector(#selector(PomeloFileSystemModule.stat(_:_:callback:))),
      "exists": NSStringFromSelector(#selector(PomeloFileSystemModule.exists(_:_:callback:))),
      "readText": NSStringFromSelector(#selector(PomeloFileSystemModule.readText(_:_:callback:))),
      "writeText": NSStringFromSelector(#selector(PomeloFileSystemModule.writeText(_:_:_:callback:))),
      "appendText": NSStringFromSelector(#selector(PomeloFileSystemModule.appendText(_:_:_:callback:))),
      "readBase64": NSStringFromSelector(#selector(PomeloFileSystemModule.readBase64(_:_:callback:))),
      "writeBase64": NSStringFromSelector(#selector(PomeloFileSystemModule.writeBase64(_:_:_:callback:))),
      "mkdir": NSStringFromSelector(#selector(PomeloFileSystemModule.mkdir(_:_:callback:))),
      "remove": NSStringFromSelector(#selector(PomeloFileSystemModule.remove(_:_:_:callback:))),
      "move": NSStringFromSelector(#selector(PomeloFileSystemModule.move(_:_:_:callback:))),
      "copy": NSStringFromSelector(#selector(PomeloFileSystemModule.copy(_:_:_:callback:))),
    ]
  }

  @objc(initWithParam:)
  public convenience init(param: Any) { self.init() }

  private let queue = DispatchQueue(label: "org.pomelo.filesystem", qos: .utility)
  private static let maxTextBytes = 8 * 1024 * 1024
  private static let maxBase64Bytes = 16 * 1024 * 1024
  private static let maxListEntries = 1000

  // MARK: - Path resolution

  private enum Area: String {
    case appData, cache, temp, documents, noBackup, external, externalCache
  }

  private struct AreaInfo {
    let url: URL
    let userVisible: Bool
    let purgeable: Bool
    let backedUp: Bool
  }

  private func areaInfo(_ name: String) throws -> AreaInfo {
    guard let area = Area(rawValue: name) else { throw Failure("invalid_area") }
    let fm = FileManager.default
    switch area {
    case .external, .externalCache:
      throw Failure("unsupported_area")
    case .cache:
      let url = try dir(.cachesDirectory)
      return AreaInfo(url: url, userVisible: false, purgeable: true, backedUp: false)
    case .temp:
      return AreaInfo(url: URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true),
                      userVisible: false, purgeable: true, backedUp: false)
    case .documents:
      let url = try dir(.documentDirectory)
      return AreaInfo(url: url, userVisible: true, purgeable: false, backedUp: true)
    case .noBackup:
      let base = try dir(.applicationSupportDirectory)
      let url = base.appendingPathComponent("NoBackup", isDirectory: true)
      try ensureDir(url)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var mutable = url
      try? mutable.setResourceValues(values)
      return AreaInfo(url: url, userVisible: false, purgeable: false, backedUp: false)
    case .appData:
      let url = try dir(.applicationSupportDirectory)
      return AreaInfo(url: url, userVisible: false, purgeable: false, backedUp: true)
    }
  }

  private func dir(_ search: FileManager.SearchPathDirectory) throws -> URL {
    guard let url = FileManager.default.urls(for: search, in: .userDomainMask).first else {
      throw Failure("storage_unavailable")
    }
    try ensureDir(url)
    return url
  }

  private func ensureDir(_ url: URL) throws {
    if !FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
  }

  private func resolve(_ areaName: String, _ relative: String) throws -> (URL, AreaInfo) {
    let info = try areaInfo(areaName)
    let clean = relative.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.hasPrefix("/"), !clean.contains(".."), !clean.contains("\\"),
          !clean.unicodeScalars.contains(where: { $0.value == 0 })
    else { throw Failure("invalid_path") }
    let base = info.url.standardizedFileURL
    let target = base.appendingPathComponent(clean).standardizedFileURL
    let baseReal = base.resolvingSymlinksInPath().path
    let targetReal = target.resolvingSymlinksInPath().path
    guard targetReal == baseReal || targetReal.hasPrefix(baseReal + "/") else {
      throw Failure("path_escape")
    }
    return (target, info)
  }

  private func parent(_ url: URL) throws -> URL {
    let p = url.deletingLastPathComponent()
    try ensureDir(p)
    return p
  }

  // MARK: - JSON helpers

  private struct Failure: Error { let code: String; init(_ code: String) { self.code = code } }

  private func json(_ value: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let text = String(data: data, encoding: .utf8) else { return "{\"ok\":false,\"error\":\"json_failed\"}" }
    return text
  }

  private func ok(_ extra: [String: Any] = [:]) -> String {
    var value = extra; value["ok"] = true; return json(value)
  }

  private func fail(_ error: Error) -> String {
    json(["ok": false, "error": (error as? Failure)?.code ?? "filesystem_failed"])
  }

  private func respond(_ callback: @escaping (String) -> Void, _ work: @escaping () throws -> String) {
    queue.async {
      let result: String
      do { result = try work() } catch { result = self.fail(error) }
      DispatchQueue.main.async { callback(result) }
    }
  }

  // MARK: - Methods

  @objc public func getPath(_ area: String, _ relative: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      let (url, info) = try self.resolve(area, relative)
      if relative.isEmpty { try self.ensureDir(url) }
      return self.ok([
        "path": url.path,
        "userVisible": info.userVisible,
        "purgeable": info.purgeable,
        "backedUp": info.backedUp,
        "writable": FileManager.default.isWritableFile(atPath: url.deletingLastPathComponent().path),
      ])
    }
  }

  @objc public func list(_ area: String, _ relative: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      let (url, _) = try self.resolve(area, relative)
      let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey]
      let items = try FileManager.default.contentsOfDirectory(
        at: url, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])
      let entries = items.prefix(Self.maxListEntries).map { item -> [String: Any] in
        let values = try? item.resourceValues(forKeys: Set(keys))
        return [
          "name": item.lastPathComponent,
          "path": item.path,
          "isDirectory": values?.isDirectory ?? false,
          "size": values?.fileSize ?? 0,
          "modified": values?.contentModificationDate?.timeIntervalSince1970 ?? 0,
        ]
      }
      return self.ok(["entries": entries])
    }
  }

  @objc public func stat(_ area: String, _ relative: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      let (url, _) = try self.resolve(area, relative)
      let values = try url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey])
      return self.ok([
        "name": url.lastPathComponent,
        "path": url.path,
        "isDirectory": values.isDirectory ?? false,
        "size": values.fileSize ?? 0,
        "modified": values.contentModificationDate?.timeIntervalSince1970 ?? 0,
        "readonly": !FileManager.default.isWritableFile(atPath: url.path),
      ])
    }
  }

  @objc public func exists(_ area: String, _ relative: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      let (url, _) = try self.resolve(area, relative)
      return self.ok(["exists": FileManager.default.fileExists(atPath: url.path)])
    }
  }

  @objc public func readText(_ area: String, _ relative: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      let (url, _) = try self.resolve(area, relative)
      let data = try Data(contentsOf: url, options: [.mappedIfSafe])
      guard data.count <= Self.maxTextBytes else { throw Failure("file_too_large") }
      guard let text = String(data: data, encoding: .utf8) else { throw Failure("invalid_utf8") }
      return self.ok(["text": text])
    }
  }

  @objc public func writeText(_ area: String, _ relative: String, _ text: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      let (url, _) = try self.resolve(area, relative)
      let data = Data(text.utf8)
      guard data.count <= Self.maxTextBytes else { throw Failure("file_too_large") }
      _ = try self.parent(url)
      try data.write(to: url, options: [.atomic])
      return self.ok()
    }
  }

  @objc public func appendText(_ area: String, _ relative: String, _ text: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      let (url, _) = try self.resolve(area, relative)
      let data = Data(text.utf8)
      guard data.count <= Self.maxTextBytes else { throw Failure("file_too_large") }
      if !FileManager.default.fileExists(atPath: url.path) {
        _ = try self.parent(url)
        try data.write(to: url, options: [.atomic])
      } else {
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
      }
      return self.ok()
    }
  }

  @objc public func readBase64(_ area: String, _ relative: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      let (url, _) = try self.resolve(area, relative)
      let data = try Data(contentsOf: url, options: [.mappedIfSafe])
      guard data.count <= Self.maxBase64Bytes else { throw Failure("file_too_large") }
      return self.ok(["base64": data.base64EncodedString()])
    }
  }

  @objc public func writeBase64(_ area: String, _ relative: String, _ base64: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      guard let data = Data(base64Encoded: base64), data.count <= Self.maxBase64Bytes else {
        throw Failure("invalid_base64")
      }
      let (url, _) = try self.resolve(area, relative)
      _ = try self.parent(url)
      try data.write(to: url, options: [.atomic])
      return self.ok()
    }
  }

  @objc public func mkdir(_ area: String, _ relative: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      let (url, _) = try self.resolve(area, relative)
      try self.ensureDir(url)
      return self.ok()
    }
  }

  @objc public func remove(_ area: String, _ relative: String, _ recursive: Bool, callback: @escaping (String) -> Void) {
    respond(callback) {
      guard !relative.isEmpty else { throw Failure("invalid_path") }
      let (url, _) = try self.resolve(area, relative)
      guard FileManager.default.fileExists(atPath: url.path) else { return self.ok() }
      let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
      if isDir && !recursive {
        let children = try FileManager.default.contentsOfDirectory(atPath: url.path)
        guard children.isEmpty else { throw Failure("directory_not_empty") }
      }
      try FileManager.default.removeItem(at: url)
      return self.ok()
    }
  }

  @objc public func move(_ area: String, _ from: String, _ to: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      guard !from.isEmpty, !to.isEmpty else { throw Failure("invalid_path") }
      let (source, _) = try self.resolve(area, from)
      let (target, _) = try self.resolve(area, to)
      _ = try self.parent(target)
      try FileManager.default.moveItem(at: source, to: target)
      return self.ok()
    }
  }

  @objc public func copy(_ area: String, _ from: String, _ to: String, callback: @escaping (String) -> Void) {
    respond(callback) {
      guard !from.isEmpty, !to.isEmpty else { throw Failure("invalid_path") }
      let (source, _) = try self.resolve(area, from)
      let (target, _) = try self.resolve(area, to)
      _ = try self.parent(target)
      try FileManager.default.copyItem(at: source, to: target)
      return self.ok()
    }
  }
}
