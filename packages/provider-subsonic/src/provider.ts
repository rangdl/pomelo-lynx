import {
  buildProviderUrl,
  isSameProviderOrigin,
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
  isRecord,
  parseAlbumDetail,
  parseAlbumList,
  parseLyrics,
  parsePlaylistDetail,
  parsePlaylistList,
  parseSearchResult,
  parseSong,
  supportsOpenSubsonic,
  text,
  unwrapEnvelope,
} from './models.js';

const PROVIDER_ID = 'subsonic';
const SESSION_KEY = 'pomelo.provider.subsonic.session.v1';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_TRACK_LIMIT = 200;
const DEFAULT_PLAYLIST_LIMIT = 50;
const MAX_PAGE_SIZE = 500;

/**
 * 客户端声明的协议版本。
 *
 * 1.16.1 是 Subsonic 官方 REST API 的最终版本,Navidrome 也明确声明兼容
 * 到这个版本。声明 1.16.1 才能用 search3 / getAlbumList2 / getLyricsBySongId。
 */
const API_VERSION = '1.16.1';
const CLIENT_NAME = 'Pomelo';

export interface SubsonicProviderOptions {
  timeoutMs?: number;
  sessionKey?: string;
  /** 显示名,用于在同一套实现上区分 Subsonic / Navidrome。 */
  displayName?: string;
  providerId?: string;
}

function clamp(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), MAX_PAGE_SIZE);
}

function offsetOf(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

/**
 * Subsonic / Navidrome Provider。
 *
 * ## 为什么不用 ProviderHttp
 *
 * `ProviderHttp` 默认把 token 塞 `Authorization: Bearer`,而 Subsonic 的认证
 * 是**查询串**里的 `u` / `t` / `s`(或 `p` / `apiKey`),而且盐必须**每次
 * 请求重新随机生成**。所以这里自己拼 URL。
 *
 * ## 为什么只走 /rest
 *
 * Navidrome 另有原生 `/api/*` 接口(音流在用),但那是**没有官方文档、靠抓包
 * 整理**的私有 API,且 0.55 版本重构过。`/rest` 才是 Subsonic 生态的稳定
 * 契约,Navidrome 官方向后兼容到 v1.16.1。所以两家统一走 `/rest`。
 */
export class SubsonicProvider implements MusicProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities = {
    login: true,
    search: true,
    playlists: true,
    albums: true,
    stream: true,
    lyrics: true,
    artwork: true,
    // Subsonic 官方有视频,但 Navidrome 明确不会实现;统一关掉避免两端行为不一致。
    video: false,
  };

  private readonly runtime: ProviderRuntime;
  private readonly timeoutMs: number;
  private readonly sessionKey: string;
  private _session: ProviderSession | null = null;
  /** 服务端是否支持 OpenSubsonic 扩展(决定歌词走哪个端点)。 */
  private openSubsonic: boolean | null = null;

  constructor(runtime: ProviderRuntime, options: SubsonicProviderOptions = {}) {
    this.runtime = runtime;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sessionKey = options.sessionKey ?? SESSION_KEY;
    this.id = options.providerId ?? PROVIDER_ID;
    this.displayName = options.displayName ?? 'Subsonic';
  }

  get session(): ProviderSession | null {
    return this._session;
  }

  private now(): number {
    return this.runtime.now?.() ?? Date.now();
  }

  /**
   * 生成一次请求的认证查询参数。
   *
   * 密码模式按官方规范:`t = md5(password + salt)`、`s = salt`,
   * **盐必须每条请求重新随机**(至少 6 字符),不能复用。
   * API Key 模式(`apiKey`)是 Navidrome 的扩展,不在 Subsonic 官方文档里。
   */
  private authQuery(): Record<string, string> {
    const session = this._session;
    if (!session) {
      throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
    }
    const credentials = session.credentials ?? {};
    const authMode = credentials.authMode ?? 'password';
    const query: Record<string, string> = {
      v: API_VERSION,
      c: CLIENT_NAME,
      f: 'json',
    };
    if (authMode === 'apiKey') {
      const key = credentials.apiKey ?? '';
      if (!key) {
        throw new ProviderError('provider_auth_required', '缺少 API Key');
      }
      query.apiKey = key;
      return query;
    }
    const salt = randomSalt();
    query.u = session.username;
    query.s = salt;
    query.t = md5Hex(`${session.accessToken ?? ''}${salt}`);
    return query;
  }

  private async request<T>(
    endpoint: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const session = this._session;
    if (!session) {
      throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
    }
    const merged: Record<string, string | number | boolean | undefined> = {
      ...this.authQuery(),
      ...query,
    };
    const url = buildProviderUrl(
      session.serverUrl,
      `/rest/${endpoint}`,
      merged as never,
    );
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;
    let response: Response;
    try {
      response = await this.runtime.fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
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
        {
          status: response.status,
        },
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderError(
        'provider_invalid_response',
        '服务器没有返回 JSON(地址可能不是 Subsonic 兼容服务)',
      );
    }
    return payload as T;
  }

  /** 解包信封并把 `openSubsonic` 能力记下来。 */
  private unwrap(payload: unknown) {
    const body = unwrapEnvelope(payload);
    if (this.openSubsonic === null) {
      this.openSubsonic = supportsOpenSubsonic(body);
    }
    return body;
  }

  async login(input: ProviderLoginInput): Promise<ProviderSession> {
    const serverUrl = normalizeProviderBaseUrl(input.serverUrl);
    const username = input.username.trim();
    const password = input.password;
    const authMode =
      input.extras?.authMode === 'apiKey' ? 'apiKey' : 'password';
    // API Key 模式不需要用户名:服务端从 key 反查账号。
    if (authMode === 'password' && !username) {
      throw new ProviderError('provider_invalid_credentials', '请输入用户名');
    }
    if (!password) {
      throw new ProviderError('provider_invalid_credentials', '请输入密码');
    }
    // 先用候选凭据 ping 一次,确认地址和凭据都对,再落盘会话。
    const probe = new SubsonicProvider(this.runtime, {
      timeoutMs: this.timeoutMs,
      providerId: this.id,
      displayName: this.displayName,
    });
    probe._session = {
      providerId: this.id,
      serverUrl,
      username,
      accessToken: password,
      credentials:
        authMode === 'apiKey' ? { authMode, apiKey: password } : { authMode },
    };
    const body = probe.unwrap(await probe.request('ping'));
    this.openSubsonic = supportsOpenSubsonic(body);

    const session: ProviderSession = {
      providerId: this.id,
      serverUrl,
      username: probe._session.username,
      accessToken: password,
      credentials:
        authMode === 'apiKey' ? { authMode, apiKey: password } : { authMode },
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
    if (!isRecordValue(parsed)) {
      await this.clearSession();
      return null;
    }
    const serverUrl = text(parsed.serverUrl);
    // API Key 模式下 username 可以为空(服务端按 key 识别账号)。
    const username = text(parsed.username) ?? '';
    const accessToken = text(parsed.accessToken);
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
    const credentials = isRecordValue(parsed.credentials)
      ? Object.fromEntries(
          Object.entries(parsed.credentials).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined;
    this._session = {
      providerId: this.id,
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
    this.openSubsonic = null;
    try {
      await this.runtime.secure.remove(this.sessionKey);
    } catch {
      // 清除失败不阻断登出；内存会话已经失效。
    }
  }

  async logout(): Promise<void> {
    await this.clearSession();
  }

  /** 连通性探测:`ping` 是 Subsonic 最轻的端点。 */
  async ping(): Promise<void> {
    this.unwrap(await this.request('ping'));
  }

  async search(
    query: string,
    options: ProviderSearchOptions = {},
  ): Promise<ProviderPage<ProviderTrack>> {
    const limit = clamp(options.limit, DEFAULT_SEARCH_LIMIT);
    const offset = offsetOf(options.offset);
    const keyword = query.trim() || options.keyword?.trim() || '';
    if (!keyword) {
      return { items: [], total: 0, limit, offset };
    }
    // search3 是 1.8.0+ 的 ID3 版本;Navidrome 明确支持。
    // 只取歌曲,专辑/艺人由各自的列表接口负责。
    const body = this.unwrap(
      await this.request('search3', {
        query: keyword,
        songCount: limit,
        songOffset: offset,
        albumCount: 0,
        artistCount: 0,
      }),
    );
    return parseSearchResult(body, limit, offset);
  }

  async getTrack(id: string): Promise<ProviderTrack | null> {
    const body = this.unwrap(await this.request('getSong', { id }));
    return parseSong(body);
  }

  async playlists(
    options: ProviderPageOptions = {},
  ): Promise<ProviderPage<ProviderPlaylist>> {
    const limit = clamp(options.limit, DEFAULT_PLAYLIST_LIMIT);
    const offset = offsetOf(options.offset);
    // 不传 username:该参数在 Navidrome 上未实现,传了反而可能报错。
    const body = this.unwrap(await this.request('getPlaylists'));
    const page = parsePlaylistList(body, limit, offset);
    // getPlaylists 不支持分页,在本地切片。
    return {
      items: page.items.slice(offset, offset + limit),
      total: page.items.length,
      limit,
      offset,
    };
  }

  async playlistTracks(
    playlistId: string,
    options: ProviderPageOptions = {},
  ): Promise<ProviderPage<ProviderTrack>> {
    const limit = clamp(options.limit, DEFAULT_TRACK_LIMIT);
    const offset = offsetOf(options.offset);
    const body = this.unwrap(
      await this.request('getPlaylist', { id: playlistId }),
    );
    const page = parsePlaylistDetail(body, limit, offset);
    // getPlaylist 一次返回全部曲目,在本地分页。
    return {
      items: page.items.slice(offset, offset + limit),
      total: page.items.length,
      limit,
      offset,
    };
  }

  async albums(
    options: ProviderPageOptions = {},
  ): Promise<ProviderPage<ProviderAlbum>> {
    const limit = clamp(options.limit, DEFAULT_PLAYLIST_LIMIT);
    const offset = offsetOf(options.offset);
    // 必须走 getAlbumList2:getArtists 不支持分页(size/offset),
    // 只有 albumList2 能真正翻页。
    const body = this.unwrap(
      await this.request('getAlbumList2', {
        type: 'alphabeticalByName',
        size: limit,
        offset,
      }),
    );
    return parseAlbumList(body, limit, offset);
  }

  async albumTracks(
    albumId: string,
    options: ProviderPageOptions = {},
  ): Promise<ProviderPage<ProviderTrack>> {
    const limit = clamp(options.limit, DEFAULT_TRACK_LIMIT);
    const offset = offsetOf(options.offset);
    const body = this.unwrap(await this.request('getAlbum', { id: albumId }));
    const { tracks } = parseAlbumDetail(body, limit, offset);
    return {
      items: tracks.items.slice(offset, offset + limit),
      total: tracks.items.length,
      limit,
      offset,
    };
  }

  /**
   * 歌词。
   *
   * 优先 `getLyricsBySongId`(OpenSubsonic 扩展,带时间轴,能生成 LRC);
   * 老服务端没有该端点时回退标准 `getLyrics`(按艺人+歌名查,纯文本)。
   */
  async lyrics(track: ProviderTrack): Promise<ProviderLyrics | null> {
    if (this.openSubsonic !== false) {
      try {
        const body = this.unwrap(
          await this.request('getLyricsBySongId', { id: track.id }),
        );
        const parsed = parseLyrics(body);
        if (parsed) return parsed;
      } catch (error) {
        // 只有「端点不存在」才回退;网络/鉴权错误必须抛出去。
        if (!isUnsupportedEndpoint(error)) throw error;
        this.openSubsonic = false;
      }
    }
    if (!track.artist) return null;
    const body = this.unwrap(
      await this.request('getLyrics', {
        artist: track.artist,
        title: track.title,
      }),
    );
    return parseLyrics(body);
  }

  async artwork(track: ProviderTrack, size = 256): Promise<string | null> {
    return this.coverArtUrl(track.id, size);
  }

  async albumArtwork(album: ProviderAlbum, size = 256): Promise<string | null> {
    return this.coverArtUrl(album.id, size);
  }

  /**
   * 封面 URL。
   *
   * 图片加载器不能设请求头,所以认证参数只能进查询串——这与其它 provider
   * 采用同一套折中。URL 里带 token,故不要缓存到日志里。
   */
  private async coverArtUrl(id: string, size: number): Promise<string | null> {
    const session = this._session;
    if (!session || !id) return null;
    const query = this.authQuery();
    const url = buildProviderUrl(session.serverUrl, '/rest/getCoverArt', {
      ...query,
      id,
      size,
    });
    return isSameProviderOrigin(session.serverUrl, url) ? url : null;
  }

  /**
   * 播放地址。
   *
   * Subsonic 的 `stream` 走查询串认证,不返回需要额外 header 的地址,
   * 所以 `headers` 留空。
   */
  async stream(track: ProviderTrack): Promise<ProviderStream> {
    const session = this._session;
    if (!session) {
      throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
    }
    const url = buildProviderUrl(session.serverUrl, '/rest/stream', {
      ...this.authQuery(),
      id: track.id,
    });
    return {
      url,
      isVideo: track.isVideo,
      isLive: false,
    };
  }
}

/** 端点不存在(老服务端不支持 OpenSubsonic)时可回退。 */
function isUnsupportedEndpoint(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.code === 'provider_not_found') return true;
  return error.status === 404 || error.status === 50;
}

function randomSalt(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (const byte of bytes) out += chars[byte % chars.length];
    return out;
  }
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
