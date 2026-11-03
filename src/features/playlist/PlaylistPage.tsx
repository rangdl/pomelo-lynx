import { useEffect, useState } from '@lynx-js/react';
import type { ProviderTrack } from '@pomelo/provider-sdk';
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
  trackArtworks,
} from '../../core/providers/index.js';
import { getCurrentPlaylist } from '../../core/providers/selection.js';
import { ROUTE_PATHS } from '../../routes.js';
import { SettingsSubPage } from '../../shared/layouts/SettingsSubPage.js';
import { Button } from '../../shared/ui/Button.js';
import { Hint } from '../../shared/ui/Hint.js';
import { SongRow } from '../../shared/ui/SongRow.js';
import './PlaylistPage.css';

/**
 * 歌单详情页(/playlist):列表 + 播放全部 / 加入队列。
 *
 * 目标歌单由 `core/providers/selection` 在跳转前写入(路由是静态的,
 * id 不进 URL)。骨架遵守 docs/page-design.md 的子页约束,行复用共享
 * `SongRow`,不在这里另写一套歌曲行样式。
 */
export function PlaylistPage() {
  const navigate = useNavigate();
  const playlist = getCurrentPlaylist();
  const [tracks, setTracks] = useState<ProviderTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [artworks, setArtworks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!playlist) {
      setLoading(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        await loadMediaSettings();
        const page = await getSongloftProvider().playlistTracks(playlist.id, {
          limit: currentMediaSettings().pageSize,
          offset: 0,
        });
        const covers = await trackArtworks(page.items);
        if (!alive) return;
        setTracks(page.items);
        setTotal(page.total);
        setArtworks(covers);
      } catch (cause) {
        if (alive) setError(providerErrorMessage(cause));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [playlist]);

  const loadMore = async () => {
    'background only';
    if (!playlist || busy || tracks.length >= total) return;
    setBusy('more');
    setError('');
    try {
      const page = await getSongloftProvider().playlistTracks(playlist.id, {
        limit: currentMediaSettings().pageSize,
        offset: tracks.length,
      });
      const covers = await trackArtworks(page.items);
      setTracks((items) => [...items, ...page.items]);
      setTotal(page.total);
      setArtworks((art) => ({ ...art, ...covers }));
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const play = async (track: ProviderTrack) => {
    'background only';
    if (busy) return;
    setBusy(`play-${track.id}`);
    setError('');
    try {
      await playProviderTrack(getSongloftProvider(), track);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const add = async (track: ProviderTrack) => {
    'background only';
    if (busy) return;
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
    if (busy || !tracks.length) return;
    setBusy('play-all');
    setError('');
    setNotice('');
    try {
      const count = await playProviderTracks(getSongloftProvider(), tracks);
      setNotice(`已开始播放 ${count} 首歌曲`);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const addAll = async () => {
    'background only';
    if (busy || !tracks.length) return;
    setBusy('add-all');
    setError('');
    setNotice('');
    try {
      const count = await enqueueProviderTracks(getSongloftProvider(), tracks);
      setNotice(`已加入队列 ${count} 首歌曲`);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const subtitle = (track: ProviderTrack): string =>
    [track.artist, track.album].filter(Boolean).join(' · ') || '未知歌手';

  return (
    <SettingsSubPage
      title={playlist?.name ?? '歌单'}
      backLabel="首页"
      onBack={() => navigate({ to: ROUTE_PATHS.home })}
      testid="playlist-page"
      topbarTestid="playlist-topbar"
      backTestid="playlist-back"
      scrollTestid="playlist-scroll"
    >
      {!playlist ? (
        <Hint tone="muted" testid="playlist-empty">
          没有可显示的歌单,请从首页重新进入。
        </Hint>
      ) : (
        <>
          {playlist.description ? (
            <Hint tone="caption">{playlist.description}</Hint>
          ) : null}
          {loading ? <Hint tone="caption">正在加载歌单…</Hint> : null}
          {error ? (
            <Hint tone="error" testid="playlist-error">
              {error}
            </Hint>
          ) : null}
          {notice ? (
            <Hint tone="muted" testid="playlist-notice">
              {notice}
            </Hint>
          ) : null}

          <view className="playlist__actions">
            <Button
              grow
              label={busy === 'play-all' ? '加载中…' : '播放全部'}
              disabled={busy !== '' || !tracks.length}
              onTap={playAll}
              testid="playlist-play-all"
            />
            <Button
              grow
              variant="secondary"
              label={busy === 'add-all' ? '加入中…' : '全部加入队列'}
              disabled={busy !== '' || !tracks.length}
              onTap={addAll}
              testid="playlist-add-all"
            />
          </view>

          {!loading && !tracks.length && !error ? (
            <Hint tone="caption" testid="playlist-track-empty">
              这个歌单还没有歌曲
            </Hint>
          ) : null}

          {tracks.map((track, index) => (
            <SongRow
              key={track.id}
              artwork={artworks[track.id]}
              title={track.title}
              subtitle={subtitle(track)}
              busy={busy === `add-${track.id}`}
              onTap={() => play(track)}
              onAdd={() => add(track)}
              testid={`playlist-track-${index}`}
            />
          ))}

          {tracks.length < total ? (
            <view className="playlist__load-row">
              <Button
                grow
                variant="secondary"
                label={busy === 'more' ? '加载中…' : '加载更多歌曲'}
                disabled={busy !== ''}
                onTap={loadMore}
                testid="playlist-more"
              />
            </view>
          ) : null}
        </>
      )}
    </SettingsSubPage>
  );
}
