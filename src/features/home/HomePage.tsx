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
import { ListRow } from '../../shared/ui/ListRow.js';
import {
  SettingsGroup,
  SettingsGroupDivider,
} from '../../shared/ui/SettingsGroup.js';
import { TextField } from '../../shared/ui/TextField.js';
import './HomePage.css';

const PLAYLIST_PAGE_SIZE = 20;

type SongSource =
  | { kind: 'recent' }
  | { kind: 'playlist'; playlist: ProviderPlaylist }
  | { kind: 'search'; query: string };

function sourceTitle(source: SongSource): string {
  if (source.kind === 'recent') return '最近添加';
  if (source.kind === 'playlist') return source.playlist.name;
  return `搜索「${source.query}」`;
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

/**
 * 首页音乐库：最近添加、歌单、搜索与直接播放。
 * 连接配置仍在「设置 → 媒体 → 音乐源」。
 */
export function HomePage() {
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [songs, setSongs] = useState<ProviderTrack[]>([]);
  const [songsTotal, setSongsTotal] = useState(0);
  const [songSource, setSongSource] = useState<SongSource>({ kind: 'recent' });
  const [playlists, setPlaylists] = useState<ProviderPlaylist[]>([]);
  const [playlistsTotal, setPlaylistsTotal] = useState(0);
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
        const [songPage, playlistPage] = await Promise.all([
          fetchSongPage({ kind: 'recent' }, 0, currentMediaSettings().pageSize),
          provider.playlists({ limit: PLAYLIST_PAGE_SIZE, offset: 0 }),
        ]);
        if (!alive) return;
        setSongs(songPage.items);
        setSongsTotal(songPage.total);
        setPlaylists(playlistPage.items);
        setPlaylistsTotal(playlistPage.total);
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

  const loadSource = async (source: SongSource) => {
    'background only';
    if (busy || !connected) return;
    setBusy('songs');
    setError('');
    setNotice('');
    try {
      const page = await fetchSongPage(
        source,
        0,
        currentMediaSettings().pageSize,
      );
      setSongSource(source);
      setSongs(page.items);
      setSongsTotal(page.total);
      if (!page.items.length) setNotice('这里还没有歌曲');
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
        songSource,
        songs.length,
        currentMediaSettings().pageSize,
      );
      setSongs((items) => [...items, ...page.items]);
      setSongsTotal(page.total);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

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
      setPlaylists((items) => [...items, ...page.items]);
      setPlaylistsTotal(page.total);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const search = async () => {
    'background only';
    const keyword = query.trim();
    if (!keyword) {
      setError('请输入搜索关键词');
      return;
    }
    await loadSource({ kind: 'search', query: keyword });
  };

  const openPlaylist = async (playlist: ProviderPlaylist) => {
    'background only';
    await loadSource({ kind: 'playlist', playlist });
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

  return (
    <view className="home" data-testid="home-page">
      <PageLargeTitle title="音乐" />
      <scroll-view
        className="settings__scroll"
        scroll-orientation="vertical"
        data-testid="home-scroll"
      >
        <SettingsGroup title="Songloft">
          <ListRow
            iconGlyph="♫"
            iconTone={connected ? 'green' : 'gray'}
            label="音乐源"
            value={connected ? '已连接' : restoring ? '恢复中' : '未连接'}
            detail={
              connected
                ? '最近添加、歌单和搜索'
                : '连接 Songloft 后在这里浏览音乐'
            }
            trailing={
              <Button
                variant="text"
                label={connected ? '设置' : '去连接'}
                stopPropagation
                onTap={() => navigate({ to: '/settings/sources' })}
                testid="home-source-settings"
              />
            }
            testid="home-source-status"
          />
          {!connected && !restoring ? (
            <Hint tone="caption" testid="home-connect-hint">
              音乐源地址、账号和密码在设置页配置。
            </Hint>
          ) : null}
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
        </SettingsGroup>

        {connected ? (
          <SettingsGroup title="搜索">
            <view className="home__form">
              <TextField
                label="关键词"
                value={query}
                onChange={setQuery}
                onConfirm={search}
                placeholder="歌名、歌手或专辑"
                disabled={busy !== ''}
                testid="home-search-input"
              />
            </view>
            <view className="home__actions">
              <Button
                grow
                variant="secondary"
                label={busy === 'songs' ? '搜索中…' : '搜索'}
                disabled={busy !== '' || !query.trim()}
                onTap={search}
                testid="home-search"
              />
            </view>
          </SettingsGroup>
        ) : null}

        {connected ? (
          <SettingsGroup title="歌单">
            {playlists.length ? (
              playlists.map((playlist, index) => (
                <ListRow
                  key={playlist.id}
                  iconGlyph="♫"
                  iconTone="indigo"
                  label={playlist.name}
                  detail={playlist.description || '打开歌单'}
                  value={`${playlist.trackCount} 首`}
                  chevron
                  onTap={() => openPlaylist(playlist)}
                  testid={`home-playlist-${index}`}
                />
              ))
            ) : (
              <Hint tone="caption">没有歌单。</Hint>
            )}
            {playlists.length < playlistsTotal ? (
              <view className="home__actions">
                <Button
                  grow
                  variant="secondary"
                  label={busy === 'more-playlists' ? '加载中…' : '加载更多歌单'}
                  disabled={busy !== ''}
                  onTap={loadMorePlaylists}
                  testid="home-more-playlists"
                />
              </view>
            ) : null}
          </SettingsGroup>
        ) : null}

        {connected && (songsTotal > 0 || songSource.kind !== 'recent') ? (
          <SettingsGroup title={sourceTitle(songSource)}>
            {songSource.kind !== 'recent' ? (
              <>
                <ListRow
                  iconGlyph="↩"
                  iconTone="gray"
                  label="返回最近添加"
                  onTap={() => loadSource({ kind: 'recent' })}
                  testid="home-back-recent"
                />
                <SettingsGroupDivider />
              </>
            ) : null}
            <view className="home__actions">
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
              <ListRow
                key={track.id}
                iconGlyph={track.isVideo ? '▣' : '♪'}
                iconTone={track.isVideo ? 'violet' : 'indigo'}
                label={track.title}
                detail={
                  [track.artist, track.album].filter(Boolean).join(' · ') ||
                  '未知歌手'
                }
                onTap={() => playTrack(track)}
                trailing={
                  <Button
                    variant="text"
                    label={busy === `add-${track.id}` ? '…' : '加入'}
                    stopPropagation
                    disabled={busy !== ''}
                    onTap={() => addTrack(track)}
                    testid={`home-add-${index}`}
                  />
                }
                testid={`home-track-${index}`}
              />
            ))}
            {songs.length < songsTotal ? (
              <view className="home__actions">
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
          </SettingsGroup>
        ) : null}

        {connected && songsTotal === 0 && !busy ? (
          <Hint tone="caption">最近没有歌曲。</Hint>
        ) : null}

        <PageTail />
      </scroll-view>
    </view>
  );
}
