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

export async function loadMedia(url: string): Promise<void> {
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
