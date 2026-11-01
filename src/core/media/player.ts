import { useEffect, useState } from '@lynx-js/react';
import { createStore } from 'zustand/vanilla';
import {
  clearPlayerLyrics,
  clearPlayerNowPlayingOverride,
  getPlayerCapabilities,
  getPlayerState,
  loadPlayer,
  type NowPlayingOverride,
  nextPlayer,
  type PlayerEvent,
  type PlayerLyricMode,
  type PlayerState,
  type PlayerStatus,
  pausePlayer,
  playerAvailable,
  playPlayer,
  previousPlayer,
  resolvePlayerRefresh,
  seekPlayer,
  setPlayerEngine,
  setPlayerLyrics,
  setPlayerNowPlayingOverride,
  setPlayerQueue,
  setPlayerRate,
  setPlayerVolume,
  stopPlayer,
  subscribePlayerEvents,
  subscribePlayerState,
} from '../../native/player.js';
import { parseLrc } from './lyrics.js';

export interface MediaTrackStream {
  url: string;
  headers?: Record<string, string>;
}

export interface MediaTrack {
  url: string;
  title: string;
  artist?: string;
  album?: string;
  artwork?: string;
  headers?: Record<string, string>;
  /**
   * 播放链接过期时重新解析。Provider 曲目会带上该闭包；
   * 原生通过 `refresh_required` 事件触发它。
   */
  resolve?: () => Promise<MediaTrackStream>;
}

export interface MediaPlayerState extends PlayerState {
  available: boolean;
  busy: boolean;
  initialized: boolean;
  queue: MediaTrack[];
  currentIndex: number;
}

function initial(): MediaPlayerState {
  return {
    state: 'idle',
    url: '',
    position: 0,
    duration: 0,
    error: '',
    available: playerAvailable(),
    busy: false,
    initialized: false,
    queue: [],
    currentIndex: -1,
    queueIndex: -1,
    lyric: '',
    rate: 1,
    volume: 1,
    engine: 'system',
    refreshing: false,
  };
}

/** 单例播放器状态:切换 tab 后音频继续,页面只订阅这份 store。 */
export const mediaPlayerStore = createStore<MediaPlayerState>(initial);

let hydration: Promise<void> | null = null;

function apply(state: PlayerState): void {
  mediaPlayerStore.setState({
    state: state.state,
    url: state.url,
    position: state.position,
    duration: state.duration,
    error: state.error,
    currentIndex: state.queueIndex,
    lyric: state.lyric,
    rate: state.rate,
    volume: state.volume,
    engine: state.engine,
    refreshing: state.refreshing,
  });
}

/** 首次进入播放页时读取原生状态并挂上事件订阅。 */
export function ensureMediaPlayer(): Promise<void> {
  if (hydration) return hydration;
  const available = playerAvailable();
  mediaPlayerStore.setState({ available });
  if (!available) {
    mediaPlayerStore.setState({ initialized: true });
    hydration = Promise.resolve();
    return hydration;
  }
  hydration = getPlayerState()
    .then((state) => {
      apply(state);
      subscribePlayerState(apply);
      subscribePlayerEvents(handlePlayerEvent);
    })
    .catch(() => {
      // 模块调用失败时标记不可用,页面显示提示。
      mediaPlayerStore.setState({ available: false });
    })
    .finally(() => {
      mediaPlayerStore.setState({ initialized: true });
    });
  return hydration;
}

/** 比较播放地址时忽略 access_token，但保留其它查询参数。 */
function comparableMediaURL(raw: string): string {
  const [withoutHash] = raw.split('#');
  const [path, query = ''] = withoutHash.split('?');
  const rest = query
    .split('&')
    .filter((part) => part && !part.startsWith('access_token='));
  return rest.length ? `${path}?${rest.join('&')}` : path;
}

function refreshTrackIndex(
  queue: readonly MediaTrack[],
  event: PlayerEvent,
): number {
  if (event.queueIndex >= 0 && event.queueIndex < queue.length) {
    const candidate = queue[event.queueIndex];
    if (
      !event.url ||
      comparableMediaURL(candidate.url) === comparableMediaURL(event.url)
    ) {
      return event.queueIndex;
    }
  }
  if (!event.url) return -1;
  const target = comparableMediaURL(event.url);
  return queue.findIndex((track) => comparableMediaURL(track.url) === target);
}

/**
 * 原生发现 401/403 后会发 refresh_required；这里调用 Provider 重新取流，
 * 同时更新 JS 队列和原生队列项，再把新 URL/headers 回传给原生重载。
 */
async function refreshTrackForNative(event: PlayerEvent): Promise<void> {
  const current = mediaPlayerStore.getState();
  const index = refreshTrackIndex(current.queue, event);
  const track = index >= 0 ? current.queue[index] : undefined;
  if (!track?.resolve) {
    mediaPlayerStore.setState({ refreshing: false });
    resolvePlayerRefresh(event.requestId, null, 'player_refresh_unavailable');
    return;
  }
  try {
    const next = await track.resolve();
    if (!next?.url || !/^https?:\/\//i.test(next.url)) {
      throw new Error('player_refresh_invalid');
    }
    const latest = mediaPlayerStore.getState();
    let target = index;
    if (latest.queue[target]?.url !== track.url) {
      target = latest.queue.findIndex((item) => item.url === track.url);
    }
    if (target < 0) throw new Error('player_refresh_stale');
    const queue = latest.queue.slice();
    queue[target] = {
      ...queue[target],
      url: next.url,
      headers: next.headers,
    };
    mediaPlayerStore.setState({ queue });
    // 原生 resolveRefresh 会更新它自己的队列项；这里不要再发 setQueue，
    // 否则可能用 JS 里稍旧的 currentIndex 覆盖原生刚切换到的曲目。
    resolvePlayerRefresh(event.requestId, next);
  } catch {
    mediaPlayerStore.setState({ refreshing: false });
    resolvePlayerRefresh(event.requestId, null, 'player_refresh_failed');
  }
}

function handlePlayerEvent(event: PlayerEvent): void {
  if (event.type === 'refresh_required') {
    if (!event.requestId) return;
    mediaPlayerStore.setState({ refreshing: true, error: '' });
    void refreshTrackForNative(event);
    return;
  }
  if (event.type === 'refresh_applied') {
    mediaPlayerStore.setState({ refreshing: false });
    return;
  }
  if (event.type === 'refresh_failed') {
    mediaPlayerStore.setState({
      refreshing: false,
      state: 'error',
      error: event.error || 'player_refresh_failed',
    });
    return;
  }
  if (event.type === 'error' && event.error) {
    mediaPlayerStore.setState({ error: event.error });
  }
}

async function startMedia(
  url: string,
  index: number,
  autoplay = true,
): Promise<void> {
  await ensureMediaPlayer();
  if (!mediaPlayerStore.getState().available) return;
  const value = url.trim();
  if (!value) {
    mediaPlayerStore.setState({ error: 'player_empty_url' });
    return;
  }
  const queue = mediaPlayerStore.getState().queue;
  setPlayerQueue(queue, index);
  mediaPlayerStore.setState({
    busy: true,
    error: '',
    url: value,
    state: 'loading',
    currentIndex: index,
    refreshing: false,
  });
  try {
    await loadPlayer(value, autoplay);
  } catch (error) {
    mediaPlayerStore.setState({
      busy: false,
      state: 'error',
      error: (error as Error).message,
    });
    return;
  }
  mediaPlayerStore.setState({ busy: false });
}

/** 队列项没有标题时用 URL 文件名兜底,锁屏和播放页共用同一份。 */
export function trackTitleFromURL(raw: string): string {
  const clean = raw.split('?')[0]?.split('#')[0] ?? '';
  const segment = clean.split('/').filter(Boolean).pop() ?? '';
  if (!segment) return raw;
  try {
    return decodeURIComponent(segment) || raw;
  } catch {
    return segment;
  }
}

export async function loadMedia(url: string): Promise<void> {
  const value = url.trim();
  const index = mediaPlayerStore
    .getState()
    .queue.findIndex((track) => track.url === value);
  await startMedia(value, index);
}

/**
 * 直接播放一条带元数据的曲目：不存在则追加到队尾，存在则切到已有项。
 * Provider 单曲点击走这里，避免先 enqueue 再 play 导致重复加载。
 */
export async function playMediaTrack(track: MediaTrack): Promise<void> {
  const value = track.url.trim();
  if (!value) {
    mediaPlayerStore.setState({ error: 'player_empty_url' });
    return;
  }
  const existing = mediaPlayerStore
    .getState()
    .queue.findIndex((item) => item.url === value);
  if (existing >= 0) {
    await startMedia(value, existing);
    return;
  }
  const queue = [
    ...mediaPlayerStore.getState().queue,
    buildTrack(value, {
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artwork,
      headers: track.headers,
      resolve: track.resolve,
    }),
  ];
  mediaPlayerStore.setState({ queue });
  await startMedia(value, queue.length - 1);
}

export type QueueInsertPosition = 'end' | 'next';

function buildTrack(
  url: string,
  meta?: Partial<Omit<MediaTrack, 'url'>>,
): MediaTrack {
  return {
    url,
    title: meta?.title?.trim() || trackTitleFromURL(url),
    artist: meta?.artist?.trim() || undefined,
    album: meta?.album?.trim() || undefined,
    artwork: meta?.artwork?.trim() || undefined,
    headers: meta?.headers,
    resolve: meta?.resolve,
  };
}

/**
 * 把曲目加入队列。`end` 追加到末尾,`next` 插到当前曲目之后。
 * 队列为空或没有当前曲目时,两种位置都会立即播放新曲目。
 */
export function enqueueMedia(
  url: string,
  meta?: Partial<Omit<MediaTrack, 'url'>>,
  position: QueueInsertPosition = 'end',
): void {
  const value = url.trim();
  if (!value) {
    mediaPlayerStore.setState({ error: 'player_empty_url' });
    return;
  }
  const current = mediaPlayerStore.getState();
  const existing = current.queue.findIndex((track) => track.url === value);

  if (existing >= 0) {
    if (position !== 'next') return;
    if (current.currentIndex < 0) {
      void playQueueAt(existing);
      return;
    }
    if (existing === current.currentIndex) return;
    const queue = [...current.queue];
    const [track] = queue.splice(existing, 1);
    const currentIndex =
      existing < current.currentIndex
        ? current.currentIndex - 1
        : current.currentIndex;
    queue.splice(Math.min(currentIndex + 1, queue.length), 0, track);
    mediaPlayerStore.setState({ queue, currentIndex });
    setPlayerQueue(queue, currentIndex);
    return;
  }

  const track = buildTrack(value, meta);

  if (position === 'next' && current.currentIndex >= 0) {
    const queue = [...current.queue];
    queue.splice(current.currentIndex + 1, 0, track);
    mediaPlayerStore.setState({ queue });
    setPlayerQueue(queue, current.currentIndex);
    return;
  }

  const queue = [...current.queue, track];
  mediaPlayerStore.setState({ queue });
  setPlayerQueue(queue, current.currentIndex);
  if (current.currentIndex < 0 || current.state === 'idle')
    void playQueueAt(queue.length - 1);
}

/** 批量追加曲目,只同步一次原生队列;空闲时只播放第一首新曲目。 */
export function appendMediaTracks(tracks: readonly MediaTrack[]): void {
  if (!tracks.length) return;
  const current = mediaPlayerStore.getState();
  const queue = [...current.queue];
  const added: MediaTrack[] = [];
  for (const track of tracks) {
    if (queue.some((item) => item.url === track.url)) continue;
    queue.push(track);
    added.push(track);
  }
  if (!added.length) return;
  const firstIndex = queue.length - added.length;
  mediaPlayerStore.setState({ queue });
  setPlayerQueue(queue, current.currentIndex);
  if (current.currentIndex < 0 || current.state === 'idle')
    void playQueueAt(firstIndex);
}

/**
 * 从队列移除一项。移除当前曲目时,有下一首就按原播放状态切过去,
 * 否则停止播放并把当前索引置空。
 */
export function removeMediaAt(index: number): void {
  const current = mediaPlayerStore.getState();
  if (index < 0 || index >= current.queue.length) return;
  const queue = current.queue.filter((_, itemIndex) => itemIndex !== index);

  if (index !== current.currentIndex) {
    const currentIndex =
      index < current.currentIndex
        ? current.currentIndex - 1
        : current.currentIndex;
    mediaPlayerStore.setState({ queue, currentIndex });
    setPlayerQueue(queue, currentIndex);
    return;
  }

  if (queue.length === 0) {
    stopPlayer();
    setPlayerQueue([], -1);
    mediaPlayerStore.setState({
      queue: [],
      currentIndex: -1,
      state: 'idle',
      url: '',
      position: 0,
      duration: 0,
      error: '',
    });
    return;
  }

  const shouldPlay = current.state === 'playing' || current.state === 'loading';
  const nextIndex = index < queue.length ? index : -1;
  if (nextIndex >= 0) {
    mediaPlayerStore.setState({ queue, currentIndex: nextIndex });
    void startMedia(queue[nextIndex].url, nextIndex, shouldPlay);
    return;
  }

  stopPlayer();
  setPlayerQueue(queue, -1);
  mediaPlayerStore.setState({
    queue,
    currentIndex: -1,
    state: 'idle',
    url: '',
    position: 0,
    duration: 0,
    error: '',
  });
}

export function playQueueAt(index: number): Promise<void> | void {
  const queue = mediaPlayerStore.getState().queue;
  if (index < 0 || index >= queue.length) return;
  setPlayerQueue(queue, index);
  return startMedia(queue[index].url, index);
}

export function playNextMedia(): void {
  const current = mediaPlayerStore.getState();
  if (current.currentIndex + 1 >= current.queue.length) return;
  nextPlayer();
}

export function playPreviousMedia(): void {
  const current = mediaPlayerStore.getState();
  if (current.currentIndex <= 0) return;
  previousPlayer();
}

export function clearMediaQueue(): void {
  stopPlayer();
  setPlayerQueue([], -1);
  mediaPlayerStore.setState({
    queue: [],
    currentIndex: -1,
    state: 'idle',
    url: '',
    position: 0,
    duration: 0,
    error: '',
  });
}

export function toggleMedia(): void {
  const current = mediaPlayerStore.getState();
  if (!current.available || current.busy) return;
  if (!current.url) {
    mediaPlayerStore.setState({ error: 'player_no_source' });
    return;
  }
  if (current.state === 'playing') {
    pausePlayer();
    mediaPlayerStore.setState({ state: 'paused' });
    return;
  }
  if (current.state === 'ended') {
    seekPlayer(0);
    mediaPlayerStore.setState({ position: 0 });
  }
  playPlayer();
  mediaPlayerStore.setState({ state: 'playing', error: '' });
}

export function seekMedia(seconds: number): void {
  const current = mediaPlayerStore.getState();
  if (!current.available || current.duration <= 0) return;
  const value = Math.min(Math.max(0, seconds), current.duration);
  seekPlayer(value);
  mediaPlayerStore.setState({ position: value });
}

export function stopMedia(): void {
  if (!mediaPlayerStore.getState().available) return;
  stopPlayer();
  mediaPlayerStore.setState({
    state: 'idle',
    url: '',
    position: 0,
    duration: 0,
    error: '',
    currentIndex: -1,
  });
}

export function useMediaPlayer(): MediaPlayerState {
  const [state, setState] = useState(mediaPlayerStore.getState());
  useEffect(() => {
    let alive = true;
    void ensureMediaPlayer();
    const unsubscribe = mediaPlayerStore.subscribe((next) => {
      if (alive) setState(next);
    });
    setState(mediaPlayerStore.getState());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return state;
}

export type { PlayerEvent, PlayerEventType } from '../../native/player.js';
export type { PlayerStatus };

/** 语义播放事件订阅入口;状态快照仍由 `useMediaPlayer` 提供。 */
export function subscribeMediaPlayerEvents(
  listener: (event: PlayerEvent) => void,
): () => void {
  return subscribePlayerEvents(listener);
}

/** 把 LRC 解析成原生时序行;原生在后台/锁屏继续更新 Now Playing。 */
export function setMediaLyrics(
  lrc: string,
  mode: PlayerLyricMode = 'title',
): void {
  setPlayerLyrics(parseLrc(lrc), mode);
}

export function clearMediaLyrics(): void {
  clearPlayerLyrics();
}

export function setMediaNowPlayingOverride(input: NowPlayingOverride): void {
  setPlayerNowPlayingOverride(input);
}

export function clearMediaNowPlayingOverride(): void {
  clearPlayerNowPlayingOverride();
}

export function setMediaRate(rate: number): void {
  setPlayerRate(rate);
}

export function setMediaVolume(volume: number): void {
  setPlayerVolume(volume);
}

export function getMediaCapabilities() {
  return getPlayerCapabilities();
}

export function setMediaEngine(engine: string): Promise<void> {
  return setPlayerEngine(engine);
}
