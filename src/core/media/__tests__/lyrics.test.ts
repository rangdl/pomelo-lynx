import { describe, expect, test } from '@rstest/core';

import { parseLrc } from '../lyrics.js';

describe('LRC 解析', () => {
  test('支持一行多时间戳并按时间排序', () => {
    const lines = parseLrc(
      '[00:12.50][00:30.00]副歌\n[00:01.00]第一句\n[ar:测试]\n[00:20.005]第二句',
    );
    expect(lines).toEqual([
      { time: 1, text: '第一句' },
      { time: 12.5, text: '副歌' },
      { time: 20.005, text: '第二句' },
      { time: 30, text: '副歌' },
    ]);
  });

  test('忽略空行和空文本', () => {
    expect(parseLrc('\n[00:01.00]\n[00:02.00]有效\n')).toEqual([
      { time: 2, text: '有效' },
    ]);
  });
});
