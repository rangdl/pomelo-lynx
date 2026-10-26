import { LEVEL_VALUE, type LogLevelName } from './levels.js';
import type { LogEntry } from './types.js';

/**
 * The in-memory list behind the log page.
 *
 * Lives once **per realm** (main thread and background each evaluate this
 * module separately — Lynx dual-thread runtimes share code, not state), which
 * is fine by design: the UI only ever reads the background copy, and entries
 * written on the main thread reach it through the native store + push event,
 * never through this object. On Web there is a single realm and the local
 * copy *is* the whole log.
 *
 * Merge rule: by `entryId`, ordered by `ts` (then `entryId` for stable ties),
 * hard-capped so a chatty debug session cannot grow the list without bound.
 */
const MAX_ENTRIES = 2000;

export type LogSubscriber = (all: readonly LogEntry[]) => void;

function compare(a: LogEntry, b: LogEntry): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
}

export class LoggerCore {
  private entries: LogEntry[] = [];
  private subscribers = new Set<LogSubscriber>();

  /** Merge a batch; returns the entries that were actually new (deduped away ones dropped). */
  ingest(incoming: readonly LogEntry[]): LogEntry[] {
    if (incoming.length === 0) return [];
    const known = new Set(this.entries.map((entry) => entry.entryId));
    const added: LogEntry[] = [];
    for (const entry of incoming) {
      if (
        !entry ||
        typeof entry.entryId !== 'string' ||
        entry.entryId.length === 0
      )
        continue;
      if (!Number.isFinite(entry.ts)) continue;
      if (known.has(entry.entryId)) continue;
      known.add(entry.entryId);
      added.push(entry);
    }
    if (added.length === 0) return [];
    this.entries = [...this.entries, ...added].sort(compare);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(this.entries.length - MAX_ENTRIES);
    }
    this.notify();
    return added;
  }

  getAll(): readonly LogEntry[] {
    return this.entries;
  }

  size(): number {
    return this.entries.length;
  }

  /** Subscriber receives the full current list (a fresh sorted array each time). */
  subscribe(subscriber: LogSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  clear(): void {
    this.entries = [];
    this.notify();
  }

  private notify(): void {
    const snapshot = this.entries;
    for (const subscriber of this.subscribers) {
      try {
        subscriber(snapshot);
      } catch {
        /* A broken subscriber must not stall the others. */
      }
    }
  }
}

/** The per-realm singleton the logger writes into and the log page reads from. */
export const loggerCore = new LoggerCore();

/**
 * Display-level filter + tail cut for rendering. Entries are already sorted,
 * so taking from the end keeps the *newest* `limit` rows above the floor.
 */
export function filterEntries(
  entries: readonly LogEntry[],
  displayLevel: LogLevelName,
  limit: number,
): LogEntry[] {
  const floor = LEVEL_VALUE[displayLevel];
  const filtered =
    floor === LEVEL_VALUE.verbose
      ? entries.slice()
      : entries.filter((entry) => entry.level >= floor);
  if (filtered.length > limit) return filtered.slice(filtered.length - limit);
  return filtered;
}
