import { readLynxGlobal } from './native-modules.js';

/** 原生宿主在前台恢复后推入根 LynxView 的事件名。 */
export const APP_RESUMED_EVENT = 'PomeloLifecycle.resumed';

/** 在 background effect 里订阅;宿主可能从不发该事件。 */
export function subscribeAppResumed(listener: () => void): () => void {
  'background only';
  try {
    const emitter = readLynxGlobal()?.getJSModule?.('GlobalEventEmitter');
    if (
      typeof emitter?.addListener !== 'function' ||
      typeof emitter?.removeListener !== 'function'
    )
      return () => {};
    let active = true;
    const handler = () => {
      if (active) listener();
    };
    emitter.addListener(APP_RESUMED_EVENT, handler);
    return () => {
      if (!active) return;
      active = false;
      try {
        emitter.removeListener(APP_RESUMED_EVENT, handler);
      } catch {
        // 晚到事件触不到已卸载页面。
      }
    };
  } catch {
    return () => {};
  }
}
