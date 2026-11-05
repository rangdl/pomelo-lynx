import type { ProviderFetch, ProviderSecureStore } from '@pomelo/provider-sdk';
import { describe, expect, test } from '@rstest/core';

import { SubsonicProvider } from '../provider.js';

interface Call {
  url: string;
  init?: RequestInit;
}

function memorySecure(): ProviderSecureStore & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async remove(key) {
      store.delete(key);
    },
  };
}

/** 构造一个记录请求并按路由返回 JSON 的 fetch。 */
function makeFetch(
  routes: (url: string) => unknown,
  calls: Call[],
  status = 200,
): ProviderFetch {
  return async (input, init) => {
    calls.push({ url: input, init });
    const body = routes(input);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  };
}

function envelope(extra: Record<string, unknown>) {
  return { 'subsonic-response': { status: 'ok', version: '1.16.1', ...extra } };
}

function queryOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

/** 取第 index 次请求;不存在时直接失败,避免用非空断言(项目禁止)。 */
function callAt(calls: Call[], index: number): Call {
  const call = calls[index];
  if (!call)
    throw new Error(`期望第 ${index} 次请求,实际只有 ${calls.length} 次`);
  return call;
}

describe('SubsonicProvider 认证', () => {
  test('每条请求重新生成 salt,且 token = md5(password + salt)', async () => {
    const calls: Call[] = [];
    const secure = memorySecure();
    // 用官方文档的例子:password=sesame, salt=c19b2d → token=26719a...
    const provider = new SubsonicProvider(
      { fetch: makeFetch(() => envelope({ ping: {} }), calls), secure },
      { sessionKey: 'test' },
    );
    provider._session = {
      providerId: 'subsonic',
      serverUrl: 'http://nas:4533',
      username: 'joe',
      accessToken: 'sesame',
      credentials: { authMode: 'password' },
    };
    await provider.ping();
    await provider.ping();
    const first = queryOf(callAt(calls, 0).url);
    const second = queryOf(callAt(calls, 1).url);

    // 协议固定参数
    expect(first.get('u')).toBe('joe');
    expect(first.get('v')).toBe('1.16.1');
    expect(first.get('c')).toBe('Pomelo');
    expect(first.get('f')).toBe('json');

    // salt 至少 6 位,且两次请求不同
    const saltA = first.get('s') ?? '';
    const saltB = second.get('s') ?? '';
    expect(saltA.length).toBeGreaterThanOrEqual(6);
    expect(saltA).not.toBe(saltB);

    // token 必须随盐一起变,并且是 32 位小写 hex
    expect(first.get('t')).toMatch(/^[0-9a-f]{32}$/);
    expect(first.get('t')).not.toBe(second.get('t'));
  });

  test('API Key 模式发 apiKey,Navidrome 扩展', async () => {
    const calls: Call[] = [];
    const provider = new SubsonicProvider(
      {
        fetch: makeFetch(() => envelope({ ping: {} }), calls),
        secure: memorySecure(),
      },
      { sessionKey: 'test' },
    );
    provider._session = {
      providerId: 'subsonic',
      serverUrl: 'http://nas:4533',
      username: 'joe',
      accessToken: 'my-key',
      credentials: { authMode: 'apiKey', apiKey: 'my-key' },
    };
    await provider.ping();
    const q = queryOf(callAt(calls, 0).url);
    expect(q.get('apiKey')).toBe('my-key');
    expect(q.get('t')).toBeNull();
    expect(q.get('s')).toBeNull();
  });

  test('未连接时抛 provider_auth_required', async () => {
    const provider = new SubsonicProvider(
      { fetch: makeFetch(() => envelope({}), []), secure: memorySecure() },
      { sessionKey: 'test' },
    );
    await expect(provider.ping()).rejects.toThrow(/请先连接音乐服务器/);
  });

  test('登录失败错误码 40 映射为登录失败', async () => {
    const provider = new SubsonicProvider(
      {
        fetch: makeFetch(
          () => ({
            'subsonic-response': {
              status: 'failed',
              error: { code: 40, message: 'Wrong username or password' },
            },
          }),
          [],
        ),
        secure: memorySecure(),
      },
      { sessionKey: 'test' },
    );
    await expect(
      provider.login({
        serverUrl: 'http://nas:4533',
        username: 'joe',
        password: 'bad',
      }),
    ).rejects.toThrow(/用户名或密码错误/);
  });
});

describe('SubsonicProvider 端点选择', () => {
  test('专辑列表走 getAlbumList2 分页,不走不分页的 getArtists', async () => {
    const calls: Call[] = [];
    const provider = new SubsonicProvider(
      {
        fetch: makeFetch(
          () =>
            envelope({
              albumList2: { album: [{ id: 'a1', name: '专辑A' }] },
            }),
          calls,
        ),
        secure: memorySecure(),
      },
      { sessionKey: 'test' },
    );
    provider._session = {
      providerId: 'subsonic',
      serverUrl: 'http://nas:4533',
      username: 'joe',
      accessToken: 'p',
      credentials: { authMode: 'password' },
    };
    const page = await provider.albums({ limit: 50, offset: 100 });
    const url = callAt(calls, 0).url;
    expect(url).toContain('/rest/getAlbumList2');
    expect(url).not.toContain('getArtists');
    const q = queryOf(url);
    expect(q.get('size')).toBe('50');
    expect(q.get('offset')).toBe('100');
    expect(q.get('type')).toBe('alphabeticalByName');
    expect(page.items[0]).toMatchObject({ id: 'a1', name: '专辑A' });
  });

  test('搜索走 search3,且只取歌曲', async () => {
    const calls: Call[] = [];
    const provider = new SubsonicProvider(
      {
        fetch: makeFetch(
          () =>
            envelope({ searchResult3: { song: [{ id: 's1', title: 't' }] } }),
          calls,
        ),
        secure: memorySecure(),
      },
      { sessionKey: 'test' },
    );
    provider._session = {
      providerId: 'subsonic',
      serverUrl: 'http://nas:4533',
      username: 'joe',
      accessToken: 'p',
      credentials: { authMode: 'password' },
    };
    await provider.search('周杰伦', { limit: 20, offset: 0 });
    const url = callAt(calls, 0).url;
    const q = queryOf(url);
    expect(url).toContain('/rest/search3');
    expect(q.get('query')).toBe('周杰伦');
    // 只要歌曲,不要专辑/艺人(它们有各自的列表接口)
    expect(q.get('albumCount')).toBe('0');
    expect(q.get('artistCount')).toBe('0');
  });

  test('空关键词不发请求', async () => {
    const calls: Call[] = [];
    const provider = new SubsonicProvider(
      { fetch: makeFetch(() => envelope({}), calls), secure: memorySecure() },
      { sessionKey: 'test' },
    );
    provider._session = {
      providerId: 'subsonic',
      serverUrl: 'http://nas:4533',
      username: 'joe',
      accessToken: 'p',
      credentials: { authMode: 'password' },
    };
    const page = await provider.search('   ');
    expect(calls).toHaveLength(0);
    expect(page.items).toEqual([]);
  });

  test('歌词优先 getLyricsBySongId(OpenSubsonic)', async () => {
    const calls: Call[] = [];
    const provider = new SubsonicProvider(
      {
        fetch: makeFetch(
          () =>
            envelope({
              openSubsonic: true,
              lyricsList: {
                structuredLyrics: [
                  { synced: true, line: [{ start: 1000, value: '第一句' }] },
                ],
              },
            }),
          calls,
        ),
        secure: memorySecure(),
      },
      { sessionKey: 'test' },
    );
    provider._session = {
      providerId: 'subsonic',
      serverUrl: 'http://nas:4533',
      username: 'joe',
      accessToken: 'p',
      credentials: { authMode: 'password' },
    };
    const lyrics = await provider.lyrics({
      id: 's1',
      title: '晴天',
      artist: '周杰伦',
    });
    expect(callAt(calls, 0).url).toContain('/rest/getLyricsBySongId');
    expect(lyrics?.lrc).toBe('[00:01.00]第一句');
  });

  test('getLyricsBySongId 返回 404 时回退 getLyrics', async () => {
    const calls: Call[] = [];
    let first = true;
    const fetch: ProviderFetch = async (input) => {
      calls.push({ url: input });
      if (first) {
        first = false;
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => envelope({ lyrics: { value: '纯文本' } }),
      } as unknown as Response;
    };
    const provider = new SubsonicProvider(
      { fetch, secure: memorySecure() },
      { sessionKey: 'test' },
    );
    provider._session = {
      providerId: 'subsonic',
      serverUrl: 'http://nas:4533',
      username: 'joe',
      accessToken: 'p',
      credentials: { authMode: 'password' },
    };
    const lyrics = await provider.lyrics({
      id: 's1',
      title: '晴天',
      artist: '周杰伦',
    });
    expect(callAt(calls, 0).url).toContain('getLyricsBySongId');
    expect(callAt(calls, 1).url).toContain('/rest/getLyrics');
    expect(lyrics?.lrc).toBe('纯文本');
  });

  test('歌单列表不传 username(Navidrome 未实现该参数)', async () => {
    const calls: Call[] = [];
    const provider = new SubsonicProvider(
      {
        fetch: makeFetch(
          () => envelope({ playlists: { playlist: [] } }),
          calls,
        ),
        secure: memorySecure(),
      },
      { sessionKey: 'test' },
    );
    provider._session = {
      providerId: 'subsonic',
      serverUrl: 'http://nas:4533',
      username: 'joe',
      accessToken: 'p',
      credentials: { authMode: 'password' },
    };
    await provider.playlists();
    expect(queryOf(callAt(calls, 0).url).get('username')).toBeNull();
  });

  test('stream 把认证参数放进查询串', async () => {
    const provider = new SubsonicProvider(
      { fetch: makeFetch(() => envelope({}), []), secure: memorySecure() },
      { sessionKey: 'test' },
    );
    provider._session = {
      providerId: 'subsonic',
      serverUrl: 'http://nas:4533',
      username: 'joe',
      accessToken: 'secret',
      credentials: { authMode: 'password' },
    };
    const stream = await provider.stream({ id: 's1', title: 't' });
    const q = queryOf(stream.url);
    expect(stream.url).toContain('/rest/stream');
    expect(q.get('id')).toBe('s1');
    expect(q.get('u')).toBe('joe');
    expect(q.get('t')).toMatch(/^[0-9a-f]{32}$/);
    // Subsonic 不需要额外请求头
    expect(stream.headers).toBeUndefined();
  });
});

describe('SubsonicProvider 会话', () => {
  test('restore 读回 secure 里的会话', async () => {
    const secure = memorySecure();
    const provider = new SubsonicProvider(
      { fetch: makeFetch(() => envelope({}), []), secure },
      { sessionKey: 'test' },
    );
    secure.store.set(
      'test',
      JSON.stringify({
        providerId: 'subsonic',
        serverUrl: 'http://nas:4533',
        username: 'joe',
        accessToken: 'p',
        credentials: { authMode: 'apiKey', apiKey: 'k' },
      }),
    );
    const session = await provider.restore();
    expect(session?.serverUrl).toBe('http://nas:4533');
    expect(session?.credentials?.authMode).toBe('apiKey');
  });

  test('损坏的会话被清除', async () => {
    const secure = memorySecure();
    secure.store.set('test', '{not json');
    const provider = new SubsonicProvider(
      { fetch: makeFetch(() => envelope({}), []), secure },
      { sessionKey: 'test' },
    );
    expect(await provider.restore()).toBeNull();
    expect(secure.store.has('test')).toBe(false);
  });
});
