import { useEffect, useState } from '@lynx-js/react';
import type { ProviderPlaylist, ProviderTrack } from '@pomelo/provider-sdk';
import { useNavigate } from '@tanstack/react-router';

import {
  connectSongloft,
  disconnectSongloft,
  enqueueProviderTracks,
  getSongloftProvider,
  playProviderTrack,
  playProviderTracks,
  providerErrorMessage,
  restoreSongloft,
} from '../../core/providers/index.js';
import { t } from '../../i18n/index.js';
import { SettingsSubPage } from '../../shared/layouts/SettingsSubPage.js';
import { Button } from '../../shared/ui/Button.js';
import { Hint } from '../../shared/ui/Hint.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import {
  SettingsGroup,
  SettingsGroupDivider,
} from '../../shared/ui/SettingsGroup.js';
import { TextField } from '../../shared/ui/TextField.js';
import './SourcePage.css';

const PLAYLIST_LIMIT = 50;
const TRACK_LIMIT = 200;
const SEARCH_LIMIT = 50;

/**
 * 音乐源设置页：Songloft 登录、歌单浏览、搜索和入队。
 * 服务器地址/用户名随会话保存在 secure 存储；密码只用于登录，不落盘。
 */
export function SourcePage() {
  const navigate = useNavigate();
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [connected, setConnected] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [playlists, setPlaylists] = useState<ProviderPlaylist[]>([]);
  const [selected, setSelected] = useState<ProviderPlaylist | null>(null);
  const [listTitle, setListTitle] = useState('歌曲');
  const [tracks, setTracks] = useState<ProviderTrack[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const session = await restoreSongloft();
        if (!alive) return;
        if (!session) {
          setRestoring(false);
          return;
        }
        setServerUrl(session.serverUrl);
        setUsername(session.username);
        setFormKey((value) => value + 1);
        setConnected(true);
        const page = await getSongloftProvider().playlists({
          limit: PLAYLIST_LIMIT,
        });
        if (alive) setPlaylists(page.items);
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

  const connect = async () => {
    'background only';
    if (busy || restoring) return;
    setBusy('connect');
    setError('');
    setNotice('');
    try {
      const session = await connectSongloft({
        serverUrl,
        username,
        password,
      });
      setConnected(true);
      setPassword('');
      setServerUrl(session.serverUrl);
      setUsername(session.username);
      setFormKey((value) => value + 1);
      const page = await getSongloftProvider().playlists({
        limit: PLAYLIST_LIMIT,
      });
      setPlaylists(page.items);
      setSelected(null);
      setTracks([]);
      setNotice(`已连接 ${session.serverUrl}`);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    'background only';
    if (busy) return;
    setBusy('disconnect');
    setError('');
    setNotice('');
    try {
      await disconnectSongloft();
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setConnected(false);
      setPlaylists([]);
      setSelected(null);
      setTracks([]);
      setPassword('');
      setFormKey((value) => value + 1);
      setBusy('');
    }
  };

  const refreshPlaylists = async () => {
    'background only';
    if (busy || !connected) return;
    setBusy('playlists');
    setError('');
    setNotice('');
    try {
      const page = await getSongloftProvider().playlists({
        limit: PLAYLIST_LIMIT,
      });
      setPlaylists(page.items);
      setNotice(`已加载 ${page.items.length} 个歌单`);
    } catch (cause) {
      setError(providerErrorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const openPlaylist = async (playlist: ProviderPlaylist) => {
    'background only';
    if (busy || !connected) return;
    setBusy('tracks');
    setError('');
    setNotice('');
    try {
      const page = await getSongloftProvider().playlistTracks(playlist.id, {
        limit: TRACK_LIMIT,
      });
      setSelected(playlist);
      setListTitle(playlist.name);
      setTracks(page.items);
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
        limit: SEARCH_LIMIT,
      });
      setSelected(null);
      setListTitle(`搜索「${keyword}」`);
      setTracks(page.items);
      setNotice(
        page.items.length ? `找到 ${page.total} 首歌曲` : '没有找到歌曲',
      );
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

  const playAll = async () => {
    'background only';
    if (busy || !connected || !tracks.length) return;
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
    if (busy || !connected || !tracks.length) return;
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

  const busyLabel = busy ? '处理中…' : '';

  return (
    <SettingsSubPage
      title={t('sources.title')}
      backLabel={t('sources.back')}
      onBack={() => navigate({ to: '/settings' })}
      testid="sources-page"
      topbarTestid="sources-topbar"
      backTestid="sources-back"
    >
      <SettingsGroup title="Songloft">
        <ListRow
          iconGlyph="●"
          iconTone={connected ? 'green' : 'gray'}
          label="连接状态"
          value={connected ? '已连接' : '未连接'}
          detail={
            connected
              ? `${serverUrl} · ${username}`
              : restoring
                ? '正在恢复上次连接…'
                : '输入服务器地址和账号'
          }
          testid="sources-status"
        />
        <SettingsGroupDivider />
        <view className="sources__form">
          <TextField
            label="服务器地址"
            value={serverUrl}
            onChange={setServerUrl}
            placeholder="http://192.168.1.10:58091"
            hint="填写完整地址；可带反向代理路径，不要填 /api/v1"
            disabled={busy !== '' || restoring}
            inputKey={`sources-server-${formKey}`}
            testid="sources-server-input"
          />
          <TextField
            label="用户名"
            value={username}
            onChange={setUsername}
            hint="与 Songloft 网页端登录账号一致"
            disabled={busy !== '' || restoring}
            inputKey={`sources-user-${formKey}`}
            testid="sources-user-input"
          />
          <TextField
            label="密码"
            value={password}
            onChange={setPassword}
            password
            hint="只用于换取 token，不会保存密码"
            disabled={busy !== '' || restoring || connected}
            inputKey={`sources-password-${formKey}`}
            testid="sources-password-input"
          />
        </view>
        <view className="sources__actions">
          <Button
            grow
            label={busy === 'connect' ? '连接中…' : '连接'}
            disabled={
              busy !== '' ||
              restoring ||
              connected ||
              !serverUrl.trim() ||
              !username.trim() ||
              !password
            }
            onTap={connect}
            testid="sources-connect"
          />
          <Button
            grow
            variant="danger"
            label={busy === 'disconnect' ? '断开中…' : '断开'}
            disabled={busy !== '' || restoring || !connected}
            onTap={disconnect}
            testid="sources-disconnect"
          />
        </view>
        <Hint tone="caption">
          Songloft 默认端口 58091；token 存在系统安全存储，密码不落盘。
        </Hint>
        {error ? (
          <Hint tone="error" testid="sources-error">
            {error}
          </Hint>
        ) : null}
        {notice ? (
          <Hint tone="muted" testid="sources-notice">
            {notice}
          </Hint>
        ) : null}
        {busyLabel ? (
          <Hint tone="caption" testid="sources-busy">
            {busyLabel}
          </Hint>
        ) : null}
      </SettingsGroup>

      {connected ? (
        <SettingsGroup title="歌单">
          <view className="sources__actions">
            <Button
              grow
              variant="secondary"
              label={busy === 'playlists' ? '刷新中…' : '刷新歌单'}
              disabled={busy !== ''}
              onTap={refreshPlaylists}
              testid="sources-refresh-playlists"
            />
          </view>
          {playlists.length ? (
            playlists.map((playlist, index) => (
              <ListRow
                key={playlist.id}
                iconGlyph="♫"
                iconTone={selected?.id === playlist.id ? 'green' : 'indigo'}
                label={playlist.name}
                detail={playlist.description || `${playlist.trackCount} 首歌曲`}
                value={selected?.id === playlist.id ? '已打开' : undefined}
                chevron={selected?.id !== playlist.id}
                onTap={() => openPlaylist(playlist)}
                testid={`sources-playlist-${index}`}
              />
            ))
          ) : (
            <Hint tone="caption">
              {restoring ? '正在恢复连接…' : '没有歌单，点上方刷新。'}
            </Hint>
          )}
        </SettingsGroup>
      ) : null}

      {connected ? (
        <SettingsGroup title="搜索">
          <view className="sources__form">
            <TextField
              label="关键词"
              value={query}
              onChange={setQuery}
              onConfirm={search}
              placeholder="歌名、歌手或专辑"
              disabled={busy !== ''}
              testid="sources-search-input"
            />
          </view>
          <view className="sources__actions">
            <Button
              grow
              variant="secondary"
              label={busy === 'search' ? '搜索中…' : '搜索'}
              disabled={busy !== '' || !query.trim()}
              onTap={search}
              testid="sources-search"
            />
          </view>
        </SettingsGroup>
      ) : null}

      {connected && tracks.length ? (
        <SettingsGroup title={listTitle}>
          <view className="sources__actions">
            <Button
              grow
              label={busy === 'play-all' ? '加载中…' : '播放全部'}
              disabled={busy !== ''}
              onTap={playAll}
              testid="sources-play-all"
            />
            <Button
              grow
              variant="secondary"
              label={busy === 'add-all' ? '加入中…' : '全部加入队列'}
              disabled={busy !== ''}
              onTap={addAll}
              testid="sources-add-all"
            />
          </view>
          {tracks.map((track, index) => (
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
                  testid={`sources-add-${index}`}
                />
              }
              testid={`sources-track-${index}`}
            />
          ))}
        </SettingsGroup>
      ) : null}

      {connected && !tracks.length && selected ? (
        <Hint tone="caption">这个歌单没有可播放的歌曲。</Hint>
      ) : null}
    </SettingsSubPage>
  );
}
