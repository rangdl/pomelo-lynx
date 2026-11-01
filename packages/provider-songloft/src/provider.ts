import {
  buildProviderUrl,
  isSameProviderOrigin,
  type MusicProvider,
  normalizeProviderBaseUrl,
  type ProviderCapabilities,
  ProviderError,
  ProviderHttp,
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
  redactProviderText,
} from '@pomelo/provider-sdk';

import {
  parseLyricPayload,
  parsePlaylistPage,
  parseSong,
  parseSongPage,
  parseStoredSession,
  parseTokens,
  type SongloftLyricPayload,
  toProviderTrack,
} from './models.js';

const PROVIDER_ID = 'songloft';
const SESSION_KEY = 'pomelo.provider.songloft.session.v1';
const DEFAULT_TIMEOUT_MS = 12_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_PLAYLIST_LIMIT = 50;
const DEFAULT_TRACK_LIMIT = 200;
const MAX_PAGE_SIZE = 500;

export interface SongloftProviderOptions {
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

function isHlsPath(path: string): boolean {
  return /\.m3u8(?:$|\?)/i.test(path);
}

/**
 * Songloft REST provider。
 *
 * 与 Subsonic 不同，Songloft 没有统一响应信封：列表是 `{songs,total}` /
 * `{playlists,total}`，错误是 `{error,detail}`。播放、封面、歌词都是
 * `song.url` / `cover_url` / `lyric_url` 指向的相对资源，需要 Bearer 或
 * `?access_token=`。这里把访问 token 放在播放请求头里，避免把 token
 * 写进播放页可见的 URL；封面交给系统图片加载器，只能使用查询串。
 */
export class SongloftProvider implements MusicProvider {
  readonly id = PROVIDER_ID;
  readonly displayName = 'Songloft';
  readonly capabilities: ProviderCapabilities = {
    login: true,
    search: true,
    playlists: true,
    stream: true,
    lyrics: true,
    artwork: true,
    video: false,
  };

  private readonly runtime: ProviderRuntime;
  private readonly timeoutMs: number;
  private readonly sessionKey: string;
  private _session: ProviderSession | null = null;
  private http: ProviderHttp | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(runtime: ProviderRuntime, options: SongloftProviderOptions = {}) {
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

  private createHttp(serverUrl: string): ProviderHttp {
    return new ProviderHttp({
      baseUrl: serverUrl,
      fetch: this.runtime.fetch,
      timeoutMs: this.timeoutMs,
      getAccessToken: () => this.requireAccessToken(),
      onUnauthorized: async () => {
        const refreshed = await this.refreshAccessToken();
        return refreshed ? (this._session?.accessToken ?? null) : null;
      },
    });
  }

  private requireHttp(): ProviderHttp {
    if (!this.http) {
      throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
    }
    return this.http;
  }

  async login(input: ProviderLoginInput): Promise<ProviderSession> {
    const serverUrl = normalizeProviderBaseUrl(input.serverUrl);
    const username = input.username.trim();
    if (!username) {
      throw new ProviderError('provider_invalid_credentials', '请输入用户名');
    }
    if (!input.password) {
      throw new ProviderError('provider_invalid_credentials', '请输入密码');
    }
    const publicHttp = new ProviderHttp({
      baseUrl: serverUrl,
      fetch: this.runtime.fetch,
      timeoutMs: this.timeoutMs,
    });
    let payload: unknown;
    try {
      payload = await publicHttp.request<unknown>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { username, password: input.password },
      });
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw new ProviderError('provider_login_failed', '用户名或密码错误', {
          status: error.status,
          detail: error.detail ? redactProviderText(error.detail) : undefined,
        });
      }
      throw error;
    }

    const tokens = parseTokens(payload);
    const session: ProviderSession = {
      providerId: PROVIDER_ID,
      serverUrl,
      username,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt:
        tokens.expiresIn > 0 ? this.now() + tokens.expiresIn * 1000 : undefined,
    };
    this._session = session;
    this.http = this.createHttp(serverUrl);
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
    const stored = parseStoredSession(parsed, PROVIDER_ID);
    if (!stored) {
      await this.clearSession();
      return null;
    }

    let serverUrl: string;
    try {
      serverUrl = normalizeProviderBaseUrl(stored.serverUrl);
    } catch {
      await this.clearSession();
      return null;
    }
    this._session = { ...stored, serverUrl };
    this.http = this.createHttp(serverUrl);

    const expiring =
      !!this._session.expiresAt &&
      this._session.expiresAt - TOKEN_REFRESH_MARGIN_MS <= this.now();
    if (!this._session.accessToken || expiring) {
      if (!this._session.refreshToken) {
        await this.clearSession();
        return null;
      }
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) return null;
    }
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
    this.http = null;
    this.refreshPromise = null;
    try {
      await this.runtime.secure.remove(this.sessionKey);
    } catch {
      // 清除失败不阻断登出；内存会话已经失效。
    }
  }

  async logout(): Promise<void> {
    const http = this.http;
    if (http) {
      try {
        await http.request('/auth/logout', { method: 'POST' });
      } catch {
        // 服务端撤销是 best-effort；本地会话必须清除。
      }
    }
    await this.clearSession();
  }

  async ping(): Promise<void> {
    await this.search('', { limit: 1 });
  }

  async refresh(): Promise<void> {
    const refreshed = await this.refreshAccessToken();
    if (!refreshed) {
      throw new ProviderError(
        'provider_session_expired',
        '登录已过期，请重新连接',
        { status: 401 },
      );
    }
  }

  private async requireAccessToken(): Promise<string> {
    if (!this._session) {
      throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
    }
    const expiring =
      !!this._session.expiresAt &&
      this._session.expiresAt - TOKEN_REFRESH_MARGIN_MS <= this.now();
    if (expiring) {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) {
        throw new ProviderError(
          'provider_session_expired',
          '登录已过期，请重新连接',
          { status: 401 },
        );
      }
    }
    const token = this._session?.accessToken;
    if (!token) {
      throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
    }
    return token;
  }

  /** 单飞刷新：并发 401 只发一次 `/auth/refresh`。 */
  private refreshAccessToken(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<boolean> {
    const session = this._session;
    if (!session?.refreshToken) {
      await this.clearSession();
      return false;
    }
    const publicHttp = new ProviderHttp({
      baseUrl: session.serverUrl,
      fetch: this.runtime.fetch,
      timeoutMs: this.timeoutMs,
    });
    try {
      const payload = await publicHttp.request<unknown>('/auth/refresh', {
        method: 'POST',
        auth: false,
        body: { refresh_token: session.refreshToken },
      });
      const tokens = parseTokens(payload);
      const next: ProviderSession = {
        ...session,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt:
          tokens.expiresIn > 0
            ? this.now() + tokens.expiresIn * 1000
            : undefined,
      };
      this._session = next;
      await this.saveSession(next);
      return true;
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.status === 400 || error.status === 401 || error.status === 403)
      ) {
        await this.clearSession();
        return false;
      }
      // 网络/超时不销毁 refresh token，下次请求还可以重试。
      throw error;
    }
  }

  async search(
    query: string,
    options: ProviderSearchOptions = {},
  ): Promise<ProviderPage<ProviderTrack>> {
    const limit = clamp(options.limit, DEFAULT_SEARCH_LIMIT);
    const offset = offsetOf(options.offset);
    const keyword = query.trim() || options.keyword?.trim() || '';
    const order =
      options.order === 'asc' || options.order === 'desc'
        ? options.order
        : undefined;
    const payload = await this.requireHttp().request<unknown>('/songs', {
      query: {
        keyword: keyword || undefined,
        limit,
        offset,
        sort: options.sort?.trim() || undefined,
        order,
        type: options.type?.trim() || undefined,
      },
    });
    return parseSongPage(payload, limit, offset);
  }

  async getTrack(id: string): Promise<ProviderTrack | null> {
    const numeric = Number(id);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
    const payload = await this.requireHttp().request<unknown>(
      `/songs/${numeric}`,
    );
    const song = parseSong(payload);
    return song ? toProviderTrack(song) : null;
  }

  async playlists(
    options: ProviderPageOptions = {},
  ): Promise<ProviderPage<ProviderPlaylist>> {
    const limit = clamp(options.limit, DEFAULT_PLAYLIST_LIMIT);
    const offset = offsetOf(options.offset);
    const payload = await this.requireHttp().request<unknown>('/playlists', {
      query: { limit, offset },
    });
    return parsePlaylistPage(payload, limit, offset);
  }

  async playlistTracks(
    playlistId: string,
    options: ProviderPageOptions = {},
  ): Promise<ProviderPage<ProviderTrack>> {
    const limit = clamp(options.limit, DEFAULT_TRACK_LIMIT);
    const offset = offsetOf(options.offset);
    const id = Number(playlistId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new ProviderError('provider_invalid_response', '歌单 ID 无效');
    }
    const payload = await this.requireHttp().request<unknown>(
      `/playlists/${id}/songs`,
      { query: { limit, offset } },
    );
    return parseSongPage(payload, limit, offset);
  }

  async stream(track: ProviderTrack): Promise<ProviderStream> {
    const token = await this.requireAccessToken();
    const raw = track.resource?.stream ?? `/api/v1/songs/${track.id}/play`;
    const url = buildProviderUrl(this._session?.serverUrl ?? '', raw);
    return {
      url,
      headers: isSameProviderOrigin(this._session?.serverUrl ?? '', url)
        ? { Authorization: `Bearer ${token}` }
        : undefined,
      isVideo: track.isVideo,
      isLive: track.isLive || isHlsPath(raw),
    };
  }

  async lyrics(track: ProviderTrack): Promise<ProviderLyrics | null> {
    const raw = track.resource?.lyrics ?? `/api/v1/songs/${track.id}/lyric`;
    const payload = await this.requireHttp().request<unknown>(raw);
    const lyric = parseLyricPayload(payload);
    return toProviderLyrics(lyric);
  }

  async artwork(track: ProviderTrack, size = 512): Promise<string | null> {
    const raw = track.resource?.artwork ?? `/api/v1/songs/${track.id}/cover`;
    const token = await this.requireAccessToken();
    const url = buildProviderUrl(this._session?.serverUrl ?? '', raw);
    if (!isSameProviderOrigin(this._session?.serverUrl ?? '', url)) {
      return url;
    }
    return buildProviderUrl(this._session?.serverUrl ?? '', raw, {
      w: size,
      access_token: token,
    });
  }
}

function toProviderLyrics(value: SongloftLyricPayload): ProviderLyrics | null {
  if (!value.lyric && !value.tlyric && !value.rlyric && !value.lxlyric) {
    return null;
  }
  return {
    lrc: value.lyric,
    translated: value.tlyric,
    romaji: value.rlyric,
    wordByWord: value.lxlyric,
  };
}
