/**
 * `PomeloStorage` facade — the contract from
 * `songloft-player-lynx 的存储契约(已移植)`.
 *
 * Three namespaces:
 * - `prefs`   — non-sensitive key/value (SharedPreferences / UserDefaults / localStorage).
 * - `secure`  — sensitive values, e.g. tokens (Keystore / Keychain / DPAPI / localStorage on web).
 * - `paths`   — app directory paths (native dirs / virtual paths on web).
 *
 * Every method is async to match the eventual native (JSB) bridge, even where
 * the web implementation is synchronous underneath.
 */
export interface PomeloPrefs {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface PomeloSecure {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PomeloPaths {
  appData(): Promise<string>;
  cache(): Promise<string>;
  documents(): Promise<string>;
}

export interface PomeloStorage {
  prefs: PomeloPrefs;
  secure: PomeloSecure;
  paths: PomeloPaths;
}
