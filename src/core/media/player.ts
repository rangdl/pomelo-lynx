import { useEffect, useState } from '@lynx-js/react';
import { createStore } from 'zustand/vanilla';

import {
  getPlayerState,
  loadPlayer,
  type PlayerState,
  type PlayerStatus,
  pausePlayer,
  playerAvailable,
  playPlayer,
  seekPlayer,
  stopPlayer,
  subscribePlayerState,
} from '../../native/player.js';

export interface MediaPlayerState extends PlayerState {
  available: boolean;
  busy: boolean;
  initialized: boolean;
  queue: string[];
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
  };
}

/** 单例播放器状态:切换 tab 后音频继续,页面只订阅这份 store。 */
export const mediaPlayerStore = createStore<MediaPlayerState>(initial);

let hydration: Promise<void> | null = null;
let lastEndedUrl = '';

function apply(state: PlayerState): void {
  mediaPlayerStore.setState({
    state: state.state,
    url: state.url,
    position: state.position,
    duration: state.duration,
    error: state.error,
  });
  if (state.state !== 'ended') {
    lastEndedUrl = '';
    return;
  }
  if (lastEndedUrl === state.url) return;
  lastEndedUrl = state.url;
  const current = mediaPlayerStore.getState();
  if (
    current.currentIndex >= 0 &&
    current.currentIndex + 1 < current.queue.length
  )
    playQueueAt(current.currentIndex + 1);
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
    })
    .catch(() => {
      // 旧宿主没有播放器时保持 available=false,页面显示提示。
      mediaPlayerStore.setState({ available: false });
    })
    .finally(() => {
      mediaPlayerStore.setState({ initialized: true });
    });
  return hydration;
}

async function startMedia(url: string, index: number): Promise<void> {
  await ensureMediaPlayer();
  if (!mediaPlayerStore.getState().available) return;
  const value = url.trim();
  if (!value) {
    mediaPlayerStore.setState({ error: 'player_empty_url' });
    return;
  }
  mediaPlayerStore.setState({
    busy: true,
    error: '',
    url: value,
    state: 'loading',
    currentIndex: index,
  });
  try {
    await loadPlayer(value, true);
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

export async function loadMedia(url: string): Promise<void> {
  const index = mediaPlayerStore.getState().queue.indexOf(url.trim());
  await startMedia(url, index);
}

export function enqueueMedia(url: string): void {
  const value = url.trim();
  if (!value) {
    mediaPlayerStore.setState({ error: 'player_empty_url' });
    return;
  }
  const current = mediaPlayerStore.getState();
  const existing = current.queue.indexOf(value);
  if (existing >= 0) {
    void playQueueAt(existing);
    return;
  }
  const queue = [...current.queue, value];
  mediaPlayerStore.setState({ queue });
  if (current.currentIndex < 0 || current.state === 'idle')
    void playQueueAt(queue.length - 1);
}

export function playQueueAt(index: number): Promise<void> | void {
  const queue = mediaPlayerStore.getState().queue;
  if (index < 0 || index >= queue.length) return;
  return startMedia(queue[index], index);
}

export function playNextMedia(): void {
  const current = mediaPlayerStore.getState();
  if (current.currentIndex + 1 >= current.queue.length) return;
  void playQueueAt(current.currentIndex + 1);
}

export function playPreviousMedia(): void {
  const current = mediaPlayerStore.getState();
  if (current.currentIndex <= 0) return;
  void playQueueAt(current.currentIndex - 1);
}

export function clearMediaQueue(): void {
  stopPlayer();
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

export type { PlayerStatus };
