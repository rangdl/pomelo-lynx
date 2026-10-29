import { readLynxGlobal } from './native-modules.js';

/** 原生左边缘侧滑手势推入根 LynxView 的事件名。 */
export const NAVIGATION_BACK_EVENT = 'PomeloNavigation.back';

/**
 * 订阅 iOS 左边缘侧滑返回。宿主没有导航栈,只负责发“用户想返回”;
 * 是否真的返回由 JS 路由判断(根 tab 不响应,子页 pop 历史)。
 */
export function subscribeNavigationBack(listener: () => void): () => void {
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
    emitter.addListener(NAVIGATION_BACK_EVENT, handler);
    return () => {
      if (!active) return;
      active = false;
      try {
        emitter.removeListener?.(NAVIGATION_BACK_EVENT, handler);
      } catch {
        // 宿主已卸载。
      }
    };
  } catch {
    return () => {};
  }
}
