/**
 * One log record — the cross-bridge shape produced by iOS `LogStore.jsonDict`
 * and consumed by `LoggerCore.ingest`. `entryId` is the global dedupe key:
 * an entry can arrive three ways (local optimistic write, `getRecent`
 * snapshot, `PomeloLog.append` push) and must only appear once in the list.
 */
export interface LogEntry {
  entryId: string;
  /** Epoch milliseconds — same unit on both sides. */
  ts: number;
  /** 0=verbose … 4=error — see `levels.ts`. */
  level: number;
  tag: string;
  msg: string;
}

/** Which door an entry came through. Purely diagnostic; not part of the wire. */
export type LogSource = 'local' | 'snapshot' | 'push';
