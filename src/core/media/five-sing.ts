import { readLynxGlobal } from '../../native/native-modules.js';
import { md5Hex } from './md5.js';
import type { MediaTrack } from './player.js';

/**
 * 5sing 测试数据。
 *
 * 仅用于播放页的队列/锁屏联调,不是正式媒体来源。接口来自
 * MusicFree 的 5sing 插件;播放地址带时间签名,必须在每次加载时重新获取。
 */

const PLAYLIST_ENDPOINT = 'http://service.5sing.kugou.com/song/getPlayListSong';
const MEDIA_ENDPOINT = 'https://5sservice.kugou.com/song/getsongurl';
const TEST_PLAYLIST_ID = '59b6bcf8da767f5ace4bb449';
const TEST_ALBUM = '5sing 古风测试歌单';
const MAX_TRACKS = 8;
const REQUEST_TIMEOUT_MS = 12_000;

const SECRET = '5uytoxQewcvIc1gn1PlNF0T2jbbOzRl5';
const APP_ID = '2918';
const CLIENT_VERSION = '1000';
const CLIENT_VERSION_NAME = '6.6.72';
const MID = '63037fee343fbae9aa4054b2ed6607b5';
const DFID = '08wYMS3ob9Yw3UWPbz08PRQV';
const UUID = '63037fee343fbae9aa4054b2ed6607b5';
const FIVE_SING_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'http://5sing.kugou.com/',
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 ' +
    'Mobile/15E148 Safari/604.1',
};

interface PlaylistSong {
  id: number;
  title: string;
  type: string;
  artist: string;
  artwork: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function runtimeFetch(): FetchLike {
  const lynx = readLynxGlobal();
  if (typeof lynx?.fetch === 'function') {
    return lynx.fetch.bind(lynx) as FetchLike;
  }
  if (typeof fetch === 'function') return fetch;
  throw new Error('five_sing_network');
}

function withTimeout<T>(task: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('five_sing_timeout')),
      milliseconds,
    );
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function requestJSON(address: string): Promise<unknown> {
  let response: Response;
  try {
    response = await withTimeout(
      runtimeFetch()(address, { headers: FIVE_SING_HEADERS }),
      REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'five_sing_timeout')
      throw error;
    throw new Error('five_sing_network');
  }
  if (!response.ok) throw new Error(`five_sing_http_${response.status}`);
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new Error('five_sing_network');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('five_sing_json');
  }
}

function apiFailure(value: Record<string, unknown>, fallback: string): Error {
  const message = typeof value.message === 'string' ? value.message : '';
  return new Error(
    message.includes('频繁') ? 'five_sing_rate_limited' : fallback,
  );
}

function parsePlaylist(value: unknown): PlaylistSong[] {
  if (!isRecord(value) || value.code !== 0) {
    throw new Error('five_sing_playlist_failed');
  }
  if (value.success === false) {
    throw apiFailure(value, 'five_sing_playlist_failed');
  }
  if (!Array.isArray(value.data)) {
    throw new Error('five_sing_playlist_failed');
  }
  const songs: PlaylistSong[] = [];
  for (const item of value.data) {
    if (!isRecord(item)) continue;
    const id = typeof item.ID === 'number' ? item.ID : Number(item.ID);
    const title = typeof item.SN === 'string' ? item.SN.trim() : '';
    const type = typeof item.SK === 'string' ? item.SK.trim() : '';
    if (!Number.isSafeInteger(id) || id <= 0 || !title || !type) continue;
    const user = isRecord(item.user) ? item.user : {};
    songs.push({
      id,
      title,
      type,
      artist: typeof user.NN === 'string' ? user.NN.trim() : '',
      artwork: typeof user.I === 'string' ? user.I.trim() : '',
    });
  }
  return songs;
}

/** 5sing 播放地址签名,算法来自插件脚本。 */
export function fiveSingSignature(
  songId: number,
  songType: string,
  clientTime: number,
): string {
  return md5Hex(
    `${SECRET}appid=${APP_ID}clienttime=${clientTime}clientver=${CLIENT_VERSION}` +
      `dfid=${DFID}mid=${MID}songid=${songId}songtype=${songType}` +
      `uuid=${UUID}version=${CLIENT_VERSION_NAME}${SECRET}`,
  );
}

function playlistAddress(): string {
  return `${PLAYLIST_ENDPOINT}?id=${encodeURIComponent(TEST_PLAYLIST_ID)}`;
}

function mediaAddress(songId: number, songType: string): string {
  const clientTime = Date.now();
  const signature = fiveSingSignature(songId, songType, clientTime);
  return (
    `${MEDIA_ENDPOINT}?appid=${APP_ID}&clientver=${CLIENT_VERSION}` +
    `&mid=${MID}&uuid=${UUID}&dfid=${DFID}` +
    `&songid=${songId}&songtype=${encodeURIComponent(songType)}` +
    `&version=${CLIENT_VERSION_NAME}&clienttime=${clientTime}` +
    `&signature=${signature}`
  );
}

async function fetchMediaAddress(song: PlaylistSong): Promise<string> {
  const value = await requestJSON(mediaAddress(song.id, song.type));
  if (!isRecord(value) || value.code !== 0) {
    throw new Error('five_sing_media_failed');
  }
  if (value.success === false) {
    throw apiFailure(value, 'five_sing_media_failed');
  }
  if (!isRecord(value.data)) {
    throw new Error('five_sing_media_failed');
  }
  const data = value.data;
  const address = [
    data.lqurl,
    data.lqurl_backup,
    data.hqurl,
    data.hqurl_backup,
  ].find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.length > 0,
  );
  if (!address) throw new Error('five_sing_media_failed');
  return address;
}

/** 拉取测试歌单的前几首,并解析出可直接播放的 MP3 地址。 */
export async function fetchFiveSingTracks(
  limit = MAX_TRACKS,
): Promise<MediaTrack[]> {
  const value = await requestJSON(playlistAddress());
  const songs = parsePlaylist(value).slice(
    0,
    Math.min(Math.max(1, limit), MAX_TRACKS),
  );
  if (!songs.length) throw new Error('five_sing_empty');

  const resolved = await Promise.all(
    songs.map(async (song): Promise<MediaTrack | null> => {
      try {
        return {
          url: await fetchMediaAddress(song),
          title: song.title,
          artist: song.artist || undefined,
          album: TEST_ALBUM,
          artwork: song.artwork || undefined,
        };
      } catch {
        return null;
      }
    }),
  );
  const tracks = resolved.filter((track): track is MediaTrack => !!track);
  if (!tracks.length) throw new Error('five_sing_empty');
  return tracks;
}

export interface FiveSingDiagnostic {
  name: string;
  ok: boolean;
  detail: string;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return String(error);
  } catch {
    return 'unknown error';
  }
}

function describeBody(body: string): string {
  return body.slice(0, 140).replace(/\s+/g, ' ');
}

function checkFiveSingPlaylist(value: unknown): string | null {
  if (!isRecord(value)) return '响应不是对象';
  if (value.success === false) {
    return typeof value.message === 'string' && value.message
      ? value.message
      : 'success=false';
  }
  if (!Array.isArray(value.data)) return 'data 不是数组';
  if (value.data.length === 0) return 'data 为空';
  return null;
}

async function inspect(
  name: string,
  address: string,
  headers: Record<string, string>,
  mode: 'text' | 'json',
  check?: (value: unknown) => string | null,
): Promise<FiveSingDiagnostic> {
  try {
    const response = await withTimeout(
      runtimeFetch()(address, { headers }),
      REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      let body = '';
      try {
        body = await response.text();
      } catch {
        /* 保留状态码即可。 */
      }
      return {
        name,
        ok: false,
        detail: `HTTP ${response.status}${body ? ` · ${describeBody(body)}` : ''}`,
      };
    }
    if (mode === 'json') {
      const value: unknown = await response.json();
      const problem = check?.(value) ?? null;
      if (problem)
        return {
          name,
          ok: false,
          detail: `HTTP ${response.status} · ${problem}`,
        };
      return {
        name,
        ok: true,
        detail: `HTTP ${response.status} · response.json() 通过`,
      };
    }
    const body = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return {
        name,
        ok: false,
        detail: `HTTP ${response.status} · 非 JSON · ${describeBody(body)}`,
      };
    }
    const problem = check?.(value) ?? null;
    if (problem)
      return {
        name,
        ok: false,
        detail: `HTTP ${response.status} · ${problem}`,
      };
    return {
      name,
      ok: true,
      detail: `HTTP ${response.status} · text+JSON 通过 · ${describeBody(body)}`,
    };
  } catch (error) {
    return { name, ok: false, detail: describeError(error) };
  }
}

/**
 * 纯 JS 诊断:区分 Lynx fetch 的协议、请求头和解析问题。
 * 不依赖播放器,Web 端也可以运行,但跨域会被浏览器拦截。
 */
export async function runFiveSingDiagnostics(): Promise<FiveSingDiagnostic[]> {
  const minimal = { Accept: 'application/json' };
  const playlist = playlistAddress();
  const playlistHttps = playlist.replace('http://', 'https://');
  const baselines = await Promise.all([
    inspect(
      'HTTPS 基线',
      'https://jsonplaceholder.typicode.com/todos/1',
      minimal,
      'text',
    ),
    inspect(
      'HTTP 基线',
      'http://jsonplaceholder.typicode.com/todos/1',
      minimal,
      'text',
    ),
  ]);

  // 5sing 对短时间多次请求会限流;诊断必须串行并留冷却时间。
  const cases: Array<{
    name: string;
    address: string;
    headers: Record<string, string>;
    mode: 'text' | 'json';
    check?: (value: unknown) => string | null;
  }> = [
    {
      name: '5sing HTTP 完整头',
      address: playlist,
      headers: FIVE_SING_HEADERS,
      mode: 'text',
      check: checkFiveSingPlaylist,
    },
    {
      name: '5sing HTTP 最小头',
      address: playlist,
      headers: minimal,
      mode: 'text',
      check: checkFiveSingPlaylist,
    },
    {
      name: '5sing HTTP response.json',
      address: playlist,
      headers: FIVE_SING_HEADERS,
      mode: 'json',
      check: checkFiveSingPlaylist,
    },
    {
      name: '5sing HTTPS',
      address: playlistHttps,
      headers: minimal,
      mode: 'text',
      check: checkFiveSingPlaylist,
    },
  ];
  const results = [...baselines];
  for (const item of cases) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    results.push(
      await inspect(
        item.name,
        item.address,
        item.headers,
        item.mode,
        item.check,
      ),
    );
  }
  return results;
}
