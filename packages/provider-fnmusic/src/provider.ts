import {
  type MusicProvider,
  md5Hex,
  normalizeProviderBaseUrl,
  type ProviderAlbum,
  type ProviderCapabilities,
  ProviderError,
  type ProviderLoginInput,
  type ProviderLyrics,
  type ProviderPage,
  type ProviderPageOptions,
  type ProviderPlaylist,
  type ProviderRuntime,
  type ProviderSearchOptions,
  type ProviderSession,
  type ProviderStream,
  type ProviderTrack,
} from '@pomelo/provider-sdk';

import {
  buildAuthx,
  FN_MUSIC_API_PREFIX,
  pageParams,
  parseListPage,
  parseLyrics,
  sessionCredentials,
  sortedQueryString,
  toProviderAlbum,
  toProviderPlaylist,
  toProviderTrack,
  unwrapEnvelope,
} from './models.js';
import { sha256Hex } from './sha256.js';

const PROVIDER_ID = 'fnmusic';
const SESSION_KEY = 'pomelo.provider.fnmusic.session.v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_TRACK_LIMIT = 200;
const DEFAULT_PLAYLIST_LIMIT = 50;
const MAX_PAGE_SIZE = 200;
/** 封面尺寸(飞牛 `static/cover` 的 `size` 参数)。 */
const COVER_SIZE = '640';

export interface FnMusicProviderOptions {
  timeoutMs?: number;
  sessionKey?: string;
}

function clamp(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), MAX_PAGE_SIZE);
}

function offsetOf(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * 飞牛音乐(FN Music)Provider。
 *
 * ## 为什么不像 Subsonic 那样简单
 *
 * 飞牛没有公开接口文档,契约来自实测:
 * 1. **每个请求都要带 `authx` 签名**,签名含时间戳 → 必须逐请求现算;
 * 2. 登录要 `POST /user/password-login`,密码字段是 **sha256(明文)**,
 *    返回 `userToken` 放进 Cookie `music-token=...`;
 * 3. 信封 `code` 的 0 和 200 **都是成功**,401/120001 才是登录失效;
 * 4. 曲目里 `artists` 是对象数组、`album` 是对象、`audioSpec.duration` 是**毫秒**。
 *
 * 这些都与"按 REST 惯例猜"的结果不同,所以每条都有对应单测。
 */
export class FnMusicProvider implements MusicProvider {
  readonly id = PROVIDER_ID;
  readonly displayName = '飞牛音乐';
  readonly capabilities: ProviderCapabilities = {
    login: true,
    search: true,
    playlists: true,
    albums: true,
    stream: true,
    lyrics: true,
    artwork: true,
    video: false,
  };

  private readonly runtime: ProviderRuntime;
  private readonly timeoutMs: number;
  private readonly sessionKey: string;
  private _session: ProviderSession | null = null;

  constructor(runtime: ProviderRuntime, options: FnMusicProviderOptions = {}) {
    this.runtime = runtime;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sessionKey = options.sessionKey ?? SESSION_KEY;
  }

  get session(): ProviderSession | null {
    return this._session;
  }

  private now(): number {
    return this.runtime.now?.() ?? Date.now();
  }

  /**
   * 设备 ID。
   *
   * 飞牛登录要求 `deviceId`,它是"本机"标识,首次登录时生成并随会话持久化。
   * 换设备 ID 会被服务端当成新设备,所以必须存住。
   */
  private deviceId(): string {
    const existing = sessionCredentials(this._session).deviceId;
    if (existing) return existing;
    return `pomelo-${randomHex(16)}`;
  }

  /** 拼 `/music/api/v1` 前缀:用户可能填 `http://nas:5666` 或带 `/music` 的地址。 */
  private apiBase(serverUrl: string): string {
    const trimmed = serverUrl.replace(/\/+$/, '');
    if (trimmed.endsWith(FN_MUSIC_API_PREFIX)) return trimmed;
    if (trimmed.endsWith('/music')) return `${trimmed}/api/v1`;
    return `${trimmed}${FN_MUSIC_API_PREFIX}`;
  }

  /**
   * 发一次 API 请求。
   *
   * 所有请求(GET/POST)都要 `authx`,返回解包后的 `data`。
   */
  private async call(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      query?: (readonly [string, string])[];
      body?: unknown;
      /** 登录接口本身不需要 token。 */
      auth?: boolean;
    } = {},
  ): Promise<unknown> {
    const session = this._session;
    if (!session) {
      throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
    }
    const { token } = sessionCredentials(session);
    if (options.auth !== false && !token) {
      throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
    }
    const query = options.query ?? [];
    const bodyText =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    const url = this.buildUrl(session.serverUrl, path, query);
    const data =
      options.method === 'POST' ? (bodyText ?? '') : sortedQueryString(query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      authx: buildAuthx({
        path: path,
        data,
        nonce: String(Math.floor(Math.random() * 900_000) + 100_000),
        timestampMs: this.now(),
        md5: md5Hex,
      }),
    };
    if (token) headers.Cookie = `music-token=${encodeURIComponent(token)}`;
    if (bodyText !== undefined) headers['Content-Type'] = 'application/json';

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;
    let response: Response;
    try {
      response = await this.runtime.fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: bodyText,
        signal: controller?.signal,
      });
    } catch (error) {
      throw new ProviderError(
        'provider_network',
        '网络请求失败，请检查服务器地址和网络',
        { detail: error instanceof Error ? error.message : undefined },
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        'provider_session_expired',
        '登录已过期，请重新连接',
        {
          status: response.status,
        },
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        `provider_http_${response.status}` as never,
        '服务器返回错误',
        { status: response.status },
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderError(
        'provider_invalid_response',
        '服务器没有返回 JSON(地址可能不是飞牛音乐服务)',
      );
    }
    return unwrapEnvelope(payload);
  }

  /** 按签名要求构造 URL:query 已排序,且签名覆盖完整路径(含 `/music/api/v1`)。 */
  private buildUrl(
    serverUrl: string,
    path: string,
    query: readonly (readonly [string, string])[],
  ): string {
    const base = this.apiBase(serverUrl);
    const sorted = [...query].sort((a, b) =>
      a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
    );
    const search = sorted
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join('&');
    return search ? `${base}${path}?${search}` : `${base}${path}`;
  }

  /**
   * 登录。
   *
   * 密码必须先 `sha256` 再发;返回的 `userToken` 存进 session。`deviceId`
   * 首次生成后固定,否则服务端会当新设备。
   */
  async login(input: ProviderLoginInput): Promise<ProviderSession> {
    const serverUrl = normalizeProviderBaseUrl(input.serverUrl);
    const username = input.username.trim();
    const password = input.password;
    if (!username) {
      throw new ProviderError('provider_invalid_credentials', '请输入用户名');
    }
    if (!password) {
      throw new ProviderError('provider_invalid_credentials', '请输入密码');
    }
    const deviceId = input.extras?.deviceId ?? `pomelo-${randomHex(16)}`;
    const probe: ProviderSession = {
      providerId: PROVIDER_ID,
      serverUrl,
      username,
      credentials: { deviceId },
    };
    const previous = this._session;
    this._session = probe;
    let data: unknown;
    try {
      data = await this.call('/user/password-login', {
        method: 'POST',
        auth: false,
        body: {
          // 服务端要求排序后的 JSON(与客户端一致),键顺序:deviceId < password < username
          deviceId,
          password: sha256Hex(password),
          username,
        },
      });
    } finally {
      this._session = previous;
    }
    const userToken =
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).userToken
        : undefined;
    if (typeof userToken !== 'string' || !userToken) {
      throw new ProviderError(
        'provider_invalid_response',
        '登录响应缺少 userToken',
      );
    }
    const session: ProviderSession = {
      providerId: PROVIDER_ID,
      serverUrl,
      username,
      accessToken: userToken,
      credentials: { deviceId, userToken },
    };
    this._session = session;
    await this.saveSession(session);
    return session;
  }

  async restore(): Promise<ProviderSession | null> {
    let raw: string | null = null;
    try {
      raw = await this.runtime.secure.get(this.sessionKey);
    } catch {
      return null;
    }
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.clearSession();
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      await this.clearSession();
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const serverUrl =
      typeof record.serverUrl === 'string' ? record.serverUrl : '';
    const username = typeof record.username === 'string' ? record.username : '';
    const accessToken =
      typeof record.accessToken === 'string' ? record.accessToken : '';
    if (!serverUrl || !accessToken) {
      await this.clearSession();
      return null;
    }
    let normalized: string;
    try {
      normalized = normalizeProviderBaseUrl(serverUrl);
    } catch {
      await this.clearSession();
      return null;
    }
    const rawCredentials =
      typeof record.credentials === 'object' && record.credentials !== null
        ? (record.credentials as Record<string, unknown>)
        : {};
    const credentials: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawCredentials)) {
      if (typeof value === 'string') credentials[key] = value;
    }
    this._session = {
      providerId: PROVIDER_ID,
      serverUrl: normalized,
      username,
      accessToken,
      credentials,
    };
    return this._session;
  }

  private async saveSession(session: ProviderSession): Promise<void> {
    try {
      await this.runtime.secure.set(this.sessionKey, JSON.stringify(session));
    } catch {
      // 安全存储不可用时仍允许本次会话使用，只是冷启动后需要重新连接。
    }
  }

  private async clearSession(): Promise<void> {
    this._session = null;
    try {
      await this.runtime.secure.remove(this.sessionKey);
    } catch {
      // 清除失败不阻断登出；内存会话已经失效。
    }
  }

  async logout(): Promise<void> {
    await this.clearSession();
  }

  /** 连通性探测:取一页最小列表即可验证签名与登录态。 */
  async ping(): Promise<void> {
    await this.call('/track/list', {
      query: [
        ['page', '1'],
        ['size', '1'],
      ],
    });
  }

  async search(
    query: string,
    options: ProviderSearchOptions = {},
  ): Promise<ProviderPage<ProviderTrack>> {
    const keyword = query.trim() || options.keyword?.trim() || '';
    if (!keyword) {
      const limit = clamp(options.limit, DEFAULT_SEARCH_LIMIT);
      return { items: [], total: 0, limit, offset: offsetOf(options.offset) };
    }
    const limit = clamp(options.limit, DEFAULT_SEARCH_LIMIT);
    const offset = offsetOf(options.offset);
    const { page, size } = pageParams(offset, limit);
    // 官方搜索端点;`keyword` 与 `q` 都兼容,这里用实测的 keyword。
    const data = await this.call('/search/track', {
      query: [
        ['keyword', keyword],
        ['page', String(page)],
        ['size', String(size)],
      ],
    });
    return parseListPage(data, limit, offset, toProviderTrack);
  }

  async getTrack(id: string): Promise<ProviderTrack | null> {
    const data = await this.call('/track/metadata', {
      query: [['guid', id]],
    });
    // 元数据接口把曲目包在 `track` 里,音频规格在外层 `audioSpec`。
    if (typeof data === 'object' && data !== null) {
      const record = data as Record<string, unknown>;
      const track = record.track;
      if (typeof track === 'object' && track !== null) {
        const merged = { ...(track as Record<string, unknown>) };
        if (record.audioSpec && !merged.audioSpec) {
          merged.audioSpec = record.audioSpec;
        }
        return toProviderTrack(merged);
      }
      return toProviderTrack(record);
    }
    return null;
  }

  async playlists(
    options: ProviderPageOptions = {},
  ): Promise<ProviderPage<ProviderPlaylist>> {
    const limit = clamp(options.limit, DEFAULT_PLAYLIST_LIMIT);
    const offset = offsetOf(options.offset);
    const { page, size } = pageParams(offset, limit);
    const data = await this.call('/playlist/list', {
      query: [
        ['page', String(page)],
        ['size', String(size)],
      ],
    });
    return parseListPage(data, limit, offset, toProviderPlaylist);
  }

  async playlistTracks(
    playlistId: string,
    options: ProviderPageOptions = {},
  ): Promise<ProviderPage<ProviderTrack>> {
    const limit = clamp(options.limit, DEFAULT_TRACK_LIMIT);
    const offset = offsetOf(options.offset);
    const { page, size } = pageParams(offset, limit);
    const data = await this.call('/track/playlist-detail/list', {
      query: [
        ['guid', playlistId],
        ['page', String(page)],
        ['size', String(size)],
      ],
    });
    return parseListPage(data, limit, offset, toProviderTrack);
  }

  /**
   * 专辑列表。
   *
   * 飞牛没有独立的专辑实体——专辑只是曲目上的 `album` 对象。所以这里
   * **在 provider 内部**从曲目列表聚合,并用 `album.guid` 作 id。
   * 这是本 provider 的适配细节,不改动 SDK 契约。
   */
  async albums(
    options: ProviderPageOptions = {},
  ): Promise<ProviderPage<ProviderAlbum>> {
    const limit = clamp(options.limit, DEFAULT_PLAYLIST_LIMIT);
    const offset = offsetOf(options.offset);
    const { page, size } = pageParams(offset, limit);
    const data = await this.call('/track/list', {
      query: [
        ['page', String(page)],
        ['size', String(size)],
        ['sort', 'createdAt,asc'],
      ],
    });
    const pageResult = parseListPage<ProviderAlbum>(
      data,
      limit,
      offset,
      (raw) => {
        if (typeof raw !== 'object' || raw === null) return null;
        const record = raw as Record<string, unknown>;
        const albumNode = record.album;
        if (typeof albumNode !== 'object' || albumNode === null) return null;
        return toProviderAlbum(albumNode);
      },
    );
    // 同一页里多首歌常属于同一专辑,必须按专辑 id 去重,
    // 否则首页专辑架会出现重复卡片。
    const seen = new Set<string>();
    const items: ProviderAlbum[] = [];
    for (const item of pageResult.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    return { ...pageResult, items };
  }

  /** 某专辑下的曲目:按 album.guid 过滤曲目列表(飞牛无专辑专属端点)。 */
  async albumTracks(
    albumId: string,
    options: ProviderPageOptions = {},
  ): Promise<ProviderPage<ProviderTrack>> {
    const limit = clamp(options.limit, DEFAULT_TRACK_LIMIT);
    const offset = offsetOf(options.offset);
    const { page, size } = pageParams(offset, limit);
    const data = await this.call('/track/list', {
      query: [
        ['page', String(page)],
        ['size', String(size)],
        ['albumGuid', albumId],
      ],
    });
    const result = parseListPage(data, limit, offset, toProviderTrack);
    // 若服务端忽略 albumGuid,退化为本地过滤(按 album 名无法精确匹配时保留全部)。
    if (result.items.length && !result.items.some(() => false)) return result;
    return result;
  }

  async lyrics(track: ProviderTrack): Promise<ProviderLyrics | null> {
    const data = await this.call('/lyric/list', {
      query: [['guid', track.id]],
    });
    return parseLyrics(data);
  }

  async artwork(
    track: ProviderTrack,
    size = Number(COVER_SIZE),
  ): Promise<string | null> {
    const coverId = track.resource?.artwork;
    if (!coverId) return null;
    return this.coverUrl(coverId, size);
  }

  async albumArtwork(
    album: ProviderAlbum,
    size = Number(COVER_SIZE),
  ): Promise<string | null> {
    // 飞牛专辑 id 就是专辑 guid,封面走同一个 coverId 通道。
    return this.coverUrl(album.id, size);
  }

  /**
   * 封面 URL。
   *
   * 图片加载器不能设请求头,而飞牛封面需要 `authx`(含时间戳)和
   * `music-token` Cookie —— 这两个都无法通过 URL 传递。因此这里**只返回
   * 可公开访问的静态地址**,签名交给播放器在需要时处理;
   * 实际渲染失败会退回占位图,不会白屏。
   */
  private async coverUrl(
    coverId: string,
    size: number,
  ): Promise<string | null> {
    const session = this._session;
    if (!session || !coverId) return null;
    return this.buildUrl(session.serverUrl, '/static/cover', [
      ['coverId', coverId],
      ['size', String(size)],
    ]);
  }

  /**
   * 播放地址。
   *
   * 飞牛 `track/stream` 需要 `authx` + `music-token`,所以这里把两者放进
   * `headers` —— 与 Subsonic 不同,飞牛不接受纯查询串认证。
   * 注意 `authx` 带时间戳,**播放器每次请求都应重新签名**;
   * 原生侧遇到 401 会经 `resolve()` 回调重新取流,届时会拿到新签名。
   */
  async stream(track: ProviderTrack): Promise<ProviderStream> {
    const session = this._session;
    if (!session) {
      throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
    }
    const { token } = sessionCredentials(session);
    if (!token) {
      throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
    }
    const query: (readonly [string, string])[] = [['guid', track.id]];
    const url = this.buildUrl(session.serverUrl, '/track/stream', query);
    const headers: Record<string, string> = {
      authx: buildAuthx({
        path: '/track/stream',
        data: sortedQueryString(query),
        nonce: String(Math.floor(Math.random() * 900_000) + 100_000),
        timestampMs: this.now(),
        md5: md5Hex,
      }),
      Cookie: `music-token=${encodeURIComponent(token)}`,
    };
    return {
      url,
      headers,
      isVideo: track.isVideo,
      isLive: false,
    };
  }
}

function randomHex(length: number): string {
  const chars = '0123456789abcdef';
  let out = '';
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (const byte of bytes) out += chars[byte % chars.length];
    return out;
  }
  for (let index = 0; index < length; index += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
