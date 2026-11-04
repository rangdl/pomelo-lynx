import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

import {
  BACK_QUERY_EVENT,
  type HardwareBackAction,
  subscribeHardwareBack,
} from '../hardware-back.js';

const globals = globalThis as unknown as {
  lynx?: unknown;
  NativeModules?: Record<string, unknown>;
};

describe('hardware back bridge', () => {
  beforeEach(() => {
    globals.lynx = undefined;
    globals.NativeModules = undefined;
  });

  afterEach(() => {
    globals.lynx = undefined;
    globals.NativeModules = undefined;
  });

  test('pop 裁决回答 handled=true,unhandled 回答 handled=false', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const answers: Array<{ requestId: string; handled: boolean }> = [];
    globals.lynx = {
      getJSModule: (name: string) => {
        if (name !== 'GlobalEventEmitter') return undefined;
        return {
          addListener: (event: string, handler: (payload: unknown) => void) => {
            listeners.set(event, handler);
          },
          removeListener: () => {},
        };
      },
    };
    globals.NativeModules = {
      PomeloHost: {
        resolveBack: (
          requestId: string,
          handled: boolean,
          callback: (resultJSON: string) => void,
        ) => {
          answers.push({ requestId, handled });
          callback('{"ok":true}');
        },
      },
    };

    let action: HardwareBackAction = 'unhandled';
    const unsubscribe = subscribeHardwareBack(() => action);
    expect(listeners.has(BACK_QUERY_EVENT)).toBe(true);

    const fire = (requestId: string) =>
      listeners.get(BACK_QUERY_EVENT)?.({ requestId });

    action = 'pop';
    fire('r1');
    action = 'dismiss';
    fire('r2');
    action = 'unhandled';
    fire('r3');
    expect(answers).toEqual([
      { requestId: 'r1', handled: true },
      { requestId: 'r2', handled: true },
      { requestId: 'r3', handled: false },
    ]);

    unsubscribe();
  });

  test('处理器抛异常或事件损坏时按 unhandled 回答', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const answers: Array<{ requestId: string; handled: boolean }> = [];
    globals.lynx = {
      getJSModule: (name: string) => {
        if (name !== 'GlobalEventEmitter') return undefined;
        return {
          addListener: (event: string, handler: (payload: unknown) => void) => {
            listeners.set(event, handler);
          },
          removeListener: () => {},
        };
      },
    };
    globals.NativeModules = {
      PomeloHost: {
        resolveBack: (
          requestId: string,
          handled: boolean,
          _callback: () => void,
        ) => {
          answers.push({ requestId, handled });
        },
      },
    };

    const unsubscribe = subscribeHardwareBack(() => {
      throw new Error('boom');
    });
    // 坏载荷(requestId 解析失败)也必须回答,不能卡住返回键。
    listeners.get(BACK_QUERY_EVENT)?.('not-json{{{');
    expect(answers).toEqual([{ requestId: '', handled: false }]);

    unsubscribe();
  });

  test('无 PomeloHost 模块时订阅成功但回答为空操作', () => {
    globals.lynx = { getJSModule: () => undefined };
    const unsubscribe = subscribeHardwareBack(() => 'pop');
    // 不抛异常即通过:Web/iOS/测试环境永远不触发。
    unsubscribe();
    expect(typeof unsubscribe).toBe('function');
  });
});
