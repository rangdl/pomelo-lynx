import {
  ProviderError,
  type ProviderPage,
  type ProviderPlaylist,
  type ProviderSession,
  type ProviderTrack,
} from '@pomelo/provider-sdk';

export interface SongloftSong {
  id: number;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverUrl?: string;
  lyricUrl?: string;
  streamUrl?: string;
  isVideo: boolean;
  isLive: boolean;
  type?: string;
  format?: string;
}

export interface SongloftPlaylist {
  id: number;
  name: string;
  description?: string;
  coverUrl?: string;
  trackCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value: unknown): boolean {
  return value === true;
}

export function parseSong(value: unknown): SongloftSong | null {
  if (!isRecord(value)) return null;
  const id = number(value.id);
  if (id === undefined || !Number.isSafeInteger(id) || id <= 0) return null;
  const title = text(value.title) ?? `歌曲 ${id}`;
  return {
    id,
    title,
    artist: text(value.artist),
    album: text(value.album),
    duration: number(value.duration),
    coverUrl: text(value.cover_url),
    lyricUrl: text(value.lyric_url),
    streamUrl: text(value.url),
    isVideo: bool(value.is_video),
    isLive: bool(value.is_live),
    type: text(value.type),
    format: text(value.format),
  };
}

export function toProviderTrack(song: SongloftSong): ProviderTrack {
  const fallback = `/api/v1/songs/${song.id}`;
  return {
    id: String(song.id),
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    isVideo: song.isVideo,
    isLive: song.isLive,
    resource: {
      stream: song.streamUrl ?? `${fallback}/play`,
      artwork: song.coverUrl ?? `${fallback}/cover`,
      lyrics: song.lyricUrl ?? `${fallback}/lyric`,
    },
  };
}

export function parseSongPage(
  value: unknown,
  limit: number,
  offset: number,
): ProviderPage<ProviderTrack> {
  if (!isRecord(value) || !Array.isArray(value.songs)) {
    throw new ProviderError('provider_invalid_response', '歌曲列表格式异常');
  }
  const items: ProviderTrack[] = [];
  for (const item of value.songs) {
    const song = parseSong(item);
    if (song) items.push(toProviderTrack(song));
  }
  return {
    items,
    total: number(value.total) ?? items.length,
    limit,
    offset,
  };
}

export function parsePlaylistPage(
  value: unknown,
  limit: number,
  offset: number,
): ProviderPage<ProviderPlaylist> {
  if (!isRecord(value) || !Array.isArray(value.playlists)) {
    throw new ProviderError('provider_invalid_response', '歌单列表格式异常');
  }
  const items: ProviderPlaylist[] = [];
  for (const raw of value.playlists) {
    if (!isRecord(raw)) continue;
    const id = number(raw.id);
    if (id === undefined || !Number.isSafeInteger(id) || id <= 0) continue;
    items.push({
      id: String(id),
      name: text(raw.name) ?? `歌单 ${id}`,
      description: text(raw.description),
      trackCount: number(raw.song_count) ?? 0,
      artwork: text(raw.cover_url),
    });
  }
  return {
    items,
    total: number(value.total) ?? items.length,
    limit,
    offset,
  };
}

export interface SongloftTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function parseTokens(value: unknown): SongloftTokens {
  if (!isRecord(value)) {
    throw new ProviderError('provider_invalid_response', '登录响应格式异常');
  }
  const accessToken = text(value.access_token);
  const refreshToken = text(value.refresh_token);
  if (!accessToken || !refreshToken) {
    throw new ProviderError('provider_invalid_response', '登录响应缺少 token');
  }
  return {
    accessToken,
    refreshToken,
    expiresIn: number(value.expires_in) ?? 0,
  };
}

export function parseStoredSession(
  value: unknown,
  providerId: string,
): ProviderSession | null {
  if (!isRecord(value)) return null;
  if (value.providerId !== providerId) return null;
  const serverUrl = text(value.serverUrl);
  const username = text(value.username);
  if (!serverUrl || !username) return null;
  return {
    providerId,
    serverUrl,
    username,
    accessToken: text(value.accessToken),
    refreshToken: text(value.refreshToken),
    expiresAt: number(value.expiresAt) ?? 0,
  };
}

export interface SongloftLyricPayload {
  lyric?: string;
  tlyric?: string;
  rlyric?: string;
  lxlyric?: string;
}

export function parseLyricPayload(value: unknown): SongloftLyricPayload {
  if (!isRecord(value)) {
    throw new ProviderError('provider_invalid_response', '歌词响应格式异常');
  }
  return {
    lyric: text(value.lyric),
    tlyric: text(value.tlyric),
    rlyric: text(value.rlyric),
    lxlyric: text(value.lxlyric),
  };
}
