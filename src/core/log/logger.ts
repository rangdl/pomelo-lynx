import { LEVEL_VALUE, type LogLevelName } from './levels.js';
import { loggerCore } from './logger-core.js';
import type { LogEntry } from './types.js';

/**
 * The write API (`logger.info('tag', 'msg')`) plus the batched bridge sink.
 *
 * Flow per entry: local ingest (optimistic — the page sees it immediately
 * when it runs in this realm) → buffer → one `append` bridge write per
 * 200 ms window. The native store then re-emits the same `entryId` through
 * the push event when the page has push on, and the merge is a no-op.
 *
 * The sink is installed by `initLogging()` (native-log's `bridgeAppend`).
 * Without it — tests, or before init — entries stay local-only, which is
 * exactly the Web model.
 */

export type BridgeSink = (entriesJSON: string) => void;

let bridgeSink: BridgeSink | null = null;

export function setBridgeSink(sink: BridgeSink | null): void {
  bridgeSink = sink;
}

const SEND_WINDOW_MS = 200;

let pending: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function genEntryId(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function')
    return cryptoRef.randomUUID();
  return `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export function makeEntry(level: number, tag: string, msg: string): LogEntry {
  return { entryId: genEntryId(), ts: Date.now(), level, tag, msg };
}

function log(level: number, tag: string, msg: string): void {
  const entry = makeEntry(level, tag, msg);
  loggerCore.ingest([entry]);
  if (!bridgeSink) return;
  pending.push(entry);
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const batch = pending;
      pending = [];
      if (batch.length > 0) {
        try {
          bridgeSink?.(JSON.stringify(batch));
        } catch {
          /* Never let logging take down the caller. */
        }
      }
    }, SEND_WINDOW_MS);
  }
}

/** Push whatever is still buffered (used by tests and on hot-reload teardown). */
export function flushPendingLogs(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = pending;
  pending = [];
  if (batch.length > 0) {
    try {
      bridgeSink?.(JSON.stringify(batch));
    } catch {
      /* Ignore. */
    }
  }
}

/**
 * Programmatic logging for app code. Prefer this over raw `console.*` when
 * the tag matters — `console` is captured too, but every line lands under
 * the `console` tag there.
 */
export const logger = {
  verbose: (tag: string, msg: string): void =>
    log(LEVEL_VALUE.verbose, tag, msg),
  debug: (tag: string, msg: string): void => log(LEVEL_VALUE.debug, tag, msg),
  info: (tag: string, msg: string): void => log(LEVEL_VALUE.info, tag, msg),
  warn: (tag: string, msg: string): void => log(LEVEL_VALUE.warn, tag, msg),
  error: (tag: string, msg: string): void => log(LEVEL_VALUE.error, tag, msg),
} as const;

export type Logger = typeof logger;
export type { LogLevelName };
