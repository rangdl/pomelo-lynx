import Foundation
import Lynx
import Security

/**
 * Lynx native module `NativeModules.PomeloStorage` — persistent key/value
 * storage, the iOS counterpart of the Android
 * `org.pomelo.lynx.storage.PomeloStorageModule` (SharedPreferences).
 *
 * Why it exists: without a native module the TS facade falls back to an
 * **in-memory** store (`src/core/storage/index.ts`), so the auth token dies with
 * the process and every cold start bounces the user to `/login`. Persisting it
 * here is what makes `checkAuth` find the token again after the app is killed.
 *
 * The two areas mirror the Kotlin module's `area` switch **byte for byte**
 * (`src/core/storage/native-storage.ts` sends these strings):
 *   - `prefs`  → `UserDefaults` suite (server url, language, play mode, …)
 *   - `secure` → Keychain (tokens), with a UserDefaults fallback — see
 *                [secureFallback].
 *
 * Shape follows the official "Native Modules" guide: a class conforming to
 * `LynxModule` exposing `name` + `methodLookup`, registered on the `LynxConfig`
 * in `ViewController`. Reads are **callback-based** (`LynxCallbackBlock`), which
 * the TS binding promisifies; writes are fire-and-forget. Callbacks are invoked
 * synchronously — UserDefaults/Keychain reads are local and cheap, and Lynx
 * hops the result onto the JS thread itself.
 */
@objc(PomeloStorageModule)
public final class PomeloStorageModule: NSObject, LynxModule {
  // MARK: - LynxModule

  /// Must match the key the TS binding probes (`NativeModules.PomeloStorage`).
  @objc public static var name: String { "PomeloStorage" }

  public override init() {
    super.init()
  }

  /**
   * JS method name → ObjC selector. Unlike Android's `@LynxMethod` annotation,
   * iOS has no way to discover these: a missing entry here means the method is
   * simply absent on the JS object, and `isNativeStorageAvailable` then rejects
   * the whole module (silently falling back to in-memory storage). Keep in sync
   * with `PomeloStorageNativeModule` in `native-storage.ts`.
   */
  @objc public static var methodLookup: [String: String] {
    [
      "setItem": NSStringFromSelector(#selector(PomeloStorageModule.setItem(_:key:value:))),
      "getItem": NSStringFromSelector(#selector(PomeloStorageModule.getItem(_:key:callback:))),
      "removeItem": NSStringFromSelector(#selector(PomeloStorageModule.removeItem(_:key:))),
      "getKeys": NSStringFromSelector(#selector(PomeloStorageModule.getKeys(_:callback:))),
      "getPath": NSStringFromSelector(#selector(PomeloStorageModule.getPath(_:callback:))),
    ]
  }

  // MARK: - Backing stores

  /// `area` value selecting the Keychain-backed store (matches Kotlin `AREA_SECURE`).
  private static let areaSecure = "secure"
  /// Named suites rather than `.standard`, mirroring Android's two prefs files.
  private static let prefsSuite = "pomelo_prefs"
  private static let secureSuite = "pomelo_secure"
  /// Keychain `kSecAttrService` — one generic-password bucket for the app.
  private static let keychainService = "org.pomelo.lynx.secure"

  private let prefs = UserDefaults(suiteName: PomeloStorageModule.prefsSuite) ?? .standard

  /**
   * Fallback for the `secure` area when the Keychain is unusable.
   *
   * `SecItemAdd` fails with `errSecMissingEntitlement` (-34018) on hosts whose
   * signing/provisioning does not grant a keychain access group — a classic
   * side-loaded-dev-build failure. Silently losing the token there would put us
   * straight back into the "re-login on every launch" bug this module exists to
   * fix, so writes fall back to UserDefaults (which is exactly what the Android
   * host's `secure` area already is: a plain, non-encrypted prefs file).
   */
  private let secureFallback = UserDefaults(suiteName: PomeloStorageModule.secureSuite)
    ?? .standard

  /**
   * Exists purely to satisfy the protocol: Swift cannot represent ObjC
   * `@optional` **initializer** requirements, so `initWithParam:` has to be
   * declared even though nothing registers this module with a param. (`init()`
   * — the one the runtime does call — comes from `NSObject`.)
   */
  @objc(initWithParam:)
  public convenience init(param: Any) {
    self.init()
  }

  // MARK: - Methods (JS-facing)

  @objc public func setItem(_ area: String, key: String, value: String) {
    if isSecure(area) {
      secureWrite(key: key, value: value)
    } else {
      prefs.set(value, forKey: key)
    }
  }

  @objc public func getItem(_ area: String, key: String, callback: @escaping (Any) -> Void) {
    let value = isSecure(area) ? secureRead(key: key) : prefs.string(forKey: key)
    // `NSNull` decodes to JS `null` (a nil block argument would decode to
    // `undefined`); the TS binding maps both to `null`, but `null` is what the
    // Kotlin module's `callback.invoke(null)` produces, so match it.
    callback(value ?? NSNull())
  }

  @objc public func removeItem(_ area: String, key: String) {
    if isSecure(area) {
      SecItemDelete(keychainQuery(key: key) as CFDictionary)
      secureFallback.removeObject(forKey: key)
    } else {
      prefs.removeObject(forKey: key)
    }
  }

  @objc public func getKeys(_ area: String, callback: @escaping (Any) -> Void) {
    callback(isSecure(area) ? secureKeys() : Array(prefs.dictionaryRepresentation().keys))
  }

  /**
   * App directory paths. The `name`s come from `PomeloStorage.paths` in
   * `native-storage.ts`; the mapping is the iOS analogue of Android's
   * `filesDir` / `cacheDir` / `getExternalFilesDir(null)`.
   */
  @objc public func getPath(_ name: String, callback: @escaping (Any) -> Void) {
    let directory: FileManager.SearchPathDirectory
    switch name {
    case "cache": directory = .cachesDirectory
    case "documents": directory = .documentDirectory
    default: directory = .applicationSupportDirectory  // appData
    }
    guard let url = FileManager.default.urls(for: directory, in: .userDomainMask).first else {
      callback(NSTemporaryDirectory())
      return
    }
    // Application Support is the one of the three iOS does not create for us,
    // and handing back a path that does not exist would be a trap for any
    // future caller that writes to it.
    if !FileManager.default.fileExists(atPath: url.path) {
      try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
    callback(url.path)
  }

  // MARK: - Keychain (`secure` area)

  private func isSecure(_ area: String) -> Bool { area == Self.areaSecure }

  private func keychainQuery(key: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.keychainService,
      kSecAttrAccount as String: key,
    ]
  }

  private func secureWrite(key: String, value: String) {
    let data = Data(value.utf8)
    let query = keychainQuery(key: key)
    // Update first: `SecItemAdd` on an existing account returns errSecDuplicateItem.
    var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var insert = query
      insert[kSecValueData as String] = data
      // Tokens are read during launch (auth bootstrap) and while playing in the
      // background, so the device may still be locked — `AfterFirstUnlock`
      // rather than `WhenUnlocked`.
      insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
      status = SecItemAdd(insert as CFDictionary, nil)
    }
    if status == errSecSuccess {
      // Drop any fallback copy so a stale value can never shadow the Keychain.
      secureFallback.removeObject(forKey: key)
      return
    }
    NSLog("PomeloStorage: keychain write failed (OSStatus %d) for '%@'; using UserDefaults", status, key)
    secureFallback.set(value, forKey: key)
  }

  private func secureRead(key: String) -> String? {
    var query = keychainQuery(key: key)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data,
       let value = String(data: data, encoding: .utf8) {
      return value
    }
    return secureFallback.string(forKey: key)
  }

  private func secureKeys() -> [String] {
    var query = keychainQuery(key: "")
    query.removeValue(forKey: kSecAttrAccount as String)
    query[kSecMatchLimit as String] = kSecMatchLimitAll
    query[kSecReturnAttributes as String] = true
    var items: CFTypeRef?
    var keys = Set(secureFallback.dictionaryRepresentation().keys)
    if SecItemCopyMatching(query as CFDictionary, &items) == errSecSuccess,
       let attributes = items as? [[String: Any]] {
      for entry in attributes {
        if let account = entry[kSecAttrAccount as String] as? String { keys.insert(account) }
      }
    }
    return Array(keys)
  }
}
