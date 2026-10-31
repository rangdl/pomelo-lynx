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
  const response = await withTimeout(
    runtimeFetch()(address, { headers: { Accept: 'application/json' } }),
    REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error('five_sing_network');
  return response.json();
}

function parsePlaylist(value: unknown): PlaylistSong[] {
  if (!isRecord(value) || value.code !== 0 || !Array.isArray(value.data)) {
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
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) {
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
  const value = await requestJSON(
    `${PLAYLIST_ENDPOINT}?id=${encodeURIComponent(TEST_PLAYLIST_ID)}`,
  );
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
