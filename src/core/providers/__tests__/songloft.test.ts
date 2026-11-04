import {
  buildProviderUrl,
  normalizeProviderBaseUrl,
  type ProviderFetch,
  type ProviderSecureStore,
  redactProviderText,
} from '@pomelo/provider-sdk';
import { SongloftProvider } from '@pomelo/provider-songloft';
import { describe, expect, test } from '@rstest/core';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

function memorySecure(): ProviderSecureStore & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}

function fakeFetch(handler: (call: Call) => Response | Promise<Response>): {
  fetch: ProviderFetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined,
      };
      calls.push(call);
      return handler(call);
    },
  };
}

const LOGIN_BODY = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 604800,
  token_type: 'Bearer',
};

const SONG = {
  id: 7,
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  duration: 269,
  cover_url: '/api/v1/songs/7/cover',
  lyric_url: '/api/v1/songs/7/lyric',
  url: '/api/v1/songs/7/play',
  is_video: false,
  is_live: false,
};

describe('provider SDK URL helpers', () => {
  test('归一化地址并去掉误粘贴的 /api/v1', () => {
    expect(normalizeProviderBaseUrl('http://nas.local:58091/api/v1/')).toBe(
      'http://nas.local:58091',
    );
    expect(
      normalizeProviderBaseUrl('https://music.example.com/songloft/'),
    ).toBe('https://music.example.com/songloft');
    expect(() => normalizeProviderBaseUrl('nas.local:58091')).toThrow();
    expect(() => normalizeProviderBaseUrl('http://u:p@nas/')).toThrow();
  });

  test('相对资源补 /api/v1，绝对资源保持原样', () => {
    expect(buildProviderUrl('http://nas:58091', '/songs/7/play')).toBe(
      'http://nas:58091/api/v1/songs/7/play',
    );
    expect(
      buildProviderUrl('http://nas:58091', '/api/v1/songs/7/cover', {
        w: 512,
      }),
    ).toBe('http://nas:58091/api/v1/songs/7/cover?w=512');
    expect(
      buildProviderUrl('http://nas:58091', 'https://cdn.example.com/a.jpg'),
    ).toBe('https://cdn.example.com/a.jpg');
  });

  test('错误与日志文本脱敏', () => {
    const text = redactProviderText(
      'GET /play?access_token=abc Bearer xyz.123 sl_pat_secret eyJhbGciOiJIUzI1NiJ9.payload',
    );
    expect(text).not.toContain('abc');
    expect(text).not.toContain('xyz.123');
    expect(text).not.toContain('sl_pat_secret');
    expect(text).not.toContain('eyJhbGci');
  });
});

describe('SongloftProvider', () => {
  test('登录、搜索、歌单、播放、封面和歌词', async () => {
    const secure = memorySecure();
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.endsWith('/api/v1/auth/login')) return response(LOGIN_BODY);
      if (call.url.includes('/api/v1/songs?')) {
        return response({ songs: [SONG], total: 1 });
      }
      if (call.url.includes('/api/v1/playlists?')) {
        return response({
          playlists: [
            {
              id: 3,
              name: '测试歌单',
              description: '两首歌',
              song_count: 2,
            },
          ],
          total: 1,
        });
      }
      if (call.url.includes('/api/v1/playlists/3/songs')) {
        return response({ songs: [SONG], total: 1 });
      }
      // 专辑是曲库分面维度,不是 /albums 资源端点(真实后端不存在该路径)。
      if (call.url.includes('/api/v1/songs/facets')) {
        return response({
          facets: [
            { value: '叶惠美', count: 4, cover_url: '/api/v1/songs/7/cover' },
            { value: '七里香', count: 3 },
          ],
          total: 2,
        });
      }
      if (call.url.endsWith('/api/v1/songs/7/lyric')) {
        return response({ lyric: '[00:01.00]故事的小黄花' });
      }
      if (call.url.endsWith('/api/v1/songs/7')) {
        return response(SONG);
      }
      if (call.url === 'https://cdn.example.com/external.lrc') {
        return response({ lyric: '[00:02.00]外链歌词' });
      }
      return response({ detail: 'not found' }, 404);
    });
    const provider = new SongloftProvider(
      { fetch, secure, now: () => 1000 },
      { timeoutMs: 1000 },
    );

    const session = await provider.login({
      serverUrl: 'http://nas:58091/api/v1/',
      username: 'admin',
      password: 'admin',
    });
    expect(session.serverUrl).toBe('http://nas:58091');
    expect(session.expiresAt).toBe(604801000);
    expect(secure.values.get('pomelo.provider.songloft.session.v1')).toContain(
      'refresh-1',
    );
    expect(calls[0].url).toBe('http://nas:58091/api/v1/auth/login');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      username: 'admin',
      password: 'admin',
    });

    const search = await provider.search('周杰伦', { limit: 10, offset: 5 });
    expect(search.total).toBe(1);
    expect(search.items[0]).toMatchObject({
      id: '7',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      resource: {
        stream: '/api/v1/songs/7/play',
        artwork: '/api/v1/songs/7/cover',
        lyrics: '/api/v1/songs/7/lyric',
      },
    });
    const searchCall = calls[calls.length - 1];
    expect(searchCall.url).toContain('keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6');
    expect(searchCall.headers.Authorization).toBe('Bearer access-1');

    const playlists = await provider.playlists();
    expect(playlists.items).toEqual([
      {
        id: '3',
        name: '测试歌单',
        description: '两首歌',
        trackCount: 2,
        artwork: undefined,
      },
    ]);

    // 专辑:分面维度映射,专辑名即身份(后端没有专辑 ID)。
    const albums = await provider.albums();
    expect(albums.items).toEqual([
      {
        name: '叶惠美',
        trackCount: 4,
        artwork: '/api/v1/songs/7/cover',
      },
      { name: '七里香', trackCount: 3, artwork: undefined },
    ]);
    const facetCall = calls[calls.length - 1];
    expect(facetCall.url).toContain('/api/v1/songs/facets');
    expect(facetCall.url).toContain('field=album');

    // 专辑详情按专辑名筛选取歌,不再拼 /albums/{id}/songs。
    const albumTracks = await provider.albumTracks('叶惠美', { limit: 200 });
    expect(albumTracks.items[0]?.id).toBe('7');
    const albumTracksCall = calls[calls.length - 1];
    expect(albumTracksCall.url).toContain('/api/v1/songs?');
    expect(albumTracksCall.url).toContain(
      `album=${encodeURIComponent('叶惠美')}`,
    );

    // 封面直接用列表给的 cover_url,不再猜 /albums/{id}/cover。
    const albumCover = await provider.albumArtwork({
      name: '叶惠美',
      artwork: '/api/v1/songs/7/cover',
    });
    expect(albumCover).toContain('/api/v1/songs/7/cover');
    expect(albumCover).toContain('access_token=access-1');
    // 没有封面时返回 null 而不是拼一个不存在的路径。
    expect(await provider.albumArtwork({ name: '七里香' })).toBeNull();

    const tracks = await provider.playlistTracks('3', { limit: 200 });
    expect(tracks.items[0].id).toBe('7');

    const stream = await provider.stream(tracks.items[0]);
    expect(stream.url).toBe('http://nas:58091/api/v1/songs/7/play');
    expect(stream.headers).toEqual({ Authorization: 'Bearer access-1' });
    expect(stream.isVideo).toBe(false);

    const artwork = await provider.artwork(tracks.items[0], 256);
    expect(artwork).toBe(
      'http://nas:58091/api/v1/songs/7/cover?w=256&access_token=access-1',
    );

    const lyrics = await provider.lyrics(tracks.items[0]);
    expect(lyrics?.lrc).toBe('[00:01.00]故事的小黄花');

    const one = await provider.getTrack('7');
    expect(one?.title).toBe('晴天');
    expect(one?.resource?.stream).toBe('/api/v1/songs/7/play');

    await provider.search('', {
      sort: 'added_at',
      order: 'desc',
      limit: 10,
    });
    expect(calls[calls.length - 1].url).toContain('sort=added_at');
    expect(calls[calls.length - 1].url).toContain('order=desc');

    const externalLyrics = await provider.lyrics({
      id: 'external',
      title: '外链歌词',
      resource: { lyrics: 'https://cdn.example.com/external.lrc' },
    });
    expect(externalLyrics?.lrc).toBe('[00:02.00]外链歌词');
    expect(calls[calls.length - 1].headers.Authorization).toBeUndefined();
  });

  test('401 后刷新 token 并重放原请求', async () => {
    const secure = memorySecure();
    let songsCalls = 0;
    const { fetch } = fakeFetch((call) => {
      if (call.url.endsWith('/api/v1/auth/login')) return response(LOGIN_BODY);
      if (call.url.endsWith('/api/v1/auth/refresh')) {
        return response({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 604800,
        });
      }
      if (call.url.includes('/api/v1/songs')) {
        songsCalls += 1;
        if (songsCalls === 1) return response({ detail: 'expired' }, 401);
        return response({ songs: [SONG], total: 1 });
      }
      return response({}, 404);
    });
    const provider = new SongloftProvider(
      { fetch, secure, now: () => 1000 },
      { timeoutMs: 1000 },
    );

    await provider.login({
      serverUrl: 'http://nas:58091',
      username: 'admin',
      password: 'admin',
    });
    const page = await provider.search('', { limit: 5 });
    expect(page.items).toHaveLength(1);
    expect(songsCalls).toBe(2);
    expect(provider.session?.accessToken).toBe('access-2');
    expect(provider.session?.refreshToken).toBe('refresh-2');
  });

  test('refresh 强制刷新 token，供原生 401 后调用', async () => {
    const secure = memorySecure();
    let refreshCalls = 0;
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.endsWith('/api/v1/auth/login')) return response(LOGIN_BODY);
      if (call.url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls += 1;
        return response({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 604800,
        });
      }
      return response({}, 404);
    });
    const provider = new SongloftProvider(
      { fetch, secure, now: () => 1000 },
      { timeoutMs: 1000 },
    );
    await provider.login({
      serverUrl: 'http://nas:58091',
      username: 'admin',
      password: 'admin',
    });

    await provider.refresh();
    expect(refreshCalls).toBe(1);
    expect(provider.session?.accessToken).toBe('access-2');
    expect(provider.session?.refreshToken).toBe('refresh-2');
    expect(calls[calls.length - 1].headers.Authorization).toBeUndefined();
    expect(secure.values.get('pomelo.provider.songloft.session.v1')).toContain(
      'access-2',
    );
  });

  test('恢复会话并在登出时清除 secure 存储', async () => {
    const secure = memorySecure();
    const { fetch } = fakeFetch((call) => {
      if (call.url.endsWith('/api/v1/auth/login')) return response(LOGIN_BODY);
      if (call.url.endsWith('/api/v1/auth/logout')) return response(undefined);
      return response({}, 404);
    });
    const provider = new SongloftProvider(
      { fetch, secure, now: () => 1000 },
      { timeoutMs: 1000 },
    );
    await provider.login({
      serverUrl: 'http://nas:58091',
      username: 'admin',
      password: 'admin',
    });

    const restored = new SongloftProvider(
      { fetch, secure, now: () => 1000 },
      { timeoutMs: 1000 },
    );
    const session = await restored.restore();
    expect(session?.username).toBe('admin');
    expect(session?.accessToken).toBe('access-1');

    await restored.logout();
    expect(secure.values.size).toBe(0);
    expect(restored.session).toBeNull();
  });

  test('登录失败不泄漏服务端返回里的 token', async () => {
    const secure = memorySecure();
    const { fetch } = fakeFetch(() =>
      response(
        {
          error: 'unauthorized',
          detail: 'bad access_token=leaked-token',
        },
        401,
      ),
    );
    const provider = new SongloftProvider(
      { fetch, secure, now: () => 1000 },
      { timeoutMs: 1000 },
    );
    await expect(
      provider.login({
        serverUrl: 'http://nas:58091',
        username: 'admin',
        password: 'wrong',
      }),
    ).rejects.toMatchObject({ code: 'provider_login_failed' });
    try {
      await provider.login({
        serverUrl: 'http://nas:58091',
        username: 'admin',
        password: 'wrong',
      });
    } catch (error) {
      expect((error as { detail?: string }).detail).not.toContain(
        'leaked-token',
      );
    }
  });
});
