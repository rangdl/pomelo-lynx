import { runOnBackground } from '@lynx-js/react';

import {
  readLynxGlobal,
  readNativeModules,
} from '../../native/native-modules.js';
import type { LogEntry } from './types.js';

/**
 * Binding to `NativeModules.PomeloLog` + the `PomeloLog.append` push event.
 *
 * Threading (Lynx dual-thread): native module calls belong on the background
 * thread. Callers here are of two kinds —
 *   - page effects / event handlers → already background, plain call;
 *   - `logger`'s flush, which may originate in a render (main thread) →
 *     routed through `runOnBackground`, with two fallbacks: the synchronous
 *     throw when *already* on background, and a promise-rejection fallback to
 *     a direct call so a log line is never lost to scheduling machinery.
 *
 * Web has no `PomeloLog` module: every call degrades to a no-op / empty
 * result and the page reads `loggerCore` directly instead (single realm).
 */

interface PomeloLogNativeModule {
  append(entriesJSON: string): void;
  getRecent(limit: number, callback: (entriesJSON: string) => void): void;
  setPushEnabled(enabled: boolean): void;
  setLevel(level: string, callback: (level: string) => void): void;
  getLevel(callback: (level: string) => void): void;
  setRetentionDays(days: number, callback: (days: number) => void): void;
  getRetentionDays(callback: (days: number) => void): void;
  shareRecent(limit: number, callback: (resultJSON: string) => void): void;
}

function logModule(): PomeloLogNativeModule | null {
  const modules = readNativeModules();
  const candidate = modules?.['PomeloLog'] as PomeloLogNativeModule | undefined;
  return candidate && typeof candidate.append === 'function' ? candidate : null;
}

/** Whether the device-side store/settings exist (false on Web and in tests). */
export function hasNativeLog(): boolean {
  return logModule() !== null;
}

/**
 * Batched write of JS-side entries. Safe from either thread — see the
 * threading note at the top of the file.
 */
export function bridgeAppend(entriesJSON: string): void {
  const module = logModule();
  if (!module) return;
  try {
    void runOnBackground(() => {
      logModule()?.append(entriesJSON);
    })().catch(() => {
      // Scheduling machinery unavailable → the caller is already safe enough
      // to write directly (background path); a lost log is worse than a hop.
      logModule()?.append(entriesJSON);
    });
  } catch {
    // `runOnBackground` throws when invoked *from* the background thread
    // (`__JS__`) or on an old SDK — plain call, which is exactly right here.
    module.append(entriesJSON);
  }
}

export function setPushEnabled(enabled: boolean): void {
  try {
    logModule()?.setPushEnabled(enabled);
  } catch {
    /* Detached host. */
  }
}

function promisify<T>(
  invoke: (callback: (value: T) => void) => void,
  fallback: T,
): Promise<T> {
  return new Promise((resolve) => {
    try {
      invoke((value) => resolve(value));
    } catch {
      resolve(fallback);
    }
    // A module that never answers must not hang the settings UI.
    setTimeout(() => resolve(fallback), 2000);
  });
}

/** Snapshot for the log page — native ring + previous-session file rows. */
export function fetchRecent(limit: number): Promise<LogEntry[]> {
  const module = logModule();
  if (!module) return Promise.resolve([]);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 2000);
    try {
      module.getRecent(limit, (entriesJSON: string) => {
        clearTimeout(timer);
        try {
          const parsed: unknown = JSON.parse(entriesJSON);
          resolve(Array.isArray(parsed) ? (parsed as LogEntry[]) : []);
        } catch {
          resolve([]);
        }
      });
    } catch {
      clearTimeout(timer);
      resolve([]);
    }
  });
}

export function fetchLevel(): Promise<string> {
  return promisify((done) => logModule()?.getLevel(done), 'debug');
}

export function storeLevel(level: string): Promise<string> {
  return promisify((done) => logModule()?.setLevel(level, done), level);
}

export function fetchRetentionDays(): Promise<number> {
  return promisify((done) => logModule()?.getRetentionDays(done), 7);
}

export function storeRetentionDays(days: number): Promise<number> {
  return promisify((done) => logModule()?.setRetentionDays(days, done), days);
}

/** Native share sheet (iOS UIActivityViewController / Android ACTION_SEND). */
export function shareRecent(limit: number): Promise<void> {
  const module = logModule();
  if (!module) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      module.shareRecent(limit, (resultJSON: string) => {
        try {
          const parsed = JSON.parse(resultJSON) as { error?: string };
          if (parsed.error) reject(new Error(parsed.error));
          else resolve();
        } catch {
          resolve();
        }
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Subscribe to the native push channel (`PomeloLog.append`, 150 ms batched
 * by `LogStore`). Subscribe in a background effect; returns the unsubscribe.
 */
export function subscribeLogAppend(
  listener: (entries: LogEntry[]) => void,
): () => void {
  'background only';
  try {
    const emitter = readLynxGlobal()?.getJSModule?.('GlobalEventEmitter');
    if (
      typeof emitter?.addListener !== 'function' ||
      typeof emitter?.removeListener !== 'function'
    )
      return () => {};
    let active = true;
    const handler = (raw: unknown) => {
      if (!active) return;
      try {
        const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) listener(parsed as LogEntry[]);
      } catch {
        /* Malformed / late event. */
      }
    };
    emitter.addListener('PomeloLog.append', handler);
    return () => {
      if (!active) return;
      active = false;
      try {
        emitter.removeListener('PomeloLog.append', handler);
      } catch {
        /* Detached host. */
      }
    };
  } catch {
    return () => {};
  }
}
