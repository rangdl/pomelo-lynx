import { createHash } from 'node:crypto';

import type { ProviderFetch, ProviderSecureStore } from '@pomelo/provider-sdk';
import { describe, expect, test } from '@rstest/core';

import { FnMusicProvider } from '../provider.js';

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

function makeFetch(
  routes: (url: string) => unknown,
  calls: Call[],
): ProviderFetch {
  return async (input, init) => {
    calls.push({ url: input, init });
    return {
      ok: true,
      status: 200,
      json: async () => routes(input),
    } as unknown as Response;
  };
}

function envelope(data: unknown) {
  return { code: 0, msg: 'ok', data };
}

function headersOf(call: Call): Record<string, string> {
  return (call.init?.headers ?? {}) as Record<string, string>;
}

function queryOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

function callAt(calls: Call[], index: number): Call {
  const call = calls[index];
  if (!call) throw new Error(`期望第 ${index} 次请求,实际 ${calls.length} 次`);
  return call;
}

/** 建一个已登录的 provider(跳过 login,直接注入会话)。 */
function loggedIn(
  routes: (url: string) => unknown,
  calls: Call[],
  secure = memorySecure(),
) {
  const provider = new FnMusicProvider(
    { fetch: makeFetch(routes, calls), secure },
    {
      sessionKey: 'test',
    },
  );
  provider._session = {
    providerId: 'fnmusic',
    serverUrl: 'http://nas:5666',
    username: 'joe',
    accessToken: 'user-token-1',
    credentials: { deviceId: 'dev-1', userToken: 'user-token-1' },
  };
  return provider;
}

describe('FnMusicProvider 登录', () => {
  test('密码以 sha256 发送,并保存 userToken 与 deviceId', async () => {
    const calls: Call[] = [];
    const secure = memorySecure();
    const provider = new FnMusicProvider(
      {
        fetch: makeFetch((url) => {
          expect(url).toContain('/music/api/v1/user/password-login');
          return envelope({ userToken: 'tok-abc' });
        }, calls),
        secure,
      },
      { sessionKey: 'test' },
    );
    const session = await provider.login({
      serverUrl: 'http://nas:5666',
      username: 'joe',
      password: 'secret',
    });

    const body = JSON.parse(String(callAt(calls, 0).init?.body)) as Record<
      string,
      string
    >;
    // 关键:发出去的是 sha256(明文),不是明文
    expect(body.password).toBe(
      createHash('sha256').update('secret').digest('hex'),
    );
    expect(body.username).toBe('joe');
    expect(body.deviceId).toBeTruthy();

    expect(session.accessToken).toBe('tok-abc');
    expect(session.credentials?.deviceId).toBeTruthy();
    expect(secure.store.has('test')).toBe(true);
  });

  test('登录请求本身带 authx 但不需要 token', async () => {
    const calls: Call[] = [];
    const provider = new FnMusicProvider(
      {
        fetch: makeFetch(() => envelope({ userToken: 't' }), calls),
        secure: memorySecure(),
      },
      { sessionKey: 'test' },
    );
    await provider.login({
      serverUrl: 'http://nas:5666',
      username: 'joe',
      password: 'p',
    });
    const headers = headersOf(callAt(calls, 0));
    expect(headers.authx).toMatch(/nonce=.*timestamp=.*sign=/);
    // 登录时还没有 token,不应带 Cookie
    expect(headers.Cookie).toBeUndefined();
  });

  test('缺少 userToken 时报格式异常', async () => {
    const provider = new FnMusicProvider(
      { fetch: makeFetch(() => envelope({}), []), secure: memorySecure() },
      { sessionKey: 'test' },
    );
    await expect(
      provider.login({
        serverUrl: 'http://nas:5666',
        username: 'joe',
        password: 'p',
      }),
    ).rejects.toThrow(/userToken/);
  });

  test('地址已带 /music 时不会重复拼前缀', async () => {
    const calls: Call[] = [];
    const provider = new FnMusicProvider(
      {
        fetch: makeFetch(() => envelope({ userToken: 't' }), calls),
        secure: memorySecure(),
      },
      { sessionKey: 'test' },
    );
    await provider.login({
      serverUrl: 'http://nas:5666/music',
      username: 'joe',
      password: 'p',
    });
    expect(callAt(calls, 0).url).toContain('/music/api/v1/user/password-login');
    expect(callAt(calls, 0).url).not.toContain('/music/api/v1/music');
  });
});

describe('FnMusicProvider 请求签名', () => {
  test('每个请求都带 authx 与 music-token Cookie', async () => {
    const calls: Call[] = [];
    const provider = loggedIn(() => envelope({ list: [], total: 0 }), calls);
    await provider.playlists();
    const headers = headersOf(callAt(calls, 0));
    expect(headers.authx).toMatch(
      /^nonce=\d+&timestamp=\d+&sign=[0-9a-f]{32}$/,
    );
    expect(headers.Cookie).toContain('music-token=user-token-1');
  });

  test('两次请求的签名不同(时间戳/nonce 逐请求重算)', async () => {
    const calls: Call[] = [];
    const provider = loggedIn(() => envelope({ list: [], total: 0 }), calls);
    await provider.playlists();
    await provider.playlists();
    const first = headersOf(callAt(calls, 0)).authx;
    const second = headersOf(callAt(calls, 1)).authx;
    expect(first).not.toBe(second);
  });

  test('查询串按 key 排序(签名要求)', async () => {
    const calls: Call[] = [];
    const provider = loggedIn(() => envelope({ list: [], total: 0 }), calls);
    await provider.search('周杰伦', { limit: 20, offset: 0 });
    const q = [...queryOf(callAt(calls, 0).url).entries()].map(([k]) => k);
    expect(q).toEqual([...q].sort());
  });
});

describe('FnMusicProvider 端点', () => {
  test('搜索走 /search/track,用 page/size 分页', async () => {
    const calls: Call[] = [];
    const provider = loggedIn(() => envelope({ list: [], total: 0 }), calls);
    await provider.search('周杰伦', { limit: 20, offset: 40 });
    const url = callAt(calls, 0).url;
    expect(url).toContain('/search/track');
    const q = queryOf(url);
    expect(q.get('keyword')).toBe('周杰伦');
    expect(q.get('size')).toBe('20');
    // offset 40 / size 20 → page 3
    expect(q.get('page')).toBe('3');
  });

  test('歌单曲目走 /track/playlist-detail/list', async () => {
    const calls: Call[] = [];
    const provider = loggedIn(() => envelope({ list: [], total: 0 }), calls);
    await provider.playlistTracks('p1');
    expect(callAt(calls, 0).url).toContain('/track/playlist-detail/list');
    expect(queryOf(callAt(calls, 0).url).get('guid')).toBe('p1');
  });

  test('专辑从曲目列表的 album 对象聚合', async () => {
    const calls: Call[] = [];
    const provider = loggedIn(
      () =>
        envelope({
          list: [
            { guid: 's1', title: 'a', album: { guid: 'al1', name: '专辑A' } },
            { guid: 's2', title: 'b', album: { guid: 'al1', name: '专辑A' } },
          ],
          total: 2,
        }),
      calls,
    );
    const page = await provider.albums();
    // 两首歌属于同一专辑,去重后只有一条
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: 'al1', name: '专辑A' });
  });

  test('歌词走 /lyric/list', async () => {
    const calls: Call[] = [];
    const provider = loggedIn(() => envelope({ lyric: '[00:01.00]hi' }), calls);
    const lyrics = await provider.lyrics({ id: 'g1', title: 't' });
    expect(callAt(calls, 0).url).toContain('/lyric/list');
    expect(lyrics?.lrc).toBe('[00:01.00]hi');
  });
});

describe('FnMusicProvider 播放', () => {
  test('stream 把 authx 与 Cookie 放进 headers', async () => {
    const provider = loggedIn(() => envelope({}), []);
    const stream = await provider.stream({ id: 'g1', title: 't' });
    expect(stream.url).toContain('/track/stream');
    expect(queryOf(stream.url).get('guid')).toBe('g1');
    expect(stream.headers?.authx).toMatch(/sign=/);
    expect(stream.headers?.Cookie).toContain('music-token=');
  });

  test('未登录时 stream 抛 auth_required', async () => {
    const provider = new FnMusicProvider(
      { fetch: makeFetch(() => envelope({}), []), secure: memorySecure() },
      { sessionKey: 'test' },
    );
    await expect(provider.stream({ id: 'g', title: 't' })).rejects.toThrow(
      /请先连接音乐服务器/,
    );
  });
});

describe('FnMusicProvider 会话', () => {
  test('restore 读回 userToken 与 deviceId', async () => {
    const secure = memorySecure();
    secure.store.set(
      'test',
      JSON.stringify({
        providerId: 'fnmusic',
        serverUrl: 'http://nas:5666',
        username: 'joe',
        accessToken: 'tok',
        credentials: { deviceId: 'dev-9', userToken: 'tok' },
      }),
    );
    const provider = new FnMusicProvider(
      { fetch: makeFetch(() => envelope({}), []), secure },
      { sessionKey: 'test' },
    );
    const session = await provider.restore();
    expect(session?.credentials?.deviceId).toBe('dev-9');
    expect(session?.accessToken).toBe('tok');
  });

  test('损坏的会话被清除', async () => {
    const secure = memorySecure();
    secure.store.set('test', 'not-json');
    const provider = new FnMusicProvider(
      { fetch: makeFetch(() => envelope({}), []), secure },
      { sessionKey: 'test' },
    );
    expect(await provider.restore()).toBeNull();
    expect(secure.store.has('test')).toBe(false);
  });
});
