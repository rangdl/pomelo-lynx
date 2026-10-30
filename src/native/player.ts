import { readLynxGlobal, readNativeModules } from './native-modules.js';

export const PLAYER_STATE_EVENT = 'PomeloPlayer.state';
export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface PlayerState {
  state: PlayerStatus;
  url: string;
  position: number;
  duration: number;
  error: string;
  queueIndex: number;
}

export interface PlayerQueueItem {
  url: string;
  /** 可为空;原生会回退到 URL 文件名。 */
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
}

interface PlayerModule {
  load(request: string, callback: (json: string) => void): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  stop(): void;
  getState(callback: (json: string) => void): void;
  setQueue(request: string): void;
  next(): void;
  previous(): void;
}

const REQUIRED = [
  'load',
  'play',
  'pause',
  'seek',
  'stop',
  'getState',
  'setQueue',
  'next',
  'previous',
] as const;
const CALLBACK_TIMEOUT_MS = 5000;

function module(): PlayerModule | null {
  const value = readNativeModules()?.PomeloPlayer as
    | Record<string, unknown>
    | undefined;
  return value && REQUIRED.every((name) => typeof value[name] === 'function')
    ? (value as unknown as PlayerModule)
    : null;
}

export function playerAvailable(): boolean {
  return module() !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function status(value: unknown): PlayerStatus {
  return value === 'loading' ||
    value === 'playing' ||
    value === 'paused' ||
    value === 'ended' ||
    value === 'error'
    ? value
    : 'idle';
}

/** `sendGlobalEvent` 可能传字符串、数组或对象;统一解析成播放器状态。 */
export function parsePlayerState(raw: unknown): PlayerState | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) value = value[0];
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  const queueIndex =
    typeof value.queueIndex === 'number' &&
    Number.isSafeInteger(value.queueIndex)
      ? value.queueIndex
      : -1;
  return {
    state: status(value.state),
    url: typeof value.url === 'string' ? value.url : '',
    position: finite(value.position),
    duration: finite(value.duration),
    error: typeof value.error === 'string' ? value.error : '',
    queueIndex,
  };
}

function parseCallback(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) throw new Error('invalid_player_response');
    if (typeof value.error === 'string' && value.error)
      throw new Error(value.error);
    return value;
  } catch (error) {
    throw error instanceof Error ? error : new Error('invalid_player_response');
  }
}

function callbackPromise(
  run: (callback: (json: string) => void) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('player_timeout'));
    }, CALLBACK_TIMEOUT_MS);
    const finish = (error: Error | null, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value ?? {});
    };
    try {
      run((json) => {
        if (settled) return;
        try {
          finish(null, parseCallback(json));
        } catch (error) {
          finish(error instanceof Error ? error : new Error('player_failed'));
        }
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error('player_failed'));
    }
  });
}

export async function loadPlayer(url: string, autoplay = true): Promise<void> {
  const value = module();
  if (!value) throw new Error('player_unavailable');
  const request = JSON.stringify({ url, autoplay });
  await callbackPromise((callback) => value.load(request, callback));
}

export function playPlayer(): void {
  module()?.play();
}

export function pausePlayer(): void {
  module()?.pause();
}

export function seekPlayer(seconds: number): void {
  if (Number.isFinite(seconds)) module()?.seek(seconds);
}

export function stopPlayer(): void {
  module()?.stop();
}

export function setPlayerQueue(
  items: readonly PlayerQueueItem[],
  index: number,
): void {
  const value = module();
  if (!value) return;
  const request = JSON.stringify({
    items: items.slice(0, 50).map((item) => ({
      url: item.url,
      title: item.title ?? '',
      artist: item.artist ?? '',
      album: item.album ?? '',
      artwork: item.artwork ?? '',
    })),
    index: Number.isSafeInteger(index) ? index : -1,
  });
  value.setQueue(request);
}

export function nextPlayer(): void {
  module()?.next();
}

export function previousPlayer(): void {
  module()?.previous();
}

export async function getPlayerState(): Promise<PlayerState> {
  const value = module();
  if (!value) throw new Error('player_unavailable');
  const result = await callbackPromise((callback) => value.getState(callback));
  const parsed = parsePlayerState(result);
  if (!parsed) throw new Error('invalid_player_state');
  return parsed;
}

/** 订阅宿主播放器状态;事件可能在监听前发出,调用方应先 getPlayerState。 */
export function subscribePlayerState(
  listener: (value: PlayerState) => void,
): () => void {
  'background only';
  try {
    const emitter = readLynxGlobal()?.getJSModule?.('GlobalEventEmitter');
    if (
      typeof emitter?.addListener !== 'function' ||
      typeof emitter?.removeListener !== 'function'
    )
      return () => {};
    let active = true;
    const handler = (raw: unknown) => {
      if (!active) return;
      const parsed = parsePlayerState(raw);
      if (parsed) listener(parsed);
    };
    emitter.addListener(PLAYER_STATE_EVENT, handler);
    return () => {
      if (!active) return;
      active = false;
      try {
        emitter.removeListener?.(PLAYER_STATE_EVENT, handler);
      } catch {
        // Host already unloaded.
      }
    };
  } catch {
    return () => {};
  }
}
