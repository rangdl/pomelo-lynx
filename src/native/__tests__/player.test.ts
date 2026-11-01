import { describe, expect, test } from '@rstest/core';

import { parsePlayerEvent, parsePlayerState } from '../player.js';

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
      refreshing: false,
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
      refreshing: false,
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
      refreshing: false,
    });
    expect(parsePlayerState('{broken')).toBeNull();
    expect(parsePlayerState(null)).toBeNull();
  });
});

describe('player event parsing', () => {
  test('解析语义事件与刷新请求', () => {
    const event = {
      type: 'refresh_required',
      url: 'https://example.com/a.mp3',
      queueIndex: 3,
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      position: 42.5,
      duration: 269,
      error: '',
      requestId: 'req-1',
      status: 401,
    };
    expect(parsePlayerEvent(event)).toEqual(event);
    expect(parsePlayerEvent(JSON.stringify(event))).toEqual(event);
    expect(parsePlayerEvent([JSON.stringify(event)])).toEqual(event);
  });

  test('未知事件类型返回 null，缺省字段安全回落', () => {
    expect(parsePlayerEvent({ type: 'progress' })).toBeNull();
    expect(parsePlayerEvent('{broken')).toBeNull();
    expect(parsePlayerEvent(null)).toBeNull();
    expect(parsePlayerEvent({ type: 'started' })).toEqual({
      type: 'started',
      url: '',
      queueIndex: -1,
      title: '',
      artist: '',
      album: '',
      position: 0,
      duration: 0,
      error: '',
      requestId: '',
      status: 0,
    });
  });
});
