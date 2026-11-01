import { describe, expect, test } from '@rstest/core';
import { createMemoryStorage, setPomeloStorage } from '../../storage/index.js';
import {
  DEFAULT_MEDIA_SETTINGS,
  loadMediaSettings,
  normalizePageSize,
  normalizeQueueLimit,
  PAGE_SIZE_MAX,
  PAGE_SIZE_MIN,
  QUEUE_LIMIT_MAX,
  QUEUE_LIMIT_MIN,
  saveMediaSettings,
} from '../settings.js';

describe('media settings', () => {
  test('队列上限和每页条数按范围收敛', () => {
    expect(normalizeQueueLimit(QUEUE_LIMIT_MIN - 1)).toBe(QUEUE_LIMIT_MIN);
    expect(normalizeQueueLimit(QUEUE_LIMIT_MAX + 1)).toBe(QUEUE_LIMIT_MAX);
    expect(normalizePageSize(PAGE_SIZE_MIN - 1)).toBe(PAGE_SIZE_MIN);
    expect(normalizePageSize(PAGE_SIZE_MAX + 1)).toBe(PAGE_SIZE_MAX);
    expect(normalizeQueueLimit(Number.NaN)).toBe(
      DEFAULT_MEDIA_SETTINGS.queueLimit,
    );
  });

  test('保存后读取到收敛后的设置', async () => {
    const storage = createMemoryStorage();
    setPomeloStorage(storage);
    const saved = await saveMediaSettings({
      queueLimit: 9999,
      pageSize: 1,
    });
    expect(saved).toEqual({
      queueLimit: QUEUE_LIMIT_MAX,
      pageSize: PAGE_SIZE_MIN,
    });
    expect(await storage.prefs.get('media.queue_limit')).toBe(
      String(QUEUE_LIMIT_MAX),
    );
    expect(await storage.prefs.get('media.page_size')).toBe(
      String(PAGE_SIZE_MIN),
    );
    expect(await loadMediaSettings()).toEqual(saved);
  });
});
