import Foundation

/// Log levels — the numeric contract with `src/core/log/levels.ts`
/// (verbose=0 … error=4). Anything below the stored level is dropped.
enum LogLevel: Int, Comparable {
  case verbose = 0
  case debug = 1
  case info = 2
  case warn = 3
  case error = 4

  static func < (lhs: LogLevel, rhs: LogLevel) -> Bool { lhs.rawValue < rhs.rawValue }

  var letter: String {
    switch self {
    case .verbose: return "V"
    case .debug: return "D"
    case .info: return "I"
    case .warn: return "W"
    case .error: return "E"
    }
  }

  var name: String {
    switch self {
    case .verbose: return "verbose"
    case .debug: return "debug"
    case .info: return "info"
    case .warn: return "warn"
    case .error: return "error"
    }
  }

  init?(name: String) {
    switch name {
    case "verbose": self = .verbose
    case "debug": self = .debug
    case "info": self = .info
    case "warn": self = .warn
    case "error": self = .error
    default: return nil
    }
  }

  init?(letter: String) {
    switch letter {
    case "V": self = .verbose
    case "D": self = .debug
    case "I": self = .info
    case "W": self = .warn
    case "E": self = .error
    default: return nil
    }
  }
}

/// One log record. `entryId` is the global dedupe key shared with JS: entries
/// enter the list from three doors (getRecent snapshot / push event / the JS
/// local optimistic buffer) and the page merges them by this id.
struct LogEntry {
  let entryId: String
  /// Epoch milliseconds — `Date.now()` on the JS side, identical unit here.
  let ts: Int64
  let level: LogLevel
  let tag: String
  let msg: String

  var jsonDict: [String: Any] {
    [
      "entryId": entryId,
      "ts": NSNumber(value: ts),
      "level": level.rawValue,
      "tag": tag,
      "msg": msg,
    ]
  }
}

/// Native-side logging facade. Replaces the black-screen `LaunchDiagnostics`
/// overlay: every point that used to print `NSLog` + overlay line now goes
/// through here — one call, three sinks (memory ring, daily file, NSLog).
///
/// `Log.*` is safe from any thread; IO happens on a private serial queue.
enum Log {
  static func verbose(_ tag: String, _ msg: String) { LogStore.shared.write(.verbose, tag, msg) }
  static func debug(_ tag: String, _ msg: String) { LogStore.shared.write(.debug, tag, msg) }
  static func info(_ tag: String, _ msg: String) { LogStore.shared.write(.info, tag, msg) }
  static func warn(_ tag: String, _ msg: String) { LogStore.shared.write(.warn, tag, msg) }
  static func error(_ tag: String, _ msg: String) { LogStore.shared.write(.error, tag, msg) }
}

/**
 * File + memory log store with a push-out channel.

 * Layout (mirrors the JS `LoggerCore` contract):

     write()/appendFromJS() ──► level filter ──► ring(500)
                                             └─► appendToFile (daily, 5 MB cap)
                                             └─► pending ──150 ms window──► sink ──►
                                                 (only while pushEnabled)   sendGlobalEvent

 * - Files live in `Documents/pomelo-logs/app-YYYY-MM-DD.log` so the Files app
 *   can hand them out (`UIFileSharingEnabled` in Info.plist).
 * - Level/retention persist in UserDefaults (`pomelo_log.*`), so the log page
 *   can flip them and the change survives restarts.
 * - `setSink` is owned by the newest `PomeloLogModule` instance (same pattern
 *   as songloft's `SongloftAudioModule`): a reloaded page must not be fed by
 *   a stale `LynxContext`.
 */
final class LogStore {
  static let shared = LogStore()

  static let ringCapacity = 500
  static let maxRecentLimit = 500
  /// Aggregate window for the push event — a busy `console.debug` storm must
  /// not turn into one bridge event per line.
  static let flushWindow: DispatchTimeInterval = .milliseconds(150)
  static let maxFileBytes: Int64 = 5 * 1024 * 1024

  static let defaultsLevelKey = "pomelo_log.level"
  static let defaultsRetentionKey = "pomelo_log.retentionDays"
  static let defaultRetentionDays = 7

  private let io = DispatchQueue(label: "org.pomelo.logstore")
  private let dir: URL

  // All state below is only touched on `io`.
  private var ring: [LogEntry] = []
  private var pending: [LogEntry] = []
  private var flushScheduled = false
  private var sink: (([LogEntry]) -> Void)?
  private var pushEnabled = false
  private var handle: FileHandle?
  private var handleName: String = ""
  private var handleBytes: Int64 = 0

  /// Cached mirror of the UserDefaults value — a `write()` hit must be cheap.
  private let levelLock = NSLock()
  private var storedLevel: LogLevel
  private var retentionDays: Int

  private let lineDateFmt: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
    return f
  }()
  private let fileNameFmt: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f
  }()
  private let lineRegex = try! NSRegularExpression(
    pattern: #"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[([VDIWE])/([^]]*)\] (.*)$"#)

  private init() {
    dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("pomelo-logs", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let defaults = UserDefaults.standard
    storedLevel = defaults.object(forKey: Self.defaultsLevelKey).flatMap { ($0 as? Int).flatMap(LogLevel.init) }
      ?? .debug
    retentionDays = defaults.object(forKey: Self.defaultsRetentionKey) as? Int ?? Self.defaultRetentionDays
    io.async { [weak self] in self?.cleanExpired() }
  }

  // MARK: - Write path

  /// Called once from `AppDelegate` right after `LynxEnv` — makes the first
  /// write deterministic (directory exists, expired files swept) instead of
  /// relying on whichever `Log.*` call happens to race the init.
  func bootstrap() {
    io.async { [weak self] in self?.cleanExpired() }
  }

  func write(_ level: LogLevel, _ tag: String, _ msg: String) {
    levelLock.lock()
    let floor = storedLevel
    levelLock.unlock()
    guard level >= floor else { return }
    let entry = LogEntry(
      entryId: UUID().uuidString,
      ts: Int64(Date().timeIntervalSince1970 * 1000),
      level: level,
      tag: tag,
      msg: msg)
    // Keep the old `NSLog` behaviour for system-log tooling (Console.app /
    // `log stream`); the file/ring copy is what the in-app log page reads.
    NSLog("[PomeloLynx][\(level.letter)/\(tag)] %@", msg)
    io.async { self.store(entry) }
  }

  /// Bulk import of JS-side entries (`NativeModules.PomeloLog.append`).
  /// Entry ids come from JS and are kept verbatim — that is what lets the
  /// page dedupe an optimistic local entry against its stored twin.
  func appendFromJS(_ json: String) {
    io.async {
      guard let data = json.data(using: .utf8),
        let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
      else { return }
      for dict in array {
        guard let msg = dict["msg"] as? String else { continue }
        let level = (dict["level"] as? NSNumber).flatMap { LogLevel(rawValue: $0.intValue) } ?? .debug
        guard level >= self.storedLevel else { continue }
        let entry = LogEntry(
          entryId: (dict["entryId"] as? String) ?? UUID().uuidString,
          ts: (dict["ts"] as? NSNumber)?.int64Value ?? Int64(Date().timeIntervalSince1970 * 1000),
          level: level,
          tag: (dict["tag"] as? String) ?? "js",
          msg: msg)
        self.store(entry)
      }
    }
  }

  private func store(_ entry: LogEntry) {
    ring.append(entry)
    if ring.count > Self.ringCapacity { ring.removeFirst(ring.count - Self.ringCapacity) }
    appendToFile(entry)
    guard pushEnabled else { return }
    pending.append(entry)
    guard !flushScheduled else { return }
    flushScheduled = true
    io.asyncAfter(deadline: .now() + Self.flushWindow) {
      self.flushScheduled = false
      let batch = self.pending
      self.pending.removeAll(keepingCapacity: true)
      if !batch.isEmpty { self.sink?(batch) }
    }
  }

  // MARK: - Push channel (native → JS)

  /// Registered by the live `PomeloLogModule`; called on `io`, batched.
  func setSink(_ sink: (([LogEntry]) -> Void)?) {
    io.async { self.sink = sink }
  }

  func setPushEnabled(_ enabled: Bool) {
    io.async {
      self.pushEnabled = enabled
      if !enabled { self.pending.removeAll(keepingCapacity: true) }
    }
  }

  // MARK: - Reads

  /// Snapshot for the log page: the in-memory ring, back-filled from the
  /// daily files when the ring holds fewer than `limit` entries (that is how
  /// entries from *previous sessions* come back). File rows are taken only
  /// with `ts < oldest ring entry` so nothing is returned twice.
  func recent(limit: Int, completion: @escaping (String) -> Void) {
    let capped = max(1, min(limit, Self.maxRecentLimit))
    io.async {
      var entries = Array(self.ring.suffix(capped))
      if entries.count < capped {
        let before = entries.first?.ts ?? Int64.max
        let extra = self.readFilesBackward(need: capped - entries.count, beforeTs: before)
        entries = extra + entries
      }
      completion(Self.encode(entries))
    }
  }

  /// Plain-text export for `shareRecent` / clipboard.
  func recentText(limit: Int, completion: @escaping (String) -> Void) {
    let capped = max(1, min(limit, Self.maxRecentLimit))
    io.async {
      var entries = Array(self.ring.suffix(capped))
      if entries.count < capped {
        let before = entries.first?.ts ?? Int64.max
        entries = self.readFilesBackward(need: capped - entries.count, beforeTs: before) + entries
      }
      completion(entries.map { self.formatLine($0) }.joined(separator: "\n"))
    }
  }

  static func encode(_ entries: [LogEntry]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: entries.map(\.jsonDict)),
      let json = String(data: data, encoding: .utf8)
    else { return "[]" }
    return json
  }

  // MARK: - Level / retention

  var level: LogLevel {
    levelLock.lock(); defer { levelLock.unlock() }
    return storedLevel
  }

  func setLevel(_ name: String) {
    guard let parsed = LogLevel(name: name) else { return }
    levelLock.lock()
    storedLevel = parsed
    levelLock.unlock()
    UserDefaults.standard.set(parsed.rawValue, forKey: Self.defaultsLevelKey)
  }

  var retention: Int {
    io.sync { retentionDays }
  }

  func setRetention(_ days: Int) {
    let clamped = max(1, days)
    io.async {
      self.retentionDays = clamped
      UserDefaults.standard.set(clamped, forKey: Self.defaultsRetentionKey)
      self.cleanExpired()
    }
  }

  // MARK: - File IO (all on `io`)

  private func appendToFile(_ entry: LogEntry) {
    let name = Self.fileNamePrefix + fileNameFmt.string(
      from: Date(timeIntervalSince1970: TimeInterval(entry.ts) / 1000))
    if name != handleName || handle == nil { openFile(name: name) }
    if handleBytes >= Self.maxFileBytes { rotate(name: name) }
    let line = formatLine(entry) + "\n"
    let data = Data(line.utf8)
    do {
      try handle?.write(contentsOf: data)
      handleBytes += Int64(data.count)
    } catch {
      // A failed append must never take the caller down; the ring still has
      // the entry and NSLog already mirrored it.
      handle = nil
    }
  }

  private static let fileNamePrefix = "app-"

  private func openFile(name: String) {
    try? handle?.close()
    handle = nil
    let url = dir.appendingPathComponent("\(name).log")
    if !FileManager.default.fileExists(atPath: url.path) {
      FileManager.default.createFile(atPath: url.path, contents: nil)
    }
    handle = try? FileHandle(forWritingTo: url)
    handleName = name
    handleBytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?
      .int64Value ?? 0
    try? handle?.seekToEnd()
  }

  private func rotate(name: String) {
    let fm = FileManager.default
    let current = dir.appendingPathComponent("\(name).log")
    let previous = dir.appendingPathComponent("\(name).log.1")
    try? handle?.close()
    handle = nil
    try? fm.removeItem(at: previous)
    try? fm.moveItem(at: current, to: previous)
    openFile(name: name)
  }

  private func cleanExpired() {
    let fm = FileManager.default
    guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil),
      let cutoff = Calendar.current.date(
        byAdding: .day, value: -retentionDays, to: Calendar.current.startOfDay(for: Date()))
    else { return }
    for url in items {
      let name = url.lastPathComponent
      guard let day = extractDay(name), fileNameFmt.date(from: day).map({ $0 < cutoff }) == true else {
        continue
      }
      try? fm.removeItem(at: url)
    }
  }

  /// `app-2026-10-26.log` / `app-2026-10-26.log.1` → `2026-10-26`, else nil.
  private func extractDay(_ name: String) -> String? {
    guard name.hasPrefix(Self.fileNamePrefix), name.hasSuffix(".log") || name.hasSuffix(".log.1")
    else { return nil }
    let start = name.index(name.startIndex, offsetBy: Self.fileNamePrefix.count)
    let end = name.index(name.endIndex, offsetBy: name.hasSuffix(".log.1") ? -6 : -4)
    guard start < end else { return nil }
    let day = String(name[start..<end])
    return day.count == 10 && fileNameFmt.date(from: day) != nil ? day : nil
  }

  private func readFilesBackward(need: Int, beforeTs: Int64) -> [LogEntry] {
    guard need > 0 else { return [] }
    let fm = FileManager.default
    guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
      return []
    }
    // Newest first: later day first; same day, the live `.log` before its
    // rotated-out `.log.1` twin (rotation moves the *older* bytes aside).
    let files: [(String, Bool, URL)] = items.compactMap { url in
      let name = url.lastPathComponent
      guard let day = extractDay(name) else { return nil }
      return (day, name.hasSuffix(".log.1"), url)
    }
    .sorted { lhs, rhs in
      lhs.0 == rhs.0 ? (!lhs.1 && rhs.1) : lhs.0 > rhs.0
    }

    var collected: [LogEntry] = []
    for (_, _, url) in files {
      guard collected.count < need,
        let data = try? Data(contentsOf: url),
        let text = String(data: data, encoding: .utf8)
      else { continue }
      let lines = text.split(separator: "\n", omittingEmptySubsequences: true).reversed()
      for line in lines {
        guard let entry = parseLine(String(line)), entry.ts < beforeTs else { continue }
        collected.append(entry)
        if collected.count >= need { break }
      }
    }
    return collected.reversed()
  }

  private func parseLine(_ line: String) -> LogEntry? {
    let range = NSRange(line.startIndex..., in: line)
    guard let match = lineRegex.firstMatch(in: line, range: range),
      let tsRange = Range(match.range(at: 1), in: line),
      let letterRange = Range(match.range(at: 2), in: line),
      let tagRange = Range(match.range(at: 3), in: line),
      let msgRange = Range(match.range(at: 4), in: line),
      let day = lineDateFmt.date(from: String(line[tsRange])),
      let level = LogLevel(letter: String(line[letterRange]))
    else { return nil }
    return LogEntry(
      entryId: "file-" + UUID().uuidString,
      ts: Int64(day.timeIntervalSince1970 * 1000),
      level: level,
      tag: String(line[tagRange]),
      msg: Self.unescape(String(line[msgRange])))
  }

  private func formatLine(_ entry: LogEntry) -> String {
    let stamp = lineDateFmt.string(from: Date(timeIntervalSince1970: TimeInterval(entry.ts) / 1000))
    return "\(stamp) [\(entry.level.letter)/\(entry.tag)] \(Self.escape(entry.msg))"
  }

  /// One line per record in the file: `\` first, then CR/LF. Reading undoes
  /// the same escape so multi-line messages round-trip.
  static func escape(_ s: String) -> String {
    s.replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\r", with: "\\r")
      .replacingOccurrences(of: "\n", with: "\\n")
  }

  static func unescape(_ s: String) -> String {
    var out = ""
    out.reserveCapacity(s.count)
    var index = s.startIndex
    while index < s.endIndex {
      let char = s[index]
      if char == "\\" {
        let next = s.index(after: index)
        if next < s.endIndex {
          switch s[next] {
          case "n":
            out.append("\n")
            index = s.index(after: next)
            continue
          case "r":
            out.append("\r")
            index = s.index(after: next)
            continue
          case "\\":
            out.append("\\")
            index = s.index(after: next)
            continue
          default: break
          }
        }
      }
      out.append(char)
      index = s.index(after: index)
    }
    return out
  }
}

// MARK: - ObjC bridge

/// C-callable bridge so `DevToolBoot.m` (ObjC) can write into the same
/// in-app log ring/file the JS LogsPage reads. Kept next to `Log` so the
/// format and level mapping stay in one place.
@_cdecl("PomeloLogInfo")
public func PomeloLogInfo(_ tag: UnsafePointer<CChar>, _ message: UnsafePointer<CChar>) {
  Log.info(String(cString: tag), String(cString: message))
}
