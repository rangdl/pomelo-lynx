import Foundation

/**
 * One store per process, shared by template loading and (future) the
 * PomeloUpdate native module. Reads `native-host.json` from app resources —
 * the snapshot `scripts/gen-native-host.mjs` produces at build time.
 *
 * Stage 4a scope (this file): the **selection** half of the hot-update
 * pipeline. A downloaded update lives in
 * `Application Support/bundle_updates/bundles/<key>`; `state.json` tracks
 * active / pending / trial keys exactly like songloft-player-lynx's
 * BundleUpdateStore (whose Swift structure this file mirrors, so the two
 * platforms stay behaviourally identical). Signature verification (stage 4b)
 * and network download (stage 4c) are NOT implemented here yet — `install()`
 * is the single seam they will plug into.
 *
 * Pure Foundation + JSONSerialization (no Lynx types), so it can be verified
 * on a Mac with `swiftc` alone without the pods.
 */
final class BundleUpdateStore {
  static var shared: BundleUpdateStore? = {
    guard let url = Bundle.main.url(forResource: "native-host", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let host = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
      // Missing native-host.json means an app built without `pnpm build:host`
      // — updates stay disabled, embedded resources still load.
      return nil
    }
    guard let support = FileManager.default.urls(
      for: .applicationSupportDirectory, in: .userDomainMask
    ).first else { return nil }
    let root = support.appendingPathComponent("bundle_updates", isDirectory: true)
    return BundleUpdateStore(root: root, host: host)
  }()

  private let root: URL
  private let bundlesDir: URL
  private let stateFile: URL
  private let lock = NSLock()

  private init(root: URL, host: [String: Any]) {
    self.root = root
    self.bundlesDir = root.appendingPathComponent("bundles", isDirectory: true)
    self.stateFile = root.appendingPathComponent("state.json")
    try? FileManager.default.createDirectory(at: bundlesDir, withIntermediateDirectories: true)
    // Part directories are never candidates after an interrupted process.
    if let items = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
      for item in items where item.lastPathComponent.hasPrefix("download-") {
        try? FileManager.default.removeItem(at: item)
      }
    }
  }

  /**
   * Once per launch: pick the bundle to run.
   *
   * - A `trial` from the previous process that was never confirmed means the
   *   process died before the page could confirm — roll back and never retry
   *   in this process.
   * - Otherwise a `pending` update is promoted to `trial` and returned.
   * - `nil` → caller falls back to the embedded resources bundle.
   */
  func beginLaunch() throws -> Data? {
    try lock.withLock {
      var state = readState()
      if state["trial"] != nil {
        state.removeValue(forKey: "trial")
        state["last_error"] = "rollback_unconfirmed"
        writeState(state)
        return nil
      }
      guard let pendingKey = state["pending"] as? String, !pendingKey.isEmpty else { return nil }
      let file = bundlesDir.appendingPathComponent(pendingKey).appendingPathComponent("bundle.bin")
      guard let bytes = try? Data(contentsOf: file), !bytes.isEmpty else {
        state.removeValue(forKey: "pending")
        writeState(state)
        return nil
      }
      state["trial"] = pendingKey
      writeState(state)
      return bytes
    }
  }

  /** A trial that reached a working first screen promotes to active. */
  func confirmLaunch() {
    lock.lock(); defer { lock.unlock() }
    var state = readState()
    guard let trial = state["trial"] as? String, !trial.isEmpty else { return }
    state["active"] = trial
    state.removeValue(forKey: "trial")
    state.removeValue(forKey: "last_error")
    writeState(state)
    prune(state)
  }

  /**
   * Fatal load error during a trial (or any launch): the next process rolls
   * back. Called from the fatal branch of `LynxViewLifecycle`.
   */
  func failStartup() {
    lock.lock(); defer { lock.unlock() }
    var state = readState()
    guard state["trial"] != nil else { return }
    state["last_error"] = "startup_failed"
    writeState(state)
  }

  /**
   * The seam stage 4b/4c will call after verifying a downloaded manifest:
   * stage the bytes under the manifest key and mark it pending. Until those
   * stages land, nothing calls it.
   */
  func install(key: String, bytes: Data) throws {
    try key.matches("^[A-Za-z0-9._-]{1,160}$").expectTrue("invalid_key")
    try (!bytes.isEmpty && bytes.count <= Self.maxBundleBytes).expectTrue("invalid_bundle")
    let dir = bundlesDir.appendingPathComponent(key, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try bytes.write(to: dir.appendingPathComponent("bundle.bin"))
    var state = readState()
    state["pending"] = key
    writeState(state)
  }

  static let maxBundleBytes = 32 * 1024 * 1024

  // MARK: - State file

  private func readState() -> [String: Any] {
    guard let data = try? Data(contentsOf: stateFile),
      data.count <= 16_384,
      let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return [:] }
    return json
  }

  private func writeState(_ state: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: state) else { return }
    let temp = root.appendingPathComponent("state.json.part")
    if (try? data.write(to: temp)) != nil {
      try? FileManager.default.removeItem(at: stateFile)
      try? FileManager.default.moveItem(at: temp, to: stateFile)
    }
  }

  /** Keep active + pending + trial only; everything else on disk is garbage. */
  private func prune(_ state: [String: Any]) {
    let keep = Set(["active", "pending", "trial"].compactMap { state[$0] as? String })
    guard let items = try? FileManager.default.contentsOfDirectory(at: bundlesDir, includingPropertiesForKeys: nil) else { return }
    for item in items where !keep.contains(item.lastPathComponent) {
      try? FileManager.default.removeItem(at: item)
    }
  }
}

private extension String {
  func matches(_ pattern: String) -> Bool { range(of: pattern, options: .regularExpression) != nil }
}

private extension Bool {
  func expectTrue(_ message: String) throws {
    if !self { throw NSError(domain: "org.pomelo.lynx", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
  }
}
