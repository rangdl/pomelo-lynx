import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

import {
  NAVIGATION_BACK_EVENT,
  subscribeNavigationBack,
} from '../navigation.js';

const globals = globalThis as unknown as { lynx?: unknown };

describe('navigation back event', () => {
  beforeEach(() => {
    globals.lynx = undefined;
  });

  afterEach(() => {
    globals.lynx = undefined;
  });

  test('订阅侧滑返回并在退订时移除监听', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const removed: string[] = [];
    globals.lynx = {
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

    const calls: string[] = [];
    const unsubscribe = subscribeNavigationBack(() => calls.push('back'));
    expect(listeners.has(NAVIGATION_BACK_EVENT)).toBe(true);

    listeners.get(NAVIGATION_BACK_EVENT)?.({ source: 'edge' });
    expect(calls).toEqual(['back']);

    unsubscribe();
    expect(removed).toEqual([NAVIGATION_BACK_EVENT]);
  });

  test('没有事件发射器时退订是空操作', () => {
    globals.lynx = {};
    const unsubscribe = subscribeNavigationBack(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
