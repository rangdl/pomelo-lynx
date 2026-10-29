import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

import {
  NAVIGATION_SWIPE_EVENT,
  type NavigationSwipeEvent,
  subscribeNavigationSwipe,
} from '../navigation.js';

const globals = globalThis as unknown as { lynx?: unknown };

describe('navigation swipe event', () => {
  beforeEach(() => {
    globals.lynx = undefined;
  });

  afterEach(() => {
    globals.lynx = undefined;
  });

  test('订阅拖拽进度并在退订时移除监听', () => {
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

    const events: NavigationSwipeEvent[] = [];
    const unsubscribe = subscribeNavigationSwipe((event) => events.push(event));
    expect(listeners.has(NAVIGATION_SWIPE_EVENT)).toBe(true);

    listeners.get(NAVIGATION_SWIPE_EVENT)?.({
      phase: 'change',
      translation: 120,
      width: 390,
      progress: 0.31,
      commit: false,
    });
    expect(events[0]).toEqual({
      phase: 'change',
      translation: 120,
      width: 390,
      progress: 0.31,
      commit: false,
    });

    listeners.get(NAVIGATION_SWIPE_EVENT)?.(
      '{"phase":"end","translation":390,"width":390,"progress":1,"commit":true}',
    );
    expect(events[1]).toMatchObject({ phase: 'end', commit: true });

    unsubscribe();
    expect(removed).toEqual([NAVIGATION_SWIPE_EVENT]);
  });

  test('忽略非法事件,没有发射器时退订安全', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    globals.lynx = {
      getJSModule: () => ({
        addListener: (event: string, handler: (payload: unknown) => void) => {
          listeners.set(event, handler);
        },
        removeListener: () => {},
      }),
    };
    const events: NavigationSwipeEvent[] = [];
    const unsubscribe = subscribeNavigationSwipe((event) => events.push(event));
    listeners.get(NAVIGATION_SWIPE_EVENT)?.({ phase: 'oops' });
    listeners.get(NAVIGATION_SWIPE_EVENT)?.('not json');
    expect(events).toEqual([]);
    unsubscribe();

    globals.lynx = {};
    const empty = subscribeNavigationSwipe(() => {});
    expect(() => empty()).not.toThrow();
  });
});
