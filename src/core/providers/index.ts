import {
  type MusicProvider,
  type ProviderAlbum,
  ProviderError,
  type ProviderSession,
  type ProviderTrack,
} from '@pomelo/provider-sdk';

import {
  appendMediaTracks,
  clearMediaQueue,
  clearPersistedMediaQueue,
  type MediaTrack,
  mediaPlayerStore,
  playMediaTrack,
  setMediaTrackHydrator,
} from '../media/player.js';
import {
  activeProviderDescriptor,
  getActiveProvider,
  getProvider,
  loadActiveProviderId,
  PROVIDERS,
  type ProviderDescriptor,
  restoreAnyProvider,
  setActiveProviderId,
} from './registry.js';

/**
 * 宿主侧 Provider 门面。
 *
 * 凭据只通过 secure 存储持久化；UI 和播放器看不到 access/refresh token，
 * 只拿到 ProviderTrack 与解析后的 MediaTrack。
 *
 * 具体用哪个源由 `./registry.ts` 决定(Songloft / Navidrome / Subsonic)。
 * 这里的函数都作用于"当前选中的源",不再写死单个实现。
 */

let restorePromise: Promise<ProviderSession | null> | null = null;

/**
 * 当前音乐源实例。
 *
 * 名字保留 `getSongloftProvider` 是因为调用点很多;语义已经是"当前源",
 * 新代码请用 `getActiveProvider()`。
 */
export function getSongloftProvider(): MusicProvider {
  return getActiveProvider();
}

/** 当前源描述(名称、是否支持 API Key、地址提示)。 */
export function currentProvider(): ProviderDescriptor {
  return activeProviderDescriptor();
}

/** 启动时读一次持久化的选择,之后同步取用。 */
export async function initProviderSelection(): Promise<void> {
  await loadActiveProviderId();
}

export function listProviders(): readonly ProviderDescriptor[] {
  return PROVIDERS;
}

export async function switchProvider(id: string): Promise<void> {
  await setActiveProviderId(id);
}

/**
 * 批量取专辑封面,返回 `专辑 id → 封面 URL`。失败语义同 `trackArtworks`。
 */
export async function albumArtworks(
  albums: readonly ProviderAlbum[],
  size = 256,
): Promise<Record<string, string>> {
  const provider = getSongloftProvider();
  if (typeof provider.albumArtwork !== 'function') return {};
  const entries = await Promise.all(
    albums.map(async (album) => {
      try {
        return [
          album.id,
          (await provider.albumArtwork?.(album, size)) ?? '',
        ] as const;
      } catch {
        return [album.id, ''] as const;
      }
    }),
  );
  return Object.fromEntries(entries.filter(([, value]) => value));
}

/**
 * 服务端是否支持专辑浏览。
 *
 * 两个条件缺一不可:Provider 声明了 `albums` 能力,且确实实现了 `albums()`。
 * 服务端没有该接口时(404)由调用方把 `albumsSupported` 置 false,首页隐藏
 * 专辑架——不猜测、不做客户端聚合。
 */
export function albumsSupported(): boolean {
  const provider = getSongloftProvider();
  return (
    provider.capabilities.albums === true &&
    typeof provider.albums === 'function'
  );
}

/**
 * 连接当前选中的音乐源。
 *
 * `extras` 只放 provider 私有字段(例如 Navidrome 的 `authMode: 'apiKey'`);
 * 通用字段仍是 serverUrl/username/password。
 */
export async function connectProvider(input: {
  serverUrl: string;
  username: string;
  password: string;
  extras?: Record<string, string>;
}): Promise<ProviderSession> {
  const session = await getActiveProvider().login(input);
  restorePromise = null;
  return session;
}

/** 兼容旧调用点:连接到当前选中的源(默认 Songloft)。 */
export async function connectSongloft(input: {
  serverUrl: string;
  username: string;
  password: string;
  extras?: Record<string, string>;
}): Promise<ProviderSession> {
  return connectProvider(input);
}

/** 断开当前源,并停止播放、清空队列(队列曲目已不可用)。 */
export async function disconnectProvider(): Promise<void> {
  await getActiveProvider().logout();
  clearMediaQueue();
  await clearPersistedMediaQueue();
}

/**
 * 批量取曲目封面,返回 `曲目 id → 封面 URL`。
 *
 * 单张失败不能拖垮整页(封面是装饰性的),所以逐条 catch 成空串,
 * 空串在返回前被过滤掉,页面侧按「没有封面」渲染占位。
 */
export async function trackArtworks(
  tracks: readonly ProviderTrack[],
  size = 256,
): Promise<Record<string, string>> {
  const provider = getSongloftProvider();
  const entries = await Promise.all(
    tracks.map(async (track) => {
      try {
        return [track.id, (await provider.artwork(track, size)) ?? ''] as const;
      } catch {
        return [track.id, ''] as const;
      }
    }),
  );
  return Object.fromEntries(entries.filter(([, value]) => value));
}

export async function restoreSongloft(): Promise<ProviderSession | null> {
  if (!restorePromise) {
    restorePromise = restoreAnyProvider().finally(() => {
      restorePromise = null;
    });
  }
  return restorePromise;
}

/**
 * 队列恢复后按需恢复会话；已有 refresh token 时不会重新登录。
 *
 * 队列里的曲目带 `providerId`,优先按它恢复——用户切换过源之后,
 * 旧队列里的歌仍应能播放。
 */
async function ensureProviderReady(
  providerId?: string,
): Promise<MusicProvider> {
  const provider = providerId ? getProvider(providerId) : getActiveProvider();
  if (provider.session) return provider;
  const session = await provider.restore();
  if (!session) {
    throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
  }
  return provider;
}

export async function disconnectSongloft(): Promise<void> {
  await getSongloftProvider().logout();
  // 断开音乐源时停止播放并清空队列，避免持久化定时器把旧队列写回来。
  clearMediaQueue();
  await clearPersistedMediaQueue();
}

export function providerErrorMessage(error: unknown): string {
  if (error instanceof ProviderError) {
    switch (error.code) {
      case 'provider_invalid_url':
        return '服务器地址无效，请输入完整的 http(s) 地址';
      case 'provider_invalid_credentials':
        return error.message || '请输入用户名和密码';
      case 'provider_login_failed':
        return '用户名或密码错误';
      case 'provider_auth_required':
        return '请先连接音乐服务器';
      case 'provider_session_expired':
      case 'provider_forbidden':
        return '登录已过期，请重新连接';
      case 'provider_timeout':
        return '请求超时，请检查服务器地址和网络';
      case 'provider_network':
        return '网络请求失败，请检查服务器地址和网络';
      case 'provider_not_found':
        return '服务器上找不到该资源';
      case 'provider_invalid_response':
        return error.message || '服务器返回数据格式异常';
      default:
        return error.message || '操作失败';
    }
  }
  return error instanceof Error && error.message ? error.message : '操作失败';
}

/** 把 ProviderTrack 解析成播放器需要的 URL/请求头/封面。 */
export async function providerTrackToMedia(
  provider: MusicProvider,
  track: ProviderTrack,
): Promise<MediaTrack> {
  const stream = await provider.stream(track);
  let artwork: string | undefined;
  try {
    artwork = (await provider.artwork(track, 512)) ?? undefined;
  } catch {
    artwork = undefined;
  }
  return {
    url: stream.url,
    headers: stream.headers,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork,
    providerId: provider.id,
    providerTrackId: track.id,
    resolve: async () => {
      // 原生只会在 401/403 时调用这里，必须强制换 token 再取流/封面。
      await provider.refresh?.();
      const next = await provider.stream(track);
      let artwork: string | undefined;
      try {
        artwork = (await provider.artwork(track, 512)) ?? undefined;
      } catch {
        artwork = undefined;
      }
      return { url: next.url, headers: next.headers, artwork };
    },
    lyrics: async () => {
      const result = await provider.lyrics(track);
      return result?.lrc ?? null;
    },
  };
}

export async function providerTracksToMedia(
  provider: MusicProvider,
  tracks: readonly ProviderTrack[],
): Promise<MediaTrack[]> {
  const resolved = await Promise.all(
    tracks.map(async (track) => {
      try {
        return await providerTrackToMedia(provider, track);
      } catch {
        return null;
      }
    }),
  );
  return resolved.filter((track): track is MediaTrack => track !== null);
}

/** 单曲点击：解析流地址并开播；歌词由原生 track 事件按曲目加载。 */
export async function playProviderTrack(
  provider: MusicProvider,
  track: ProviderTrack,
): Promise<void> {
  const media = await providerTrackToMedia(provider, track);
  await playMediaTrack(media);
}

/**
 * 歌单「播放全部」：第一首直接开播，其余追加到队尾。
 * 只为首曲拉歌词，避免一次打开歌单就发上百个歌词请求。
 */
export async function playProviderTracks(
  provider: MusicProvider,
  tracks: readonly ProviderTrack[],
): Promise<number> {
  if (!tracks.length) return 0;
  const media = await providerTracksToMedia(provider, tracks);
  if (!media.length) {
    throw new ProviderError('provider_invalid_response', '没有可播放的歌曲');
  }
  await playMediaTrack(media[0]);
  if (media.length > 1) appendMediaTracks(media.slice(1));
  return media.length;
}

/** 把选中的歌曲加入队列，不打断当前播放（空闲时由播放器自动开播）。 */
export async function enqueueProviderTracks(
  provider: MusicProvider,
  tracks: readonly ProviderTrack[],
): Promise<number> {
  const media = await providerTracksToMedia(provider, tracks);
  if (!media.length) {
    throw new ProviderError('provider_invalid_response', '没有可播放的歌曲');
  }
  appendMediaTracks(media);
  return media.length;
}

/**
 * 队列从 prefs 恢复后，用 providerId/trackId 重新挂载闭包。
 * 这里只建闭包，不立即发网络请求；真正播放/刷新时才取流。
 */
export function rehydrateProviderTrack(track: MediaTrack): MediaTrack {
  if (!track.providerId || !track.providerTrackId) return track;
  // 只处理已注册的源;未知 providerId(例如降级版本写入的)原样返回。
  if (!PROVIDERS.some((entry) => entry.id === track.providerId)) return track;
  const providerId = track.providerId;
  const trackId = track.providerTrackId;
  return {
    ...track,
    resolve: async () => {
      const provider = await ensureProviderReady(providerId);
      const source = await provider.getTrack?.(trackId);
      if (!source) {
        throw new ProviderError('provider_not_found', '曲目不存在');
      }
      await provider.refresh?.();
      const next = await provider.stream(source);
      let artwork: string | undefined;
      try {
        artwork = (await provider.artwork(source, 512)) ?? undefined;
      } catch {
        artwork = undefined;
      }
      return { url: next.url, headers: next.headers, artwork };
    },
    lyrics: async () => {
      const provider = await ensureProviderReady(providerId);
      const source = await provider.getTrack?.(trackId);
      if (!source) return null;
      const value = await provider.lyrics(source);
      return value?.lrc ?? null;
    },
  };
}

setMediaTrackHydrator(rehydrateProviderTrack);

export function providerQueueSize(): number {
  return mediaPlayerStore.getState().queue.length;
}
