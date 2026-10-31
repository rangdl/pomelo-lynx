import { describe, expect, test } from '@rstest/core';

import { parsePlayerState } from '../player.js';

describe('player state parsing', () => {
  test('接受对象、JSON 字符串和 sendGlobalEvent 数组包装', () => {
    const value = {
      state: 'playing',
      url: 'https://example.com/a.mp3',
      position: 12.5,
      duration: 120,
      error: '',
      queueIndex: 2,
      lyric: '',
      rate: 1,
      volume: 1,
      engine: 'system',
    };
    const expected = {
      state: 'playing',
      url: 'https://example.com/a.mp3',
      position: 12.5,
      duration: 120,
      error: '',
      queueIndex: 2,
      lyric: '',
      rate: 1,
      volume: 1,
      engine: 'system',
    };
    expect(parsePlayerState(value)).toEqual(expected);
    expect(parsePlayerState(JSON.stringify(value))).toEqual(expected);
    expect(parsePlayerState([JSON.stringify(value)])).toEqual(expected);
  });

  test('非法状态回退为 idle,负数时间归零', () => {
    expect(
      parsePlayerState({ state: 'buffering', position: -1, duration: 'x' }),
    ).toEqual({
      state: 'idle',
      url: '',
      position: 0,
      duration: 0,
      error: '',
      queueIndex: -1,
      lyric: '',
      rate: 1,
      volume: 1,
      engine: 'system',
    });
    expect(parsePlayerState('{broken')).toBeNull();
    expect(parsePlayerState(null)).toBeNull();
  });
});
