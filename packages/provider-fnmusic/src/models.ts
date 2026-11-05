import {
  type ProviderAlbum,
  ProviderError,
  type ProviderLyrics,
  type ProviderPage,
  type ProviderPlaylist,
  type ProviderSession,
  type ProviderTrack,
} from '@pomelo/provider-sdk';

/**
 * 飞牛音乐(FN Music)的线上接口约定。
 *
 * 契约来源:参考实现 `songloft-player-lynx` 的 `FnMusicEngine.kt` 与
 * `fnos_music_ext` 的拦截代理,二者都由真实客户端抓包/实测得到——飞牛**没有**
 * 公开的接口文档,所以这里的每条规则都必须按实测行为来,不能"按 REST 惯例猜"。
 */

/** 所有接口都挂在 `/music/api/v1` 下。 */
export const FN_MUSIC_API_PREFIX = '/music/api/v1';

/** `authx` 签名用的固定前缀与密钥(客户端内置常量,不是用户凭据)。 */
const FN_MUSIC_SIGN_PREFIX = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
const FN_MUSIC_SIGN_KEY = '6D5602D4-A342-4799-A0F0-BB795E7167D0';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * 解飞牛信封 `{ code, msg, data }`。
 *
 * `code` 的约定很特殊:**0 和 200 都表示成功**(不同端点混用),401 与
 * 120001 表示登录态失效。判断时不能只看 HTTP 状态码。
 */
export function unwrapEnvelope(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new ProviderError('provider_invalid_response', '服务器返回格式异常');
  }
  const code = num(value.code);
  if (code === undefined) {
    throw new ProviderError(
      'provider_invalid_response',
      '响应缺少 code 字段(地址可能不是飞牛音乐服务)',
    );
  }
  const message = text(value.msg)?.trim();
  if (code === 401 || code === 120001) {
    throw new ProviderError(
      'provider_session_expired',
      '登录已过期，请重新连接',
      {
        status: 401,
        detail: message,
      },
    );
  }
  if (code !== 0 && code !== 200) {
    throw new ProviderError(
      'provider_invalid_response',
      message ?? '服务器返回错误',
      {
        detail: message,
      },
    );
  }
  return value.data ?? null;
}

/** 列表信封:`data` 里是 `{ list, total }` 或直接是数组。 */
export function parseListPage<T>(
  data: unknown,
  limit: number,
  offset: number,
  toItem: (raw: unknown) => T | null,
): ProviderPage<T> {
  let rows: unknown[] = [];
  let total = -1;
  if (Array.isArray(data)) {
    rows = data;
  } else if (isRecord(data)) {
    // 后端字段名不统一;`ensure_search_list()` 也承认这几种写法。
    for (const key of ['list', 'items', 'tracks', 'records']) {
      const candidate = data[key];
      if (Array.isArray(candidate)) {
        rows = candidate;
        break;
      }
    }
    total = num(data.total) ?? num(data.count) ?? -1;
  }
  const items: T[] = [];
  for (const raw of rows) {
    const item = toItem(raw);
    if (item !== null) items.push(item);
  }
  return {
    items,
    total: total >= 0 ? total : offset + items.length,
    limit,
    offset,
  };
}

/**
 * 曲目节点 → ProviderTrack。
 *
 * 结构要点(与飞牛前端一致):
 * - `artists` 是**对象数组**,不是字符串
 * - `album` 是**对象**,不是字符串
 * - `audioSpec.duration` 是**毫秒**,宿主契约是秒,必须除以 1000
 */
export function toProviderTrack(raw: unknown): ProviderTrack | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.guid) ?? text(raw.id);
  const title = text(raw.title) ?? text(raw.name) ?? text(raw.filename);
  if (!id || !title) return null;

  const artists = Array.isArray(raw.artists) ? raw.artists : [];
  const artist = artists
    .map((entry) => (isRecord(entry) ? text(entry.name) : undefined))
    .filter((name): name is string => !!name)
    .join(', ');
  const albumNode = isRecord(raw.album) ? raw.album : undefined;
  const album = albumNode ? text(albumNode.name) : text(raw.albumName);

  const audio = isRecord(raw.audioSpec) ? raw.audioSpec : undefined;
  const durationMs = num(audio?.duration) ?? num(raw.duration);
  const coverId =
    text(raw.coverId) ?? (albumNode ? text(albumNode.coverId) : undefined);

  return {
    id,
    title,
    artist: artist || text(raw.artistName) || undefined,
    album: album ?? undefined,
    // 毫秒 → 秒;保留一位小数以内即可,宿主按秒使用。
    duration:
      durationMs === undefined ? undefined : Math.round(durationMs / 100) / 10,
    ...(coverId ? { resource: { artwork: coverId } } : {}),
  };
}

/** 专辑节点 → ProviderAlbum。飞牛的"专辑"来自曲目的 `album` 对象。 */
export function toProviderAlbum(raw: unknown): ProviderAlbum | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.guid) ?? text(raw.id);
  const name = text(raw.name) ?? text(raw.title);
  if (!id || !name) return null;
  const artists = Array.isArray(raw.artists) ? raw.artists : [];
  const artist = artists
    .map((entry) => (isRecord(entry) ? text(entry.name) : undefined))
    .filter((name): name is string => !!name)
    .join(', ');
  return {
    id,
    name,
    artist: artist || undefined,
    trackCount: num(raw.trackCount) ?? num(raw.songCount),
  };
}

/** 歌单节点 → ProviderPlaylist。 */
export function toProviderPlaylist(raw: unknown): ProviderPlaylist | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.guid) ?? text(raw.id);
  const name = text(raw.name) ?? text(raw.title);
  if (!id || !name) return null;
  return {
    id,
    name,
    description: text(raw.description) ?? text(raw.comment),
    trackCount: num(raw.trackCount) ?? num(raw.songCount),
  };
}

/**
 * 歌词:飞牛 `/lyric/list` 返回的 `data` 里带 `lyric` 字段(LRC 文本)。
 */
export function parseLyrics(data: unknown): ProviderLyrics | null {
  if (!isRecord(data)) return null;
  const raw = text(data.lyric) ?? text(data.lyrics) ?? text(data.lrc);
  if (raw) return { lrc: raw };
  // 有些版本把歌词包在数组里
  const list = Array.isArray(data.list) ? data.list : [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const value = text(entry.lyric) ?? text(entry.content);
    if (value) return { lrc: value };
  }
  return null;
}

/** 分页参数换算:飞牛用 `page`(从 1 开始)+ `size`。 */
export function pageParams(
  offset: number,
  limit: number,
): {
  page: number;
  size: number;
} {
  const size = Math.max(1, Math.floor(limit));
  const page = Math.floor(Math.max(0, offset) / size) + 1;
  return { page, size };
}

/**
 * 生成 `authx` 请求头。
 *
 * 算法(实测自飞牛客户端):
 *   sign = md5(`${PREFIX}_${path}_${nonce}_${ts}_${md5(data)}_${KEY}`)
 *   authx = `nonce=..&timestamp=..&sign=..`
 *
 * `data` 在 GET 时是**排序后的查询串**,POST 时是原始 body。
 * 签名带时间戳,所以**每个请求都要重新算**,不能缓存。
 */
export function buildAuthx(input: {
  path: string;
  data: string;
  nonce: string;
  timestampMs: number;
  md5: (value: string) => string;
}): string {
  const { path, data, nonce, timestampMs, md5 } = input;
  const sign = md5(
    `${FN_MUSIC_SIGN_PREFIX}_${path}_${nonce}_${timestampMs}_${md5(data)}_${FN_MUSIC_SIGN_KEY}`,
  );
  return `nonce=${nonce}&timestamp=${timestampMs}&sign=${sign}`;
}

/** 把查询参数按 key(再按 value)排序并拼成签名用的 data 串。 */
export function sortedQueryString(
  query: readonly (readonly [string, string])[],
): string {
  return [...query]
    .sort((a, b) =>
      a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/** 会话里飞牛私有字段的读取,统一做类型收窄。 */
export function sessionCredentials(session: ProviderSession | null): {
  token: string | null;
  deviceId: string | null;
} {
  const credentials = session?.credentials ?? {};
  return {
    token: credentials.userToken ?? session?.accessToken ?? null,
    deviceId: credentials.deviceId ?? null,
  };
}

export { isRecord, num, text };
