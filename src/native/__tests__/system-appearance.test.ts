import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

import {
  readSystemAppearance,
  type SystemAppearance,
  subscribeSystemAppearance,
} from '../system-appearance.js';

const globals = globalThis as unknown as { lynx?: unknown };

const DEFAULTS: SystemAppearance = {
  colorScheme: 'light',
  safeTop: 0,
  safeBottom: 0,
  safeLeft: 0,
  safeRight: 0,
};

describe('system appearance', () => {
  beforeEach(() => {
    globals.lynx = undefined;
  });

  afterEach(() => {
    globals.lynx = undefined;
  });

  test('缺少 globalProps 时回落为亮色/零安全区', () => {
    globals.lynx = {};
    expect(readSystemAppearance()).toEqual(DEFAULTS);
  });

  test('读取深色与安全区数值', () => {
    globals.lynx = {
      __globalProps: {
        colorScheme: 'dark',
        safeTop: 47,
        safeBottom: 34,
        safeLeft: 1,
        safeRight: 2,
      },
    };
    expect(readSystemAppearance()).toEqual({
      colorScheme: 'dark',
      safeTop: 47,
      safeBottom: 34,
      safeLeft: 1,
      safeRight: 2,
    });
  });

  test('忽略非法枚举与负数', () => {
    globals.lynx = {
      __globalProps: {
        colorScheme: 'sepia',
        safeTop: -1,
        safeBottom: '34',
        safeLeft: Number.NaN,
        safeRight: 12,
      },
    };
    expect(readSystemAppearance()).toEqual({
      ...DEFAULTS,
      safeRight: 12,
    });
  });

  test('订阅事件并合并部分字段,退订后移除监听', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const removed: string[] = [];
    globals.lynx = {
      __globalProps: { ...DEFAULTS },
      getJSModule: (name: string) => {
        if (name !== 'GlobalEventEmitter') return undefined;
        return {
          addListener: (event: string, handler: (payload: unknown) => void) => {
            listeners.set(event, handler);
          },
          removeListener: (event: string) => {
            removed.push(event);
            listeners.delete(event);
          },
        };
      },
    };

    const seen: SystemAppearance[] = [];
    const unsubscribe = subscribeSystemAppearance((value) => seen.push(value));
    const handler = listeners.get('PomeloAppearance.changed');
    expect(handler).toBeDefined();

    handler?.({ colorScheme: 'dark', safeBottom: 34 });
    expect(seen.at(-1)).toEqual({
      ...DEFAULTS,
      colorScheme: 'dark',
      safeBottom: 34,
    });

    handler?.('{"safeTop":47,"colorScheme":"light"}');
    expect(seen.at(-1)).toEqual({
      ...DEFAULTS,
      colorScheme: 'light',
      safeTop: 47,
      // 部分事件只覆盖出现的字段,上一次的 safeBottom 保留。
      safeBottom: 34,
    });

    unsubscribe();
    expect(removed).toEqual(['PomeloAppearance.changed']);
  });

  test('没有事件发射器时返回可调用的空退订', () => {
    globals.lynx = {};
    const unsubscribe = subscribeSystemAppearance(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
