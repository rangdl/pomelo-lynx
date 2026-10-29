import { readLynxGlobal } from './native-modules.js';

/**
 * 宿主外观:深浅色与安全区。初值来自 `lynx.__globalProps`(首帧前注入),
 * 运行中变化由宿主通过 `PomeloAppearance.changed` 全局事件推送。
 */
export type ColorScheme = 'light' | 'dark';

export interface SystemAppearance {
  colorScheme: ColorScheme;
  safeTop: number;
  safeBottom: number;
  safeLeft: number;
  safeRight: number;
}

export const APPEARANCE_EVENT = 'PomeloAppearance.changed';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function normalize(
  value: Record<string, unknown>,
  fallback: SystemAppearance,
): SystemAppearance {
  return {
    colorScheme:
      value.colorScheme === 'dark'
        ? 'dark'
        : value.colorScheme === 'light'
          ? 'light'
          : fallback.colorScheme,
    safeTop: nonNegative(value.safeTop, fallback.safeTop),
    safeBottom: nonNegative(value.safeBottom, fallback.safeBottom),
    safeLeft: nonNegative(value.safeLeft, fallback.safeLeft),
    safeRight: nonNegative(value.safeRight, fallback.safeRight),
  };
}

function globalProps(): Record<string, unknown> {
  const props = readLynxGlobal()?.__globalProps;
  return isRecord(props) ? props : {};
}

/** 读取首帧外观;缺失字段回落到亮色/0。 */
export function readSystemAppearance(): SystemAppearance {
  return normalize(globalProps(), {
    colorScheme: 'light',
    safeTop: 0,
    safeBottom: 0,
    safeLeft: 0,
    safeRight: 0,
  });
}

function parseEventPayload(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(raw) ? raw : {};
}

/**
 * 订阅宿主外观变化。宿主可能在 JS 侧监听器挂载前就发过首帧事件,所以
 * 调用方应先 `readSystemAppearance()` 再订阅;事件按字段合并到当前值。
 */
export function subscribeSystemAppearance(
  listener: (value: SystemAppearance) => void,
): () => void {
  'background only';
  const emitter = readLynxGlobal()?.getJSModule?.('GlobalEventEmitter');
  if (
    typeof emitter?.addListener !== 'function' ||
    typeof emitter?.removeListener !== 'function'
  )
    return () => {};

  let current = readSystemAppearance();
  let active = true;
  const handler = (raw: unknown) => {
    if (!active) return;
    try {
      const payload = { ...parseEventPayload(raw) };
      // 只有真实的前台 trait 变化/前台重读才允许改系统主题。安全区事件
      // 和旧宿主(无 reason)的事件只同步安全区,避免后台瞬态 dark 误切。
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      if (
        reason !== 'trait' &&
        reason !== 'foreground' &&
        reason !== 'firstScreen'
      ) {
        delete payload.colorScheme;
      }
      current = normalize(payload, current);
      listener(current);
    } catch {
      /* 坏事件不能影响页面。 */
    }
  };
  emitter?.addListener?.(APPEARANCE_EVENT, handler);
  return () => {
    if (!active) return;
    active = false;
    try {
      emitter?.removeListener?.(APPEARANCE_EVENT, handler);
    } catch {
      /* 宿主已卸载。 */
    }
  };
}
