import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';
import { LEVEL_VALUE, levelLetter, levelName } from '../levels.js';
import {
  flushPendingLogs,
  logger,
  makeEntry,
  setBridgeSink,
} from '../logger.js';
import { loggerCore } from '../logger-core.js';

describe('logger', () => {
  beforeEach(() => {
    loggerCore.clear();
    flushPendingLogs();
    setBridgeSink(null);
  });

  afterEach(() => {
    setBridgeSink(null);
    loggerCore.clear();
    flushPendingLogs();
  });

  test('every level lands in the core with its contract value', () => {
    logger.verbose('t', 'v');
    logger.debug('t', 'd');
    logger.info('t', 'i');
    logger.warn('t', 'w');
    logger.error('t', 'e');
    // Same-ms entries tie-break by entryId, so compare as a sorted set.
    const levels = loggerCore
      .getAll()
      .map((entry) => entry.level)
      .sort((a, b) => a - b);
    expect(levels).toEqual([
      LEVEL_VALUE.verbose,
      LEVEL_VALUE.debug,
      LEVEL_VALUE.info,
      LEVEL_VALUE.warn,
      LEVEL_VALUE.error,
    ]);
    expect(new Set(loggerCore.getAll().map((entry) => entry.msg))).toEqual(
      new Set(['v', 'd', 'i', 'w', 'e']),
    );
  });

  test('entries carry a unique entryId and ms timestamp', () => {
    const before = Date.now();
    logger.info('t', 'one');
    logger.info('t', 'two');
    const entries = loggerCore.getAll();
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.entryId)).size).toBe(2);
    for (const entry of entries)
      expect(entry.ts).toBeGreaterThanOrEqual(before);
  });

  test('batches bridge writes: N logs → one sink call on flush', () => {
    const batches: string[] = [];
    setBridgeSink((json) => batches.push(json));
    logger.info('t', 'a');
    logger.info('t', 'b');
    logger.error('t', 'c');
    flushPendingLogs();
    expect(batches).toHaveLength(1);
    const parsed = JSON.parse(batches[0] ?? '[]') as {
      msg: string;
      level: number;
    }[];
    expect(parsed.map((e) => e.msg)).toEqual(['a', 'b', 'c']);
    expect(parsed[2]?.level).toBe(LEVEL_VALUE.error);
  });

  test('auto-flushes after the 200 ms window without an explicit flush', async () => {
    const batches: string[] = [];
    setBridgeSink((json) => batches.push(json));
    logger.info('t', 'late');
    expect(batches).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(batches).toHaveLength(1);
  });

  test('a throwing sink never breaks the log call', () => {
    setBridgeSink(() => {
      throw new Error('bridge down');
    });
    expect(() => {
      logger.info('t', 'survives');
      flushPendingLogs();
    }).not.toThrow();
    expect(loggerCore.size()).toBe(1);
  });

  test('without a sink (pre-init / Web) entries stay local-only', () => {
    setBridgeSink(null);
    logger.info('t', 'local');
    expect(loggerCore.size()).toBe(1);
    expect(() => flushPendingLogs()).not.toThrow();
  });
});

describe('makeEntry', () => {
  test('generates a non-empty id even without crypto.randomUUID', () => {
    const made = makeEntry(2, 'tag', 'msg');
    expect(made.entryId.length).toBeGreaterThan(4);
    expect(made.tag).toBe('tag');
  });
});

describe('level mapping', () => {
  test('name roundtrip clamps out-of-contract values', () => {
    expect(levelName(0)).toBe('verbose');
    expect(levelName(4)).toBe('error');
    expect(levelName(-3)).toBe('verbose');
    expect(levelName(99)).toBe('error');
    expect(levelName(2.4)).toBe('info');
  });

  test('file letters match the Swift LogLevel.letter', () => {
    expect([0, 1, 2, 3, 4].map(levelLetter)).toEqual(['V', 'D', 'I', 'W', 'E']);
  });
});
