import {
  type ProviderAlbum,
  ProviderError,
  type ProviderLyrics,
  type ProviderPage,
  type ProviderPlaylist,
  type ProviderTrack,
} from '@pomelo/provider-sdk';

/**
 * Subsonic REST 的响应信封。
 *
 * 所有非二进制方法都返回 `{ "subsonic-response": { status, version, ... } }`。
 * 默认是 XML,必须显式带 `f=json` 才会是这个形状。
 * 失败时 `status = "failed"` 且带 `error: { code, message }`。
 */
const ENVELOPE = 'subsonic-response';

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
 * 把 Subsonic 的错误码映射成 ProviderError。
 *
 * 官方错误码是固定数字表,不能靠 HTTP 状态判断——Subsonic 就算业务失败
 * 也常常返回 HTTP 200,错误只体现在信封里。
 */
const SUBSONIC_ERRORS: Record<number, { code: string; message: string }> = {
  0: {
    code: 'provider_invalid_response',
    message: '服务器返回了一个一般性错误',
  },
  10: { code: 'provider_invalid_response', message: '缺少必需参数' },
  20: {
    code: 'provider_invalid_response',
    message: '客户端版本过低,请升级应用',
  },
  30: {
    code: 'provider_invalid_response',
    message: '服务端版本过低,请升级服务端',
  },
  40: { code: 'provider_login_failed', message: '用户名或密码错误' },
  41: {
    code: 'provider_login_failed',
    message: '该账号为 LDAP 用户,不支持令牌认证',
  },
  50: { code: 'provider_forbidden', message: '当前账号无权执行该操作' },
  60: { code: 'provider_forbidden', message: '服务端试用期已结束' },
  70: { code: 'provider_not_found', message: '服务器上找不到该资源' },
};

export interface SubsonicEnvelope {
  status: string;
  version?: string;
  [key: string]: unknown;
}

/**
 * 解包并校验信封,返回信封内部对象(即除 `subsonic-response` 之外的内容)。
 *
 * 返回的是**信封本体**,调用方再从里面取 `album` / `song` 等业务节点。
 */
export function unwrapEnvelope(value: unknown): SubsonicEnvelope {
  if (!isRecord(value)) {
    throw new ProviderError('provider_invalid_response', '服务器返回格式异常');
  }
  const body = value[ENVELOPE];
  if (!isRecord(body)) {
    throw new ProviderError(
      'provider_invalid_response',
      '响应缺少 subsonic-response 节点(服务端可能不是 Subsonic 兼容服务)',
    );
  }
  const status = text(body.status);
  if (status !== 'ok') {
    const error = isRecord(body.error) ? body.error : undefined;
    const code = num(error?.code);
    const mapped = code === undefined ? undefined : SUBSONIC_ERRORS[code];
    if (mapped && code !== undefined) {
      throw new ProviderError(mapped.code as never, mapped.message, {
        status: code,
        detail: text(error?.message),
      });
    }
    throw new ProviderError(
      'provider_invalid_response',
      '服务器返回了未知错误',
      {
        detail: text(error?.message),
      },
    );
  }
  return { ...body, status };
}

/** 取 JSON 数组节点;Subsonic 在只有一项时可能省略数组包装,这里统一成数组。 */
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/**
 * 歌曲节点 → ProviderTrack。
 *
 * 注意 `duration` 在 Subsonic 是**秒**(不是毫秒),与宿主契约一致,直接透传。
 */
export function toProviderTrack(raw: unknown): ProviderTrack | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const title = text(raw.title) ?? text(raw.name);
  if (!id || !title) return null;
  return {
    id,
    title,
    artist: text(raw.artist),
    album: text(raw.album),
    duration: num(raw.duration),
    isVideo: raw.isVideo === true,
  };
}

function pageOf<T>(items: T[], total: number, limit: number, offset: number) {
  return {
    items,
    // Subsonic 多数列表接口不返回总数;用「已取条数」兜底,
    // 让调用方的「还有更多」判断退化成「本页是否取满」。
    total: total >= 0 ? total : offset + items.length,
    limit,
    offset,
  } satisfies ProviderPage<T>;
}

/** `search3` → 歌曲分页。 */
export function parseSearchResult(
  body: SubsonicEnvelope,
  limit: number,
  offset: number,
): ProviderPage<ProviderTrack> {
  const result = isRecord(body.searchResult3)
    ? body.searchResult3
    : isRecord(body.searchResult2)
      ? body.searchResult2
      : undefined;
  if (!result) {
    throw new ProviderError('provider_invalid_response', '搜索结果格式异常');
  }
  const items = asArray(result.song)
    .map(toProviderTrack)
    .filter((track): track is ProviderTrack => track !== null);
  return pageOf(items, num(result.totalHits) ?? -1, limit, offset);
}

/** `getAlbumList2` → 专辑分页。 */
export function parseAlbumList(
  body: SubsonicEnvelope,
  limit: number,
  offset: number,
): ProviderPage<ProviderAlbum> {
  const node = body.albumList2;
  if (!isRecord(node)) {
    throw new ProviderError('provider_invalid_response', '专辑列表格式异常');
  }
  const items: ProviderAlbum[] = [];
  for (const raw of asArray(node.album)) {
    if (!isRecord(raw)) continue;
    const id = text(raw.id);
    const name = text(raw.name) ?? text(raw.title) ?? text(raw.album);
    if (!id || !name) continue;
    items.push({
      id,
      name,
      artist: text(raw.artist),
      trackCount: num(raw.songCount),
      year: num(raw.year),
    });
  }
  return pageOf(items, -1, limit, offset);
}

/** `getAlbum` → 专辑详情(含歌曲列表)。 */
export function parseAlbumDetail(
  body: SubsonicEnvelope,
  limit: number,
  offset: number,
): { album: ProviderAlbum | null; tracks: ProviderPage<ProviderTrack> } {
  const node = body.album;
  if (!isRecord(node)) {
    throw new ProviderError('provider_invalid_response', '专辑详情格式异常');
  }
  const id = text(node.id);
  const name = text(node.name) ?? text(node.title) ?? text(node.album);
  const album: ProviderAlbum | null =
    id && name
      ? {
          id,
          name,
          artist: text(node.artist),
          trackCount: num(node.songCount),
          year: num(node.year),
        }
      : null;
  const tracks = asArray(node.song)
    .map(toProviderTrack)
    .filter((track): track is ProviderTrack => track !== null);
  return { album, tracks: pageOf(tracks, tracks.length, limit, offset) };
}

/** `getPlaylists` → 歌单分页。 */
export function parsePlaylistList(
  body: SubsonicEnvelope,
  limit: number,
  offset: number,
): ProviderPage<ProviderPlaylist> {
  const node = body.playlists;
  if (!isRecord(node)) {
    throw new ProviderError('provider_invalid_response', '歌单列表格式异常');
  }
  const items: ProviderPlaylist[] = [];
  for (const raw of asArray(node.playlist)) {
    if (!isRecord(raw)) continue;
    const id = text(raw.id);
    const name = text(raw.name);
    if (!id || !name) continue;
    items.push({
      id,
      name,
      description: text(raw.comment),
      trackCount: num(raw.songCount),
    });
  }
  return pageOf(items, -1, limit, offset);
}

/** `getPlaylist` → 歌单曲目分页。 */
export function parsePlaylistDetail(
  body: SubsonicEnvelope,
  limit: number,
  offset: number,
): ProviderPage<ProviderTrack> {
  const node = body.playlist;
  if (!isRecord(node)) {
    throw new ProviderError('provider_invalid_response', '歌单详情格式异常');
  }
  const items = asArray(node.entry)
    .map(toProviderTrack)
    .filter((track): track is ProviderTrack => track !== null);
  return pageOf(items, items.length, limit, offset);
}

/** `getSong` → 单曲。 */
export function parseSong(body: SubsonicEnvelope): ProviderTrack | null {
  return toProviderTrack(body.song);
}

/**
 * 歌词节点 → ProviderLyrics。
 *
 * `getLyricsBySongId`(OpenSubsonic)返回结构化的 `lyricsList`,带时间轴;
 * `getLyrics`(标准)只返回纯文本,没有时间轴,只能当无同步歌词用。
 */
export function parseLyrics(body: SubsonicEnvelope): ProviderLyrics | null {
  // 优先:OpenSubsonic 的 getLyricsBySongId
  const list = body.lyricsList;
  if (isRecord(list)) {
    const entries = asArray(list.structuredLyrics);
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const synced = entry.synced === true;
      const line = asArray(entry.line);
      if (synced && line.length) {
        const lrc = line
          .map((raw) => {
            if (!isRecord(raw)) return '';
            const start = num(raw.start);
            const value = text(raw.value) ?? '';
            if (start === undefined || !value) return '';
            return `[${formatLrcTime(start)}]${value}`;
          })
          .filter(Boolean)
          .join('\n');
        if (lrc) return { lrc };
      }
      // 不同步时退化成纯文本,至少能显示
      const plain = line
        .map((raw) => (isRecord(raw) ? (text(raw.value) ?? '') : ''))
        .filter(Boolean)
        .join('\n');
      if (plain) return { lrc: plain };
    }
  }
  // 回退:标准 getLyrics 的纯文本
  const node = body.lyrics;
  if (isRecord(node)) {
    const value = text(node.value) ?? text(node.lyric);
    if (value) return { lrc: value };
  }
  return null;
}

/** 毫秒 → LRC 的 `[mm:ss.xx]`。 */
function formatLrcTime(millis: number): string {
  const totalSeconds = Math.max(0, millis) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}

/** 服务端返回的 `openSubsonic` 能力标记(存在即支持扩展)。 */
export function supportsOpenSubsonic(body: SubsonicEnvelope): boolean {
  return body.openSubsonic === true || body.openSubsonic === 'true';
}

export { isRecord, num, text };
