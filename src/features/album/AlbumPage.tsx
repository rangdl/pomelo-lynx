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
import { getCurrentAlbum } from '../../core/providers/selection.js';
import { ROUTE_PATHS } from '../../routes.js';
import { SettingsSubPage } from '../../shared/layouts/SettingsSubPage.js';
import { Button } from '../../shared/ui/Button.js';
import { Hint } from '../../shared/ui/Hint.js';
import { SongRow } from '../../shared/ui/SongRow.js';
import './AlbumPage.css';

/**
 * 专辑详情页(/album):列表 + 播放全部 / 加入队列。
 *
 * 与歌单页同构:目标专辑由 `core/providers/selection` 在跳转前写入
 * (静态路由,id 不进 URL)。专辑是 provider 的可选能力,服务端不支持时
 * 首页不展示专辑架,这里只处理"用户已经进入"的正常路径。
 */
export function AlbumPage() {
  const navigate = useNavigate();
  const album = getCurrentAlbum();
  const [tracks, setTracks] = useState<ProviderTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [artworks, setArtworks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!album) {
      setLoading(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        await loadMediaSettings();
        const provider = getSongloftProvider();
        if (typeof provider.albumTracks !== 'function') {
          throw new Error('当前音乐源不支持专辑浏览');
        }
        const page = await provider.albumTracks(album.id, {
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
  }, [album]);

  const loadMore = async () => {
    'background only';
    if (!album || busy || tracks.length >= total) return;
    setBusy('more');
    setError('');
    try {
      const page = await getSongloftProvider().albumTracks?.(album.id, {
        limit: currentMediaSettings().pageSize,
        offset: tracks.length,
      });
      if (!page) return;
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
      title={album?.name ?? '专辑'}
      backLabel="首页"
      onBack={() => navigate({ to: ROUTE_PATHS.home })}
      testid="album-page"
      topbarTestid="album-topbar"
      backTestid="album-back"
      scrollTestid="album-scroll"
    >
      {!album ? (
        <Hint tone="muted" testid="album-empty">
          没有可显示的专辑,请从首页重新进入。
        </Hint>
      ) : (
        <>
          <Hint tone="caption">
            {[album.artist, album.year ? `${album.year} 年` : '']
              .filter(Boolean)
              .join(' · ') ||
              (album.trackCount ? `专辑 · ${album.trackCount} 首歌曲` : '专辑')}
          </Hint>
          {loading ? <Hint tone="caption">正在加载专辑…</Hint> : null}
          {error ? (
            <Hint tone="error" testid="album-error">
              {error}
            </Hint>
          ) : null}
          {notice ? (
            <Hint tone="muted" testid="album-notice">
              {notice}
            </Hint>
          ) : null}

          <view className="album__actions">
            <Button
              grow
              label={busy === 'play-all' ? '加载中…' : '播放全部'}
              disabled={busy !== '' || !tracks.length}
              onTap={playAll}
              testid="album-play-all"
            />
            <Button
              grow
              variant="secondary"
              label={busy === 'add-all' ? '加入中…' : '全部加入队列'}
              disabled={busy !== '' || !tracks.length}
              onTap={addAll}
              testid="album-add-all"
            />
          </view>

          {!loading && !tracks.length && !error ? (
            <Hint tone="caption" testid="album-track-empty">
              这个专辑还没有歌曲
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
              testid={`album-track-${index}`}
            />
          ))}

          {tracks.length < total ? (
            <view className="album__load-row">
              <Button
                grow
                variant="secondary"
                label={busy === 'more' ? '加载中…' : '加载更多歌曲'}
                disabled={busy !== ''}
                onTap={loadMore}
                testid="album-more"
              />
            </view>
          ) : null}
        </>
      )}
    </SettingsSubPage>
  );
}
