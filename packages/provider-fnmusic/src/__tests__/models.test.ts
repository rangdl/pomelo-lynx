import { md5Hex } from '@pomelo/provider-sdk';
import { describe, expect, test } from '@rstest/core';

import {
  buildAuthx,
  pageParams,
  parseListPage,
  parseLyrics,
  sortedQueryString,
  toProviderAlbum,
  toProviderPlaylist,
  toProviderTrack,
  unwrapEnvelope,
} from '../models.js';

describe('unwrapEnvelope', () => {
  test('code=0 与 code=200 都算成功', () => {
    expect(unwrapEnvelope({ code: 0, data: { a: 1 } })).toEqual({ a: 1 });
    expect(unwrapEnvelope({ code: 200, data: { a: 2 } })).toEqual({ a: 2 });
  });

  test('401 / 120001 映射为会话过期', () => {
    expect(() => unwrapEnvelope({ code: 401, msg: 'invalid token' })).toThrow(
      /登录已过期/,
    );
    expect(() => unwrapEnvelope({ code: 120001 })).toThrow(/登录已过期/);
  });

  test('其它非零码带上服务端 msg', () => {
    expect(() => unwrapEnvelope({ code: 500, msg: '磁盘已满' })).toThrow(
      /磁盘已满/,
    );
  });

  test('缺少 code 时提示地址不对', () => {
    expect(() => unwrapEnvelope({ data: {} })).toThrow(/code/);
  });
});

describe('toProviderTrack', () => {
  test('artists 是对象数组、album 是对象、duration 是毫秒', () => {
    const track = toProviderTrack({
      guid: 'g-1',
      title: '晴天',
      artists: [{ name: '周杰伦', guid: 'a1' }],
      album: { name: '叶惠美', guid: 'al1', coverId: 'c1' },
      audioSpec: { duration: 269000, format: 'flac' },
    });
    expect(track).toMatchObject({
      id: 'g-1',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      // 269000ms → 269s
      duration: 269,
    });
    // 封面 id 落在 resource.artwork 上
    expect(track?.resource?.artwork).toBe('c1');
  });

  test('多位歌手用逗号连接', () => {
    const track = toProviderTrack({
      guid: 'g',
      title: 't',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(track?.artist).toBe('A, B');
  });

  test('缺 guid 或标题时丢弃', () => {
    expect(toProviderTrack({ title: 't' })).toBeNull();
    expect(toProviderTrack({ guid: 'g' })).toBeNull();
    expect(toProviderTrack(null)).toBeNull();
  });

  test('album 是字符串时也能读', () => {
    const track = toProviderTrack({
      guid: 'g',
      title: 't',
      albumName: '专辑字符串',
    });
    expect(track?.album).toBe('专辑字符串');
  });
});

describe('toProviderAlbum / toProviderPlaylist', () => {
  test('专辑从 album 对象映射', () => {
    expect(
      toProviderAlbum({
        guid: 'al1',
        name: '叶惠美',
        artists: [{ name: '周杰伦' }],
      }),
    ).toMatchObject({ id: 'al1', name: '叶惠美', artist: '周杰伦' });
  });

  test('歌单映射 trackCount', () => {
    expect(
      toProviderPlaylist({ guid: 'p1', name: '我的歌单', trackCount: 9 }),
    ).toMatchObject({ id: 'p1', name: '我的歌单', trackCount: 9 });
  });
});

describe('parseListPage', () => {
  test('data.list + data.total', () => {
    const page = parseListPage(
      { list: [{ guid: 'g', title: 't' }], total: 42 },
      20,
      0,
      toProviderTrack,
    );
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(42);
  });

  test('data.items / data.tracks / data.records 都兼容', () => {
    for (const key of ['items', 'tracks', 'records']) {
      const page = parseListPage(
        { [key]: [{ guid: 'g', title: 't' }], total: 1 },
        20,
        0,
        toProviderTrack,
      );
      expect(page.items).toHaveLength(1);
    }
  });

  test('data 直接是数组时也接受', () => {
    const page = parseListPage(
      [{ guid: 'g', title: 't' }],
      20,
      0,
      toProviderTrack,
    );
    expect(page.items).toHaveLength(1);
  });
});

describe('parseLyrics', () => {
  test('data.lyric 是 LRC 文本', () => {
    expect(parseLyrics({ lyric: '[00:01.00]第一句' })?.lrc).toBe(
      '[00:01.00]第一句',
    );
  });

  test('包在 list 里也能取到', () => {
    expect(parseLyrics({ list: [{ lyric: '文本歌词' }] })?.lrc).toBe(
      '文本歌词',
    );
  });

  test('没有歌词返回 null', () => {
    expect(parseLyrics({})).toBeNull();
  });
});

describe('pageParams', () => {
  test('offset/limit 换算成 1 起的 page', () => {
    expect(pageParams(0, 50)).toEqual({ page: 1, size: 50 });
    expect(pageParams(50, 50)).toEqual({ page: 2, size: 50 });
    expect(pageParams(120, 40)).toEqual({ page: 4, size: 40 });
  });
});

describe('buildAuthx', () => {
  test('按实测算法生成 nonce/timestamp/sign', () => {
    const query = [
      ['page', '1'],
      ['size', '1'],
    ] as const;
    const data = sortedQueryString(query);
    // 排序后应为 page=1&size=1
    expect(data).toBe('page=1&size=1');

    const authx = buildAuthx({
      path: '/track/list',
      data,
      nonce: '123456',
      timestampMs: 1700000000000,
      md5: md5Hex,
    });
    expect(authx).toMatch(
      /^nonce=123456&timestamp=1700000000000&sign=[0-9a-f]{32}$/,
    );

    // 独立复算一遍,确保拼接顺序正确
    const prefix = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
    const key = '6D5602D4-A342-4799-A0F0-BB795E7167D0';
    const expectSign = md5Hex(
      `${prefix}_/track/list_123456_1700000000000_${md5Hex(data)}_${key}`,
    );
    expect(authx).toContain(`sign=${expectSign}`);
  });

  test('查询串先排序再签名(顺序不影响结果)', () => {
    const a = sortedQueryString([
      ['size', '1'],
      ['page', '1'],
    ]);
    const b = sortedQueryString([
      ['page', '1'],
      ['size', '1'],
    ]);
    expect(a).toBe(b);
  });

  test('不同时间戳产生不同签名(逐请求重算)', () => {
    const args = {
      path: '/track/list',
      data: '',
      nonce: '1',
      md5: md5Hex,
    };
    const one = buildAuthx({ ...args, timestampMs: 1000 });
    const two = buildAuthx({ ...args, timestampMs: 2000 });
    expect(one).not.toBe(two);
  });
});
