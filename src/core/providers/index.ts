import {
  type MusicProvider,
  ProviderError,
  type ProviderFetch,
  type ProviderLyrics,
  type ProviderSession,
  type ProviderTrack,
} from '@pomelo/provider-sdk';
import { SongloftProvider } from '@pomelo/provider-songloft';

import { readLynxGlobal } from '../../native/native-modules.js';
import {
  appendMediaTracks,
  clearMediaLyrics,
  type MediaTrack,
  mediaPlayerStore,
  playMediaTrack,
  setMediaLyrics,
} from '../media/player.js';
import { getPomeloStorage } from '../storage/index.js';

/**
 * 宿主侧 Provider 门面。
 *
 * 凭据只通过 secure 存储持久化；UI 和播放器看不到 access/refresh token，
 * 只拿到 ProviderTrack 与解析后的 MediaTrack。
 */

let songloft: SongloftProvider | null = null;

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
  return getSongloftProvider().restore();
}

export async function disconnectSongloft(): Promise<void> {
  await getSongloftProvider().logout();
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
    resolve: async () => {
      // 原生只会在 401/403 时调用这里，必须强制换 token 再取流。
      await provider.refresh?.();
      const next = await provider.stream(track);
      return { url: next.url, headers: next.headers };
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

async function lyricsOf(
  provider: MusicProvider,
  track: ProviderTrack,
): Promise<ProviderLyrics | null> {
  try {
    return await provider.lyrics(track);
  } catch {
    return null;
  }
}

/** 歌词请求可能晚于切歌；只有当前曲目仍是它时才写入。 */
function applyLyricsFor(url: string, lyrics: ProviderLyrics | null): void {
  if (mediaPlayerStore.getState().url !== url) return;
  if (lyrics?.lrc) setMediaLyrics(lyrics.lrc);
  else clearMediaLyrics();
}

/**
 * 单曲点击：先解析流地址，再开始播放，最后异步补歌词。
 * 歌词失败不影响播放。
 */
export async function playProviderTrack(
  provider: MusicProvider,
  track: ProviderTrack,
): Promise<void> {
  const media = await providerTrackToMedia(provider, track);
  await playMediaTrack(media);
  const lyrics = await lyricsOf(provider, track);
  applyLyricsFor(media.url, lyrics);
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
  const lyrics = await lyricsOf(provider, tracks[0]);
  applyLyricsFor(media[0].url, lyrics);
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

export function providerQueueSize(): number {
  return mediaPlayerStore.getState().queue.length;
}
