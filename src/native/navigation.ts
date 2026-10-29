import { readLynxGlobal } from './native-modules.js';

/** 原生左边缘拖拽事件。 */
export const NAVIGATION_SWIPE_EVENT = 'PomeloNavigation.swipe';

export type NavigationSwipePhase = 'begin' | 'change' | 'end';

export interface NavigationSwipeEvent {
  phase: NavigationSwipePhase;
  /** 手指横向位移,单位 pt。 */
  translation: number;
  /** 页面宽度,用于计算提交阈值和滑出距离。 */
  width: number;
  /** translation / width,0–1。 */
  progress: number;
  /** 仅 end 阶段:是否达到返回阈值。 */
  commit: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parse(raw: unknown): NavigationSwipeEvent | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  // sendGlobalEvent 的第一个参数可能被包成数组。
  if (Array.isArray(value)) value = value[0];
  if (!isRecord(value)) return null;
  const phase = value.phase;
  if (phase !== 'begin' && phase !== 'change' && phase !== 'end') return null;
  const number = (input: unknown): number =>
    typeof input === 'number' && Number.isFinite(input) ? input : 0;
  return {
    phase,
    translation: number(value.translation),
    width: number(value.width),
    progress: number(value.progress),
    commit: value.commit === true,
  };
}

/**
 * 订阅左边缘拖拽进度。只负责传数据;页面位移和是否返回由 JS 主线程/
 * 路由决定。宿主没有导航栈。
 */
export function subscribeNavigationSwipe(
  listener: (event: NavigationSwipeEvent) => void,
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
      const event = parse(raw);
      if (event) listener(event);
    };
    emitter.addListener(NAVIGATION_SWIPE_EVENT, handler);
    return () => {
      if (!active) return;
      active = false;
      try {
        emitter.removeListener?.(NAVIGATION_SWIPE_EVENT, handler);
      } catch {
        // 宿主已卸载。
      }
    };
  } catch {
    return () => {};
  }
}
