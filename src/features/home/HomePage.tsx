import { useEffect, useState } from '@lynx-js/react';
import type {
  ProviderPage,
  ProviderPlaylist,
  ProviderTrack,
} from '@pomelo/provider-sdk';
import { useNavigate } from '@tanstack/react-router';

import {
  currentMediaSettings,
  loadMediaSettings,
} from '../../core/media/settings.js';
import {
  enqueueProviderTracks,
  getSongloftProvider,
  playProviderTrack,
  playProviderTracks,
  providerErrorMessage,
  restoreSongloft,
} from '../../core/providers/index.js';
import {
  PageLargeTitle,
  PageTail,
} from '../../shared/layouts/SettingsSubPage.js';
import { Button } from '../../shared/ui/Button.js';
import { Hint } from '../../shared/ui/Hint.js';
import { MediaCard } from '../../shared/ui/MediaCard.js';
import { TextField } from '../../shared/ui/TextField.js';
import { SongRow } from './SongRow.js';
import './HomePage.css';

const PLAYLIST_PAGE_SIZE = 20;
const SHELF_LIMIT = 12;

type SongSource =
  | { kind: 'recent' }
  | { kind: 'playlist'; playlist: ProviderPlaylist }
  | { kind: 'search'; query: string };

function greetingText(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

async function fetchSongPage(
  source: SongSource,
  offset: number,
  pageSize: number,
): Promise<ProviderPage<ProviderTrack>> {
  const provider = getSongloftProvider();
  if (source.kind === 'recent') {
    return provider.search('', {
      sort: 'added_at',
      order: 'desc',
      limit: pageSize,
      offset,
    });
  }
  if (source.kind === 'playlist') {
    return provider.playlistTracks(source.playlist.id, {
      limit: pageSize,
      offset,
    });
  }
  return provider.search(source.query, {
    limit: pageSize,
    offset,
  });
}

async function trackArtwork(
  tracks: readonly ProviderTrack[],
): Promise<Record<string, string>> {
  const provider = getSongloftProvider();
  const entries = await Promise.all(
    tracks.map(async (track) => {
      try {
        const artwork = await provider.artwork(track, 256);
        return [track.id, artwork ?? ''] as const;
      } catch {
        return [track.id, ''] as const;
      }
    }),
  );
  return Object.fromEntries(entries.filter(([, value]) => value));
}

async function loadPlaylistArtwork(
  playlists: readonly ProviderPlaylist[],
): Promise<Record<string, string>> {
  const provider = getSongloftProvider();
  if (typeof provider.playlistArtwork !== 'function') return {};
  const entries = await Promise.all(
    playlists.map(async (playlist) => {
      try {
        const artwork = await provider.playlistArtwork?.(playlist, 256);
        return [playlist.id, artwork ?? ''] as const;
      } catch {
        return [playlist.id, ''] as const;
      }
    }),
  );
  return Object.fromEntries(entries.filter(([, value]) => value));
}

/**
 * 首页音乐库：问候标题、搜索、最近添加/歌单封面卡片架，以及可展开的歌曲列表。
 * 结构参考 Spotify/Apple Music 与 Songloft 官方 Lynx 首页。
 */
export function HomePage() {
  const navigate = useNavigate();
  const [greeting] = useState(greetingText);
  const [connected, setConnected] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recent, setRecent] = useState<ProviderTrack[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentArtwork, setRecentArtwork] = useState<Record<string, string>>(
    {},
  );
  const [playlists, setPlaylists] = useState<ProviderPlaylist[]>([]);
  const [playlistsTotal, setPlaylistsTotal] = useState(0);
  const [playlistCovers, setPlaylistCovers] = useState<Record<string, string>>(
    {},
  );
  const [songs, setSongs] = useState<ProviderTrack[]>([]);
  const [songsTotal, setSongsTotal] = useState(0);
  const [songArtwork, setSongArtwork] = useState<Record<string, string>>({});
  const [source, setSource] = useState<SongSource>({ kind: 'recent' });
  const [listTitle, setListTitle] = useState('最近添加');
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await loadMediaSettings();
        const session = await restoreSongloft();
        if (!alive) return;
        if (!session) {
          setRestoring(false);
          return;
        }
        setConnected(true);
        const provider = getSongloftProvider();
        const pageSize = currentMediaSettings().pageSize;
        const [recentPage, playlistPage] = await Promise.all([
          fetchSongPage({ kind: 'recent' }, 0, pageSize),
          provider.playlists({ limit: PLAYLIST_PAGE_SIZE, offset: 0 }),
        ]);
        const [recentCovers, playlistCovers] = await Promise.all([
          trackArtwork(recentPage.items),
          loadPlaylistArtwork(playlistPage.items),
        ]);
        if (!alive) return;
        setRecent(recentPage.items);
        setRecentTotal(recentPage.total);
        setRecentArtwork(recentCovers);
        setPlaylists(playlistPage.items);
        setPlaylistsTotal(playlistPage.total);
        setPlaylistCovers(playlistCovers);
      } catch (cause) {
        if (alive) setError(providerErrorMessage(cause));
      } finally {
        if (alive) setRestoring(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadMorePlaylists = async () => {
    'background only';
    if (busy || !connected || playlists.length >= playlistsTotal) return;
    setBusy('more-playlists');
    setError('');
    try {
      const page = await getSongloftProvider().playlists({
        limit: PLAYLIST_PAGE_SIZE,
        offset: playlists.length,
      });
      const covers = await loadPlaylistArtwork(page.items);
      setPlaylists((items) => [...items, ...page.items]);
      setPlaylistsTotal(page.total);
      setPlaylistCovers((art) => ({ ...art, ...covers }));
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const openRecentAll = () => {
    'background only';
    setSource({ kind: 'recent' });
    setListTitle('最近添加');
    setSongs(recent);
    setSongsTotal(recentTotal);
    setSongArtwork(recentArtwork);
    setListOpen(true);
  };

  const openPlaylist = async (playlist: ProviderPlaylist) => {
    'background only';
    if (busy || !connected) return;
    setBusy('tracks');
    setError('');
    setNotice('');
    try {
      const page = await getSongloftProvider().playlistTracks(playlist.id, {
        limit: currentMediaSettings().pageSize,
        offset: 0,
      });
      const covers = await trackArtwork(page.items);
      setSource({ kind: 'playlist', playlist });
      setListTitle(playlist.name);
      setSongs(page.items);
      setSongsTotal(page.total);
      setSongArtwork(covers);
      setListOpen(true);
      if (!page.items.length) setNotice('这个歌单还没有歌曲');
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const search = async () => {
    'background only';
    if (busy || !connected) return;
    const keyword = query.trim();
    if (!keyword) {
      setError('请输入搜索关键词');
      return;
    }
    setBusy('search');
    setError('');
    setNotice('');
    try {
      const page = await getSongloftProvider().search(keyword, {
        limit: currentMediaSettings().pageSize,
        offset: 0,
      });
      const covers = await trackArtwork(page.items);
      setSource({ kind: 'search', query: keyword });
      setListTitle(`搜索「${keyword}」`);
      setSongs(page.items);
      setSongsTotal(page.total);
      setSongArtwork(covers);
      setListOpen(true);
      if (!page.items.length) setNotice('没有找到歌曲');
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const loadMoreSongs = async () => {
    'background only';
    if (busy || !connected || songs.length >= songsTotal) return;
    setBusy('more-songs');
    setError('');
    try {
      const page = await fetchSongPage(
        source,
        songs.length,
        currentMediaSettings().pageSize,
      );
      const covers = await trackArtwork(page.items);
      setSongs((items) => [...items, ...page.items]);
      setSongsTotal(page.total);
      setSongArtwork((art) => ({ ...art, ...covers }));
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const playTrack = async (track: ProviderTrack) => {
    'background only';
    if (busy || !connected) return;
    setBusy(`play-${track.id}`);
    setError('');
    setNotice('');
    try {
      await playProviderTrack(getSongloftProvider(), track);
      setNotice(`正在播放：${track.title}`);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const addTrack = async (track: ProviderTrack) => {
    'background only';
    if (busy || !connected) return;
    setBusy(`add-${track.id}`);
    setError('');
    setNotice('');
    try {
      await enqueueProviderTracks(getSongloftProvider(), [track]);
      setNotice(`已加入队列：${track.title}`);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const playAll = async () => {
    'background only';
    if (busy || !connected || !songs.length) return;
    setBusy('play-all');
    setError('');
    setNotice('');
    try {
      const count = await playProviderTracks(getSongloftProvider(), songs);
      setNotice(`已开始播放 ${count} 首歌曲`);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const addAll = async () => {
    'background only';
    if (busy || !connected || !songs.length) return;
    setBusy('add-all');
    setError('');
    setNotice('');
    try {
      const count = await enqueueProviderTracks(getSongloftProvider(), songs);
      setNotice(`已加入队列 ${count} 首歌曲`);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const listSubtitle = (track: ProviderTrack): string =>
    [track.artist, track.album].filter(Boolean).join(' · ') || '未知歌手';

  return (
    <view className="home" data-testid="home-page">
      <PageLargeTitle title={greeting} />
      <scroll-view
        className="settings__scroll"
        scroll-orientation="vertical"
        data-testid="home-scroll"
      >
        <view className="home__subhead">
          <view className="home__source">
            <text className="home__source-title">Songloft</text>
            <text className="home__source-detail">
              {connected
                ? `${recentTotal} 首歌曲 · ${playlistsTotal} 个歌单`
                : restoring
                  ? '正在恢复连接…'
                  : '连接你的音乐库'}
            </text>
          </view>
          <Button
            variant="text"
            label={connected ? '设置' : '连接'}
            stopPropagation
            onTap={() => navigate({ to: '/settings/sources' })}
            testid="home-source-settings"
          />
        </view>

        {restoring ? <Hint tone="caption">正在加载音乐库…</Hint> : null}
        {error ? (
          <Hint tone="error" testid="home-error">
            {error}
          </Hint>
        ) : null}
        {notice ? (
          <Hint tone="muted" testid="home-notice">
            {notice}
          </Hint>
        ) : null}

        {!connected && !restoring ? (
          <view className="home__empty" data-testid="home-connect-empty">
            <view className="home__empty-icon">
              <text className="home__empty-glyph">♫</text>
            </view>
            <text className="home__empty-title">连接你的音乐库</text>
            <text className="home__empty-detail">
              在设置里填写 Songloft 地址、用户名和密码
            </text>
            <Button
              label="去连接"
              onTap={() => navigate({ to: '/settings/sources' })}
              testid="home-connect"
            />
          </view>
        ) : null}

        {connected ? (
          <>
            <view className="home__search">
              <TextField
                variant="search"
                value={query}
                onChange={setQuery}
                onConfirm={search}
                placeholder="搜索歌曲、歌手或专辑"
                disabled={busy !== ''}
                testid="home-search-input"
              />
            </view>

            {recent.length ? (
              <view className="home-shelf" data-testid="home-recent-shelf">
                <view className="home-shelf__header">
                  <text className="home-shelf__title">最近添加</text>
                  <Button
                    variant="text"
                    label="查看全部"
                    onTap={openRecentAll}
                    testid="home-recent-all"
                  />
                </view>
                <scroll-view
                  className="home-shelf__scroll"
                  scroll-orientation="horizontal"
                  enable-nested-scroll={true}
                  data-testid="home-recent-scroll"
                >
                  <view className="home-shelf__row">
                    {recent.slice(0, SHELF_LIMIT).map((track, index) => (
                      <MediaCard
                        key={track.id}
                        artwork={recentArtwork[track.id]}
                        title={track.title}
                        subtitle={track.artist || '未知歌手'}
                        onTap={() => playTrack(track)}
                        testid={`home-recent-${index}`}
                      />
                    ))}
                  </view>
                </scroll-view>
              </view>
            ) : null}

            {playlists.length ? (
              <view className="home-shelf" data-testid="home-playlists-shelf">
                <view className="home-shelf__header">
                  <text className="home-shelf__title">歌单</text>
                  {playlists.length < playlistsTotal ? (
                    <Button
                      variant="text"
                      label={busy === 'more-playlists' ? '加载中…' : '加载更多'}
                      disabled={busy !== ''}
                      onTap={loadMorePlaylists}
                      testid="home-more-playlists"
                    />
                  ) : null}
                </view>
                <scroll-view
                  className="home-shelf__scroll"
                  scroll-orientation="horizontal"
                  enable-nested-scroll={true}
                  data-testid="home-playlists-scroll"
                >
                  <view className="home-shelf__row">
                    {playlists.map((playlist, index) => (
                      <MediaCard
                        key={playlist.id}
                        artwork={playlistCovers[playlist.id]}
                        title={playlist.name}
                        subtitle={`${playlist.trackCount} 首`}
                        onTap={() => openPlaylist(playlist)}
                        testid={`home-playlist-${index}`}
                      />
                    ))}
                  </view>
                </scroll-view>
              </view>
            ) : null}

            {!recent.length && !playlists.length ? (
              <Hint tone="caption">音乐库还没有歌曲或歌单。</Hint>
            ) : null}

            {listOpen ? (
              <view className="home-list" data-testid="home-song-list">
                <view className="home-list__header">
                  <text className="home-list__title">{listTitle}</text>
                  <Button
                    variant="text"
                    label="收起"
                    onTap={() => setListOpen(false)}
                    testid="home-list-close"
                  />
                </view>
                <view className="home-list__actions">
                  <Button
                    grow
                    label={busy === 'play-all' ? '加载中…' : '播放已加载'}
                    disabled={busy !== '' || !songs.length}
                    onTap={playAll}
                    testid="home-play-all"
                  />
                  <Button
                    grow
                    variant="secondary"
                    label={busy === 'add-all' ? '加入中…' : '已加载加入队列'}
                    disabled={busy !== '' || !songs.length}
                    onTap={addAll}
                    testid="home-add-all"
                  />
                </view>
                {songs.map((track, index) => (
                  <SongRow
                    key={track.id}
                    artwork={songArtwork[track.id]}
                    title={track.title}
                    subtitle={listSubtitle(track)}
                    busy={busy === `add-${track.id}`}
                    onTap={() => playTrack(track)}
                    onAdd={() => addTrack(track)}
                    testid={`home-track-${index}`}
                  />
                ))}
                {songs.length < songsTotal ? (
                  <view className="home__load-row">
                    <Button
                      grow
                      variant="secondary"
                      label={busy === 'more-songs' ? '加载中…' : '加载更多歌曲'}
                      disabled={busy !== ''}
                      onTap={loadMoreSongs}
                      testid="home-more-songs"
                    />
                  </view>
                ) : null}
              </view>
            ) : null}
          </>
        ) : null}

        <PageTail />
      </scroll-view>
    </view>
  );
}
