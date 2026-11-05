import { describe, expect, test } from '@rstest/core';

import {
  parseAlbumDetail,
  parseAlbumList,
  parseLyrics,
  parsePlaylistDetail,
  parsePlaylistList,
  parseSearchResult,
  parseSong,
  supportsOpenSubsonic,
  unwrapEnvelope,
} from '../models.js';

/** 构造 Subsonic 信封。 */
function envelope(extra: Record<string, unknown>) {
  return { 'subsonic-response': { status: 'ok', version: '1.16.1', ...extra } };
}

describe('unwrapEnvelope', () => {
  test('取出 status=ok 的信封本体', () => {
    const body = unwrapEnvelope(envelope({ ping: {} }));
    expect(body.status).toBe('ok');
    expect(body.version).toBe('1.16.1');
  });

  test('缺少 subsonic-response 节点时报格式异常', () => {
    expect(() => unwrapEnvelope({ foo: 1 })).toThrow(/subsonic-response/);
  });

  test('status=failed 时按官方错误码映射', () => {
    // 官方错误码 40 = 用户名或密码错误
    expect(() =>
      unwrapEnvelope({
        'subsonic-response': {
          status: 'failed',
          error: { code: 40, message: 'Wrong username or password' },
        },
      }),
    ).toThrow(/用户名或密码错误/);
  });

  test('错误码 50 映射为无权限,70 映射为找不到', () => {
    const fail = (code: number) => ({
      'subsonic-response': { status: 'failed', error: { code } },
    });
    expect(() => unwrapEnvelope(fail(50))).toThrow(/无权/);
    expect(() => unwrapEnvelope(fail(70))).toThrow(/找不到/);
  });
});

describe('parseSearchResult', () => {
  test('search3 的 song 数组映射为 ProviderTrack', () => {
    const body = unwrapEnvelope(
      envelope({
        searchResult3: {
          song: [
            {
              id: 'abc-123',
              title: '晴天',
              artist: '周杰伦',
              album: '叶惠美',
              duration: 269,
            },
          ],
        },
      }),
    );
    const page = parseSearchResult(body, 20, 0);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'abc-123',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      duration: 269,
    });
  });

  test('单个对象(非数组)也能解析', () => {
    const body = unwrapEnvelope(
      envelope({ searchResult3: { song: { id: 'x', title: 't' } } }),
    );
    expect(parseSearchResult(body, 20, 0).items).toHaveLength(1);
  });

  test('兼容老的 searchResult2 命名', () => {
    const body = unwrapEnvelope(
      envelope({ searchResult2: { song: [{ id: 'x', title: 't' }] } }),
    );
    expect(parseSearchResult(body, 20, 0).items).toHaveLength(1);
  });
});

describe('parseAlbumList / parseAlbumDetail', () => {
  test('getAlbumList2 映射专辑字段', () => {
    const body = unwrapEnvelope(
      envelope({
        albumList2: {
          album: [
            {
              id: 'al-1',
              name: '叶惠美',
              artist: '周杰伦',
              songCount: 12,
              year: 2003,
            },
          ],
        },
      }),
    );
    const page = parseAlbumList(body, 50, 0);
    expect(page.items[0]).toMatchObject({
      id: 'al-1',
      name: '叶惠美',
      artist: '周杰伦',
      trackCount: 12,
      year: 2003,
    });
  });

  test('getAlbum 同时给出专辑信息与曲目', () => {
    const body = unwrapEnvelope(
      envelope({
        album: {
          id: 'al-1',
          name: '叶惠美',
          song: [{ id: 's1', title: '以父之名' }],
        },
      }),
    );
    const { album, tracks } = parseAlbumDetail(body, 200, 0);
    expect(album).toMatchObject({ id: 'al-1', name: '叶惠美' });
    expect(tracks.items).toHaveLength(1);
    expect(tracks.items[0]?.title).toBe('以父之名');
  });
});

describe('playlists', () => {
  test('getPlaylists 映射歌单', () => {
    const body = unwrapEnvelope(
      envelope({
        playlists: {
          playlist: [
            { id: 'p1', name: '我的歌单', songCount: 5, comment: '说明' },
          ],
        },
      }),
    );
    const page = parsePlaylistList(body, 50, 0);
    expect(page.items[0]).toMatchObject({
      id: 'p1',
      name: '我的歌单',
      trackCount: 5,
      description: '说明',
    });
  });

  test('getPlaylist 的 entry 是曲目数组', () => {
    const body = unwrapEnvelope(
      envelope({ playlist: { id: 'p1', entry: [{ id: 's1', title: 'a' }] } }),
    );
    expect(parsePlaylistDetail(body, 200, 0).items).toHaveLength(1);
  });
});

describe('parseSong', () => {
  test('getSong 返回单曲', () => {
    const body = unwrapEnvelope(
      envelope({ song: { id: 's1', title: '晴天' } }),
    );
    expect(parseSong(body)).toMatchObject({ id: 's1', title: '晴天' });
  });
});

describe('parseLyrics', () => {
  test('OpenSubsonic 的同步歌词转成 LRC', () => {
    const body = unwrapEnvelope(
      envelope({
        lyricsList: {
          structuredLyrics: [
            {
              synced: true,
              line: [
                { start: 1000, value: '第一句' },
                { start: 65000, value: '第二句' },
              ],
            },
          ],
        },
      }),
    );
    const lyrics = parseLyrics(body);
    expect(lyrics?.lrc).toBe('[00:01.00]第一句\n[01:05.00]第二句');
  });

  test('不同步歌词退化成纯文本', () => {
    const body = unwrapEnvelope(
      envelope({
        lyricsList: {
          structuredLyrics: [
            { synced: false, line: [{ value: '第一句' }, { value: '第二句' }] },
          ],
        },
      }),
    );
    expect(parseLyrics(body)?.lrc).toBe('第一句\n第二句');
  });

  test('回退标准 getLyrics 的纯文本', () => {
    const body = unwrapEnvelope(envelope({ lyrics: { value: '纯文本歌词' } }));
    expect(parseLyrics(body)?.lrc).toBe('纯文本歌词');
  });

  test('没有歌词时返回 null', () => {
    expect(parseLyrics(unwrapEnvelope(envelope({})))).toBeNull();
  });
});

describe('supportsOpenSubsonic', () => {
  test('openSubsonic 标记为 true 时识别为支持', () => {
    expect(supportsOpenSubsonic({ status: 'ok', openSubsonic: true })).toBe(
      true,
    );
    expect(supportsOpenSubsonic({ status: 'ok' })).toBe(false);
  });
});
