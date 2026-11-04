import { readLynxGlobal, readNativeModules } from './native-modules.js';

/**
 * Android 硬件返回键桥(批次 3;iOS 无返回键,不实现)。
 *
 * 宿主(`host/android` 的 `PomeloHostModule`)在 `onBackPressed` 时不直接
 * 退出,而是发 `PomeloNavigation.backquery` 事件(载荷 `{requestId}`)。
 * JS 用 [subscribeHardwareBack] 注册的处理器决定这一下返回键做什么:
 *
 *   - `'pop'`     页面栈有父级,由路由层 pop(ShellLayout 接管);
 *   - `'dismiss'` 关闭了浮层/抽屉,页面栈不动;
 *   - `'unhandled'` 没有可返回的东西,宿主走默认行为(moveTaskToBack)。
 *
 * 处理器是同步的:回答回传走 `NativeModules.PomeloHost.resolveBack`。
 * 宿主 8 秒收不到回答按 unhandled 兜底(老 bundle 没有监听时不卡键)。
 */

/** 宿主 → JS 的返回键查询事件。 */
export const BACK_QUERY_EVENT = 'PomeloNavigation.backquery';

/** 处理器的裁决。 */
export type HardwareBackAction = 'pop' | 'dismiss' | 'unhandled';

/** `NativeModules.PomeloHost` 的最小接口(Android 新宿主)。 */
interface PomeloHostNativeModule {
  resolveBack?(
    requestId: string,
    handled: boolean,
    callback: (resultJSON: string) => void,
  ): void;
}

function hostModule(): PomeloHostNativeModule | null {
  const candidate = readNativeModules()?.PomeloHost as
    | PomeloHostNativeModule
    | undefined;
  return candidate && typeof candidate.resolveBack === 'function'
    ? candidate
    : null;
}

type BackHandler = () => HardwareBackAction;

/** 当前注册的处理器;后注册者胜(页面栈只有一个真实消费者)。 */
let handler: BackHandler | null = null;

/**
 * 注册返回键处理器。在 background effect 里调用;返回取消注册函数。
 * 没有宿主桥(Web / iOS / 测试)时注册仍成功但永远不会被触发——
 * 处理器写法应当与平台无关,由 ShellLayout 统一接管。
 */
export function subscribeHardwareBack(listener: BackHandler): () => void {
  'background only';
  handler = listener;

  const emitter = readLynxGlobal()?.getJSModule?.('GlobalEventEmitter');
  let active = true;
  let queryListener: ((payload: unknown) => void) | null = null;

  if (typeof emitter?.addListener === 'function') {
    queryListener = (raw: unknown) => {
      if (!active) return;
      let requestId = '';
      try {
        const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const record = Array.isArray(parsed) ? parsed[0] : parsed;
        if (
          record &&
          typeof record === 'object' &&
          typeof (record as { requestId?: unknown }).requestId === 'string'
        ) {
          requestId = (record as { requestId: string }).requestId;
        }
      } catch {
        /* 坏事件按 unhandled 回答,不能卡住返回键。 */
      }
      const action = safeInvoke();
      answer(requestId, action);
    };
    try {
      emitter?.addListener?.(BACK_QUERY_EVENT, queryListener);
    } catch {
      queryListener = null;
    }
  }

  function safeInvoke(): HardwareBackAction {
    try {
      return handler?.() ?? 'unhandled';
    } catch {
      return 'unhandled';
    }
  }

  function answer(requestId: string, action: HardwareBackAction): void {
    // pop/dismiss 都算"已消化";宿主只在 unhandled 时退出。
    const handled = action !== 'unhandled';
    const module = hostModule();
    if (!module) return;
    try {
      module.resolveBack?.(requestId, handled, () => {
        /* 回执只用于原生侧日志;失败无需补偿。 */
      });
    } catch {
      /* 宿主已卸载:超时兜底会走 unhandled。 */
    }
  }

  return () => {
    if (!active) return;
    active = false;
    if (handler === listener) handler = null;
    if (queryListener) {
      try {
        emitter?.removeListener?.(BACK_QUERY_EVENT, queryListener);
      } catch {
        /* 宿主已卸载。 */
      }
    }
  };
}
