import type { PomeloStorage } from './types.js';

/**
 * Native `PomeloStorage` binding.
 *
 * Bridges the facade to the Android/iOS `NativeModules.PomeloStorage` module
 * (Android: SharedPreferences — see `docs/archive/migration/lynx_native_modules_spec.md#2`). This
 * is what makes tokens / server address / language **persist across Activity &
 * process restart**: batch-3's on-device fallback was in-memory, so backgrounding
 * the app (JS reload) dropped the token and bounced the user to /login. With a
 * persistent native backend `checkAuth` finds the token again → no re-login.
 *
 * The native methods are fire-and-forget for writes and **callback-based** for
 * reads (the Lynx module shape from the official Native Modules guide). This
 * adapter promisifies the callbacks so the async `PomeloStorage` facade is
 * unchanged for callers. Reads resolve to a safe fallback (never reject) so a
 * flaky bridge can never crash auth bootstrap.
 */

/**
 * Storage areas passed to the native module. **Must match the Kotlin
 * `PomeloStorageModule` `area` switch** (`prefs` → app prefs file, `secure` →
 * secure prefs file).
 */
export type StorageArea = 'prefs' | 'secure';

/** The native module surface on `NativeModules.PomeloStorage`. */
export interface PomeloStorageNativeModule {
  getItem(
    area: StorageArea,
    key: string,
    callback: (value: string | null) => void,
  ): void;
  setItem(area: StorageArea, key: string, value: string): void;
  removeItem(area: StorageArea, key: string): void;
  getKeys(area: StorageArea, callback: (keys: string[]) => void): void;
  /** Optional: native app directory paths. Absent → virtual fallback paths. */
  getPath?(name: string, callback: (path: string) => void): void;
}

/** Read/write/remove/keys methods required for the native binding to be usable. */
const REQUIRED_METHODS = [
  'getItem',
  'setItem',
  'removeItem',
  'getKeys',
] as const;

/**
 * Probe: is a usable native storage module present? Pure — the caller injects
 * the (possibly undefined) `NativeModules` bag so it is testable.
 */
export function isNativeStorageAvailable(
  nativeModules: { PomeloStorage?: unknown } | undefined | null,
): boolean {
  const mod = nativeModules?.PomeloStorage as
    | Record<string, unknown>
    | undefined;
  if (!mod) return false;
  return REQUIRED_METHODS.every((name) => typeof mod[name] === 'function');
}

/**
 * Build a `PomeloStorage` over the native module. Callback reads are wrapped
 * in Promises; write failures are swallowed (best-effort persistence must never
 * break the caller). Accepts an injected module so it is unit-testable.
 */
export function createNativeStorage(
  mod: PomeloStorageNativeModule,
): PomeloStorage {
  const get = (area: StorageArea, key: string): Promise<string | null> =>
    new Promise((resolve) => {
      try {
        mod.getItem(area, key, (value) => resolve(value ?? null));
      } catch {
        resolve(null);
      }
    });

  const set = (area: StorageArea, key: string, value: string): Promise<void> =>
    new Promise((resolve) => {
      try {
        mod.setItem(area, key, value);
      } finally {
        resolve();
      }
    });

  const remove = (area: StorageArea, key: string): Promise<void> =>
    new Promise((resolve) => {
      try {
        mod.removeItem(area, key);
      } finally {
        resolve();
      }
    });

  const listKeys = (area: StorageArea): Promise<string[]> =>
    new Promise((resolve) => {
      try {
        mod.getKeys(area, (keys) => resolve(Array.isArray(keys) ? keys : []));
      } catch {
        resolve([]);
      }
    });

  const pathFor = (name: string): Promise<string> =>
    new Promise((resolve) => {
      if (typeof mod.getPath !== 'function') {
        resolve(`/pomelo/${name}`);
        return;
      }
      try {
        mod.getPath(name, (path) => resolve(path || `/pomelo/${name}`));
      } catch {
        resolve(`/pomelo/${name}`);
      }
    });

  return {
    prefs: {
      get: (key) => get('prefs', key),
      set: (key, value) => set('prefs', key, value),
      remove: (key) => remove('prefs', key),
      keys: () => listKeys('prefs'),
    },
    secure: {
      get: (key) => get('secure', key),
      set: (key, value) => set('secure', key, value),
      remove: (key) => remove('secure', key),
    },
    paths: {
      appData: () => pathFor('appData'),
      cache: () => pathFor('cache'),
      documents: () => pathFor('documents'),
    },
  };
}
