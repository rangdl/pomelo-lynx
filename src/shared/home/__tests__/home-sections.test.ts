import { describe, expect, test } from '@rstest/core';

import {
  DEFAULT_HOME_SECTIONS,
  normalizeHomeSections,
} from '../home-sections.js';

describe('normalizeHomeSections', () => {
  test('缺失/损坏的输入回落到默认布局', () => {
    expect(normalizeHomeSections(null)).toEqual([...DEFAULT_HOME_SECTIONS]);
    expect(normalizeHomeSections('nope')).toEqual([...DEFAULT_HOME_SECTIONS]);
    expect(normalizeHomeSections({})).toEqual([...DEFAULT_HOME_SECTIONS]);
  });

  test('保留存储里的顺序与显隐', () => {
    expect(
      normalizeHomeSections([
        { id: 'playlists', visible: false },
        { id: 'recent', visible: true },
      ]),
    ).toEqual([
      { id: 'playlists', visible: false },
      { id: 'recent', visible: true },
      // 存储里没有的条目按默认顺序补到末尾。
      { id: 'albums', visible: true },
    ]);
  });

  test('丢弃未知 id 与重复项', () => {
    expect(
      normalizeHomeSections([
        { id: 'unknown', visible: true },
        { id: 'recent', visible: true },
        { id: 'recent', visible: false },
      ]),
    ).toEqual([
      { id: 'recent', visible: true },
      { id: 'playlists', visible: true },
      { id: 'albums', visible: true },
    ]);
  });

  test('新增的条目会补到末尾,旧配置不会丢条目', () => {
    const sections = normalizeHomeSections([{ id: 'recent', visible: false }]);
    expect(sections.map((section) => section.id)).toEqual([
      'recent',
      'playlists',
      'albums',
    ]);
    expect(sections[0]?.visible).toBe(false);
  });
});
