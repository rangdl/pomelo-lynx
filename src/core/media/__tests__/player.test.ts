import { beforeEach, describe, expect, test } from '@rstest/core';

import {
  appendMediaTracks,
  enqueueMedia,
  type MediaTrack,
  mediaPlayerStore,
  removeMediaAt,
  trackTitleFromURL,
} from '../player.js';

function track(url: string, title = url): MediaTrack {
  return { url, title };
}

function reset(
  queue: MediaTrack[] = [],
  currentIndex = -1,
  state: 'idle' | 'playing' | 'paused' | 'ended' = 'idle',
): void {
  mediaPlayerStore.setState({
    available: false,
    busy: false,
    queue,
    currentIndex,
    state,
    url: currentIndex >= 0 ? (queue[currentIndex]?.url ?? '') : '',
    position: 0,
    duration: 0,
    error: '',
  });
}

describe('媒体队列操作', () => {
  beforeEach(() => {
    reset();
  });

  test('没有标题时用 URL 文件名兜底', () => {
    expect(
      trackTitleFromURL('https://cdn.example.com/music/a%20b.mp3?token=1'),
    ).toBe('a b.mp3');
    expect(trackTitleFromURL('https://cdn.example.com/')).toBe(
      'cdn.example.com',
    );
  });

  test('添加到列表追加到末尾且不打断当前播放', () => {
    reset([track('https://cdn.example.com/a.mp3')], 0, 'playing');
    enqueueMedia('https://cdn.example.com/b.mp3', { title: 'B' });

    expect(mediaPlayerStore.getState().queue).toEqual([
      track('https://cdn.example.com/a.mp3'),
      track('https://cdn.example.com/b.mp3', 'B'),
    ]);
    expect(mediaPlayerStore.getState().currentIndex).toBe(0);
  });

  test('批量追加保留顺序并去重', () => {
    reset([track('https://cdn.example.com/a.mp3')], 0, 'playing');
    appendMediaTracks([
      track('https://cdn.example.com/a.mp3'),
      track('https://cdn.example.com/b.mp3', 'B'),
      track('https://cdn.example.com/c.mp3', 'C'),
    ]);

    expect(mediaPlayerStore.getState().queue.map((item) => item.url)).toEqual([
      'https://cdn.example.com/a.mp3',
      'https://cdn.example.com/b.mp3',
      'https://cdn.example.com/c.mp3',
    ]);
    expect(mediaPlayerStore.getState().currentIndex).toBe(0);
  });

  test('下一首播放插到当前曲目之后', () => {
    reset(
      [
        track('https://cdn.example.com/a.mp3'),
        track('https://cdn.example.com/b.mp3'),
      ],
      0,
      'playing',
    );
    enqueueMedia('https://cdn.example.com/c.mp3', { title: 'C' }, 'next');

    expect(mediaPlayerStore.getState().queue.map((item) => item.url)).toEqual([
      'https://cdn.example.com/a.mp3',
      'https://cdn.example.com/c.mp3',
      'https://cdn.example.com/b.mp3',
    ]);
    expect(mediaPlayerStore.getState().currentIndex).toBe(0);
  });

  test('下一首播放会移动已在队列中的曲目并修正当前索引', () => {
    reset(
      [
        track('https://cdn.example.com/a.mp3'),
        track('https://cdn.example.com/b.mp3'),
        track('https://cdn.example.com/c.mp3'),
      ],
      2,
      'playing',
    );
    enqueueMedia('https://cdn.example.com/a.mp3', undefined, 'next');

    expect(mediaPlayerStore.getState().queue.map((item) => item.url)).toEqual([
      'https://cdn.example.com/b.mp3',
      'https://cdn.example.com/c.mp3',
      'https://cdn.example.com/a.mp3',
    ]);
    expect(mediaPlayerStore.getState().currentIndex).toBe(1);
  });

  test('移出当前曲目之前的项会修正当前索引', () => {
    reset(
      [
        track('https://cdn.example.com/a.mp3'),
        track('https://cdn.example.com/b.mp3'),
        track('https://cdn.example.com/c.mp3'),
      ],
      2,
      'playing',
    );
    removeMediaAt(0);

    expect(mediaPlayerStore.getState().queue.map((item) => item.url)).toEqual([
      'https://cdn.example.com/b.mp3',
      'https://cdn.example.com/c.mp3',
    ]);
    expect(mediaPlayerStore.getState().currentIndex).toBe(1);
  });

  test('移出当前曲目时切到下一首', () => {
    reset(
      [
        track('https://cdn.example.com/a.mp3'),
        track('https://cdn.example.com/b.mp3'),
      ],
      0,
      'playing',
    );
    removeMediaAt(0);

    expect(mediaPlayerStore.getState().queue).toEqual([
      track('https://cdn.example.com/b.mp3'),
    ]);
    expect(mediaPlayerStore.getState().currentIndex).toBe(0);
  });

  test('移出最后一首会停止播放并保留前面的队列', () => {
    reset(
      [
        track('https://cdn.example.com/a.mp3'),
        track('https://cdn.example.com/b.mp3'),
      ],
      1,
      'playing',
    );
    removeMediaAt(1);

    expect(mediaPlayerStore.getState().queue).toEqual([
      track('https://cdn.example.com/a.mp3'),
    ]);
    expect(mediaPlayerStore.getState().currentIndex).toBe(-1);
    expect(mediaPlayerStore.getState().state).toBe('idle');
    expect(mediaPlayerStore.getState().url).toBe('');
  });

  test('移出唯一一项会清空队列', () => {
    reset([track('https://cdn.example.com/a.mp3')], 0, 'playing');
    removeMediaAt(0);

    expect(mediaPlayerStore.getState().queue).toEqual([]);
    expect(mediaPlayerStore.getState().currentIndex).toBe(-1);
    expect(mediaPlayerStore.getState().state).toBe('idle');
  });
});
