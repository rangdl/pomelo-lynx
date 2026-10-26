import { describe, expect, test } from '@rstest/core';
import { filterEntries, LoggerCore } from '../logger-core.js';
import type { LogEntry } from '../types.js';

function entry(partial: Partial<LogEntry> & { entryId: string }): LogEntry {
  return { ts: 1000, level: 2, tag: 'test', msg: 'msg', ...partial };
}

describe('LoggerCore.ingest', () => {
  test('merges three sources by entryId without duplicates', () => {
    const core = new LoggerCore();
    const local = entry({ entryId: 'a', ts: 1 });
    core.ingest([local]);
    // push echo of the same optimistic entry + a genuinely new one
    const added = core.ingest([
      { ...local, msg: 'echo' },
      entry({ entryId: 'b', ts: 2 }),
    ]);
    expect(added).toHaveLength(1);
    expect(added[0]?.entryId).toBe('b');
    expect(core.size()).toBe(2);
  });

  test('orders by ts then entryId for stable ties', () => {
    const core = new LoggerCore();
    core.ingest([
      entry({ entryId: 'z', ts: 5 }),
      entry({ entryId: 'a', ts: 5 }),
      entry({ entryId: 'm', ts: 1 }),
    ]);
    expect(core.getAll().map((e) => e.entryId)).toEqual(['m', 'a', 'z']);
  });

  test('rejects malformed entries', () => {
    const core = new LoggerCore();
    const added = core.ingest([
      { entryId: '', ts: 1, level: 2, tag: 't', msg: 'm' },
      { entryId: 'ok', ts: Number.NaN, level: 2, tag: 't', msg: 'm' },
      entry({ entryId: 'good', ts: 3 }),
    ] as LogEntry[]);
    expect(added.map((e) => e.entryId)).toEqual(['good']);
  });

  test('caps at 2000 entries, keeping the newest', () => {
    const core = new LoggerCore();
    const flood: LogEntry[] = [];
    for (let i = 0; i < 2100; i++)
      flood.push(entry({ entryId: `e${i}`, ts: i }));
    core.ingest(flood);
    expect(core.size()).toBe(2000);
    expect(core.getAll()[0]?.entryId).toBe('e100');
    expect(core.getAll().at(-1)?.entryId).toBe('e2099');
  });

  test('notifies subscribers with the full list and stops after unsubscribe', () => {
    const core = new LoggerCore();
    const seen: number[] = [];
    const unsubscribe = core.subscribe((all) => seen.push(all.length));
    core.ingest([entry({ entryId: 'a', ts: 1 })]);
    core.ingest([entry({ entryId: 'b', ts: 2 })]);
    unsubscribe();
    core.ingest([entry({ entryId: 'c', ts: 3 })]);
    expect(seen).toEqual([1, 2]);
  });
});

describe('filterEntries', () => {
  const entries = [
    entry({ entryId: 'v', ts: 1, level: 0 }),
    entry({ entryId: 'd', ts: 2, level: 1 }),
    entry({ entryId: 'i', ts: 3, level: 2 }),
    entry({ entryId: 'e', ts: 4, level: 4 }),
  ];

  test('drops entries below the display level', () => {
    expect(filterEntries(entries, 'info', 100).map((e) => e.entryId)).toEqual([
      'i',
      'e',
    ]);
    expect(filterEntries(entries, 'verbose', 100)).toHaveLength(4);
  });

  test('keeps only the newest `limit` rows after filtering', () => {
    expect(filterEntries(entries, 'verbose', 2).map((e) => e.entryId)).toEqual([
      'i',
      'e',
    ]);
  });
});
