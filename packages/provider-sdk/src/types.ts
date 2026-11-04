export interface ProviderCapabilities {
  login: boolean;
  search: boolean;
  playlists: boolean;
  /** 服务端是否提供专辑浏览;为 false 时宿主不展示专辑架。 */
  albums: boolean;
  stream: boolean;
  lyrics: boolean;
  artwork: boolean;
  video: boolean;
}

export interface ProviderPage<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface ProviderPageOptions {
  limit?: number;
  offset?: number;
}

/** Provider 声明的资源位置；可相对服务端，也可以是绝对 URL。 */
export interface ProviderTrackResource {
  stream?: string;
  artwork?: string;
  lyrics?: string;
}

export interface ProviderTrack {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  /** 秒；未知时省略。 */
  duration?: number;
  isVideo?: boolean;
  isLive?: boolean;
  resource?: ProviderTrackResource;
}

export interface ProviderPlaylist {
  id: string;
  name: string;
  description?: string;
  trackCount?: number;
  artwork?: string;
}

/**
 * 专辑条目。
 *
 * Songloft 后端**没有** `/albums` 资源端点:专辑是曲库的一个分面维度,
 * 数据来自 `GET /songs/facets?field=album`,每项只有 `{ value, count, cover_url }`。
 * 因此专辑**没有 ID**,身份就是专辑名 —— 详情用 `GET /songs?album=<name>` 取歌。
 * 不要给这里加 `id`:那是按歌单契约臆想出来的,真实服务端不存在。
 *
 * 服务端是否真的提供专辑浏览由 `capabilities.albums` 与 `albums()` 共同决定。
 */
export interface ProviderAlbum {
  /** 专辑名,同时是该专辑的唯一标识(分面维度没有独立 ID)。 */
  name: string;
  /** 该专辑下的歌曲数(分面接口的 `count`);未知时省略。 */
  trackCount?: number;
  /** 封面资源路径,相对服务端或绝对 URL;列表接口直接给,不必再拼路径。 */
  artwork?: string;
}

export interface ProviderStream {
  url: string;
  headers?: Record<string, string>;
  isVideo?: boolean;
  isLive?: boolean;
}

export interface ProviderLyrics {
  /** 同步 LRC；宿主直接交给 parseLrc。 */
  lrc?: string;
  translated?: string;
  romaji?: string;
  /** 逐字歌词，当前宿主不渲染。 */
  wordByWord?: string;
}

export interface ProviderSession {
  providerId: string;
  serverUrl: string;
  username: string;
  accessToken?: string;
  refreshToken?: string;
  /** 毫秒时间戳；0/省略表示未知。 */
  expiresAt?: number;
}

export interface ProviderLoginInput {
  serverUrl: string;
  username: string;
  password: string;
}

export interface ProviderSecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type ProviderFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ProviderRuntime {
  fetch: ProviderFetch;
  secure: ProviderSecureStore;
  now?: () => number;
}

export interface ProviderSearchOptions extends ProviderPageOptions {
  keyword?: string;
  /** 服务端排序字段，例如 Songloft 的 `added_at` / `title`。 */
  sort?: string;
  order?: 'asc' | 'desc';
  /** 服务端歌曲类型：local / remote / radio。 */
  type?: string;
}

/**
 * 音乐源契约。宿主只依赖这个接口；新增服务端时实现同一组方法，
 * 不把服务端字段泄漏到播放页或设置页。
 */
export interface MusicProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  readonly session: ProviderSession | null;

  login(input: ProviderLoginInput): Promise<ProviderSession>;
  restore(): Promise<ProviderSession | null>;
  logout(): Promise<void>;
  ping(): Promise<void>;
  /** 强制刷新会话；原生收到 401/403 后调用，不能只复用缓存 token。 */
  refresh?(): Promise<void>;

  search(
    query: string,
    options?: ProviderSearchOptions,
  ): Promise<ProviderPage<ProviderTrack>>;
  /** 按 Provider 内 ID 重新取曲目，供队列恢复/刷新重挂 resolve 使用。 */
  getTrack?(id: string): Promise<ProviderTrack | null>;
  playlists(
    options?: ProviderPageOptions,
  ): Promise<ProviderPage<ProviderPlaylist>>;
  /** 歌单封面；图片加载器不能设 header，通常需要查询串 token。 */
  playlistArtwork?(
    playlist: ProviderPlaylist,
    size?: number,
  ): Promise<string | null>;
  playlistTracks(
    playlistId: string,
    options?: ProviderPageOptions,
  ): Promise<ProviderPage<ProviderTrack>>;

  /**
   * 专辑浏览。三个方法都是可选的:服务端未实现专辑时宿主隐藏专辑架,
   * 不做降级聚合(客户端按 `track.album` 去重只能覆盖已加载范围,
   * 得到的"专辑"不完整)。
   *
   * 实现建议:多数曲库类后端的专辑是**分面维度**而非独立资源
   * (Songloft 走 `GET /songs/facets?field=album`),因此 `albumTracks()`
   * 的参数是专辑名而不是 ID。
   */
  albums?(options?: ProviderPageOptions): Promise<ProviderPage<ProviderAlbum>>;
  /** 专辑封面;与歌单封面同样受图片加载器不能带 header 的限制。 */
  albumArtwork?(album: ProviderAlbum, size?: number): Promise<string | null>;
  /** 按专辑名取该专辑下的歌曲(专辑是分面维度,没有独立 ID)。 */
  albumTracks?(
    albumName: string,
    options?: ProviderPageOptions,
  ): Promise<ProviderPage<ProviderTrack>>;

  stream(track: ProviderTrack): Promise<ProviderStream>;
  lyrics(track: ProviderTrack): Promise<ProviderLyrics | null>;
  artwork(track: ProviderTrack, size?: number): Promise<string | null>;
}
