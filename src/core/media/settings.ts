import { getPomeloStorage } from '../storage/index.js';

/**
 * 播放/浏览偏好。队列上限同时约束 JS 队列、原生队列和持久化条数；
 * 每页条数用于首页最近添加、搜索和音乐源页。
 */

export interface MediaSettings {
  queueLimit: number;
  pageSize: number;
}

export const QUEUE_LIMIT_MIN = 20;
export const QUEUE_LIMIT_MAX = 500;
export const PAGE_SIZE_MIN = 10;
export const PAGE_SIZE_MAX = 200;

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  queueLimit: 200,
  pageSize: 50,
};

const QUEUE_LIMIT_KEY = 'media.queue_limit';
const PAGE_SIZE_KEY = 'media.page_size';

let cached: MediaSettings = { ...DEFAULT_MEDIA_SETTINGS };
let loading: Promise<MediaSettings> | null = null;

function clamp(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

export function normalizeQueueLimit(value: number): number {
  return clamp(
    value,
    QUEUE_LIMIT_MIN,
    QUEUE_LIMIT_MAX,
    DEFAULT_MEDIA_SETTINGS.queueLimit,
  );
}

export function normalizePageSize(value: number): number {
  return clamp(
    value,
    PAGE_SIZE_MIN,
    PAGE_SIZE_MAX,
    DEFAULT_MEDIA_SETTINGS.pageSize,
  );
}

function parseNumber(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** 同步读当前缓存；未调用 loadMediaSettings 时返回默认值。 */
export function currentMediaSettings(): MediaSettings {
  return cached;
}

export async function loadMediaSettings(): Promise<MediaSettings> {
  if (loading) return loading;
  loading = (async () => {
    const prefs = getPomeloStorage().prefs;
    const [rawQueue, rawPage] = await Promise.all([
      prefs.get(QUEUE_LIMIT_KEY).catch(() => null),
      prefs.get(PAGE_SIZE_KEY).catch(() => null),
    ]);
    cached = {
      queueLimit:
        parseNumber(rawQueue) === null
          ? DEFAULT_MEDIA_SETTINGS.queueLimit
          : normalizeQueueLimit(parseNumber(rawQueue) as number),
      pageSize:
        parseNumber(rawPage) === null
          ? DEFAULT_MEDIA_SETTINGS.pageSize
          : normalizePageSize(parseNumber(rawPage) as number),
    };
    return cached;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export async function saveMediaSettings(
  value: MediaSettings,
): Promise<MediaSettings> {
  const next: MediaSettings = {
    queueLimit: normalizeQueueLimit(value.queueLimit),
    pageSize: normalizePageSize(value.pageSize),
  };
  cached = next;
  const prefs = getPomeloStorage().prefs;
  await Promise.all([
    prefs.set(QUEUE_LIMIT_KEY, String(next.queueLimit)),
    prefs.set(PAGE_SIZE_KEY, String(next.pageSize)),
  ]);
  return next;
}
