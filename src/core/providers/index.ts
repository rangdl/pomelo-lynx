import {
  type MusicProvider,
  ProviderError,
  type ProviderFetch,
  type ProviderSession,
  type ProviderTrack,
} from '@pomelo/provider-sdk';
import { SongloftProvider } from '@pomelo/provider-songloft';

import { readLynxGlobal } from '../../native/native-modules.js';
import {
  appendMediaTracks,
  clearMediaQueue,
  clearPersistedMediaQueue,
  type MediaTrack,
  mediaPlayerStore,
  playMediaTrack,
  setMediaTrackHydrator,
} from '../media/player.js';
import { getPomeloStorage } from '../storage/index.js';

/**
 * 宿主侧 Provider 门面。
 *
 * 凭据只通过 secure 存储持久化；UI 和播放器看不到 access/refresh token，
 * 只拿到 ProviderTrack 与解析后的 MediaTrack。
 */

let songloft: SongloftProvider | null = null;
let restorePromise: Promise<ProviderSession | null> | null = null;

function runtimeFetch(): ProviderFetch {
  const lynx = readLynxGlobal();
  if (typeof lynx?.fetch === 'function') {
    return lynx.fetch.bind(lynx) as ProviderFetch;
  }
  if (typeof fetch === 'function') return fetch;
  return () =>
    Promise.reject(
      new ProviderError('provider_network', '当前环境不支持网络请求'),
    );
}

export function getSongloftProvider(): SongloftProvider {
  if (!songloft) {
    const storage = getPomeloStorage();
    songloft = new SongloftProvider({
      fetch: runtimeFetch(),
      secure: {
        get: (key) => storage.secure.get(key),
        set: (key, value) => storage.secure.set(key, value),
        remove: (key) => storage.secure.remove(key),
      },
    });
  }
  return songloft;
}

export async function connectSongloft(input: {
  serverUrl: string;
  username: string;
  password: string;
}): Promise<ProviderSession> {
  return getSongloftProvider().login(input);
}

export async function restoreSongloft(): Promise<ProviderSession | null> {
  if (!restorePromise) {
    restorePromise = getSongloftProvider()
      .restore()
      .finally(() => {
        restorePromise = null;
      });
  }
  return restorePromise;
}

/** 队列恢复后按需恢复会话；已有 refresh token 时不会重新登录。 */
async function ensureSongloftReady(): Promise<SongloftProvider> {
  const provider = getSongloftProvider();
  if (provider.session) return provider;
  const session = await restoreSongloft();
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
  if (track.providerId !== 'songloft') return track;
  const trackId = track.providerTrackId;
  return {
    ...track,
    resolve: async () => {
      const provider = await ensureSongloftReady();
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
      const provider = await ensureSongloftReady();
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
