import { useState } from '@lynx-js/react';

import { fetchFiveSingTracks } from '../../core/media/five-sing.js';
import {
  appendMediaTracks,
  clearMediaQueue,
  enqueueMedia,
  loadMedia,
  playNextMedia,
  playPreviousMedia,
  playQueueAt,
  removeMediaAt,
  seekMedia,
  stopMedia,
  toggleMedia,
  useMediaPlayer,
} from '../../core/media/player.js';
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
import './PlayerPage.css';

const SEEK_STEP_SECONDS = 15;
const SAMPLE_AUDIO_URL = 'https://cdn.truefilesize.com/mp3/sample-1mb.mp3';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function statusText(state: string): string {
  switch (state) {
    case 'loading':
      return '加载中';
    case 'playing':
      return '播放中';
    case 'paused':
      return '已暂停';
    case 'ended':
      return '播放结束';
    case 'error':
      return '播放失败';
    default:
      return '未加载';
  }
}

function fiveSingErrorText(error: unknown): string {
  const known: Record<string, string> = {
    five_sing_network: '5sing 网络请求失败',
    five_sing_timeout: '5sing 请求超时',
    five_sing_playlist_failed: '5sing 歌单读取失败',
    five_sing_media_failed: '5sing 播放地址获取失败',
    five_sing_empty: '5sing 没有返回可播放歌曲',
    five_sing_json: '5sing 返回数据格式错误',
    five_sing_body: '5sing 响应内容异常',
    five_sing_no_response: '5sing 没有返回响应',
    five_sing_invalid_url: '5sing 请求地址无效',
    five_sing_redirect_rejected: '5sing 返回了非法重定向',
  };
  const code = error instanceof Error ? error.message : '';
  if (known[code]) return known[code];
  return code ? `5sing 测试数据加载失败（${code}）` : '5sing 测试数据加载失败';
}

function errorText(error: string): string {
  const known: Record<string, string> = {
    player_empty_url: '请输入音频地址',
    player_invalid_url: '音频地址无效,需要 http(s) 地址',
    player_no_source: '请先加载音频',
    player_audio_session_failed: '无法启用音频播放会话',
    player_item_failed: '音频加载失败',
    player_unavailable: '当前客户端不支持音视频播放',
  };
  return known[error] ?? (error || '播放失败');
}

export function PlayerPage() {
  const player = useMediaPlayer();
  const [draft, setDraft] = useState('');
  const [fiveSingBusy, setFiveSingBusy] = useState(false);
  const [fiveSingError, setFiveSingError] = useState('');

  const load = () => {
    'background only';
    void loadMedia(draft);
  };
  const loadSample = () => {
    'background only';
    setDraft(SAMPLE_AUDIO_URL);
    enqueueMedia(SAMPLE_AUDIO_URL, { title: '示例音频' });
  };
  const enqueue = () => {
    'background only';
    enqueueMedia(draft);
  };
  const enqueueNext = () => {
    'background only';
    enqueueMedia(draft, undefined, 'next');
  };
  const removeAt = (index: number) => {
    'background only';
    removeMediaAt(index);
  };
  const loadFiveSing = async () => {
    'background only';
    if (fiveSingBusy) return;
    setFiveSingBusy(true);
    setFiveSingError('');
    try {
      appendMediaTracks(await fetchFiveSingTracks());
    } catch (error) {
      console.error('5sing test failed', error);
      setFiveSingError(fiveSingErrorText(error));
    } finally {
      setFiveSingBusy(false);
    }
  };
  const clearQueue = () => {
    'background only';
    clearMediaQueue();
  };
  const toggle = () => {
    'background only';
    toggleMedia();
  };
  const seek = (offset: number) => {
    'background only';
    seekMedia(player.position + offset);
  };
  const stop = () => {
    'background only';
    stopMedia();
  };

  const hasSource = !!player.url;
  const currentTrack = player.queue[player.currentIndex];
  const busy = player.busy || player.state === 'loading';
  const error = player.error ? errorText(player.error) : null;

  return (
    <view className="player" data-testid="player-page">
      <PageLargeTitle title="播放" />
      <scroll-view className="settings__scroll" scroll-orientation="vertical">
        <SettingsGroup title="当前播放">
          <ListRow
            iconGlyph="♪"
            iconTone="violet"
            label="音频源"
            value={hasSource ? '已加载' : '未加载'}
            detail={
              hasSource
                ? currentTrack?.title
                  ? `${currentTrack.title} · ${player.url}`
                  : player.url
                : '还没有加载音频'
            }
            testid="player-source"
          />
          <SettingsGroupDivider />
          <ListRow
            iconGlyph="◉"
            iconTone={player.state === 'error' ? 'danger' : 'blue'}
            label="状态"
            value={statusText(player.state)}
            detail={`${formatTime(player.position)} / ${formatTime(player.duration)}`}
            testid="player-status"
          />
        </SettingsGroup>

        <SettingsGroup title="音频源">
          <view className="player__form">
            <TextField
              label="音频 URL"
              value={draft}
              onChange={setDraft}
              placeholder={SAMPLE_AUDIO_URL}
              hint="当前 MVP 支持远程 HTTPS 音频、后台播放和锁屏控制;可点下方加载 1 MB 测试音频"
              error={error}
              testid="player-url-input"
            />
          </view>
          <view className="player__actions">
            <Button
              grow
              label={busy ? '加载中…' : '加载并播放'}
              disabled={busy || !draft.trim() || !player.available}
              onTap={load}
              testid="player-load"
            />
            <Button
              grow
              variant="secondary"
              label="添加到列表"
              disabled={busy || !draft.trim() || !player.available}
              onTap={enqueue}
              testid="player-enqueue"
            />
          </view>
          <view className="player__actions">
            <Button
              grow
              variant="secondary"
              label="下一首播放"
              disabled={busy || !draft.trim() || !player.available}
              onTap={enqueueNext}
              testid="player-enqueue-next"
            />
            <Button
              grow
              variant="secondary"
              label="加入示例"
              disabled={busy || !player.available}
              onTap={loadSample}
              testid="player-load-sample"
            />
          </view>
        </SettingsGroup>

        <SettingsGroup title="5sing 测试">
          <view className="player__actions">
            <Button
              grow
              variant="secondary"
              label={fiveSingBusy ? '加载中…' : '加载 5sing 歌单'}
              disabled={fiveSingBusy || !player.available}
              onTap={loadFiveSing}
              testid="player-load-5sing"
            />
          </view>
          <Hint tone="caption" testid="player-5sing-hint">
            第三方测试接口,加载 8 首真实歌曲;原生端可用,Web 预览可能被跨域拦截。
          </Hint>
          {fiveSingError ? (
            <Hint tone="error" testid="player-5sing-error">
              {fiveSingError}
            </Hint>
          ) : null}
        </SettingsGroup>

        <SettingsGroup
          title={`播放队列${player.queue.length ? ` · ${player.queue.length}` : ''}`}
        >
          {player.queue.length === 0 ? (
            <Hint tone="caption">
              队列为空;输入 URL 后点「添加到列表」或「下一首播放」。
            </Hint>
          ) : (
            <>
              {player.queue.map((track, index) => (
                <ListRow
                  key={`${index}-${track.url}`}
                  iconGlyph={index === player.currentIndex ? '▶' : '♪'}
                  iconTone={index === player.currentIndex ? 'green' : 'indigo'}
                  label={track.title || `音频 ${index + 1}`}
                  detail={`${index === player.currentIndex ? '当前 · ' : ''}${
                    track.artist ? `${track.artist} · ` : ''
                  }${track.url}`}
                  trailing={
                    <Button
                      variant="text"
                      label="移出"
                      stopPropagation
                      onTap={() => removeAt(index)}
                      testid={`player-remove-${index}`}
                    />
                  }
                  onTap={() => playQueueAt(index)}
                  testid={`player-queue-${index}`}
                />
              ))}
              <SettingsGroupDivider />
              <ListRow
                iconGlyph="×"
                iconTone="danger"
                danger
                label="清空队列"
                onTap={clearQueue}
                testid="player-clear-queue"
              />
            </>
          )}
        </SettingsGroup>

        <SettingsGroup title="控制">
          <view className="player__actions">
            <Button
              grow
              variant="secondary"
              label="后退 15s"
              disabled={!hasSource || busy}
              onTap={() => seek(-SEEK_STEP_SECONDS)}
              testid="player-back-15"
            />
            <Button
              grow
              label={player.state === 'playing' ? '暂停' : '播放'}
              disabled={!hasSource || busy || !player.available}
              onTap={toggle}
              testid="player-toggle"
            />
            <Button
              grow
              variant="secondary"
              label="前进 15s"
              disabled={!hasSource || busy}
              onTap={() => seek(SEEK_STEP_SECONDS)}
              testid="player-forward-15"
            />
          </view>
          <view className="player__actions">
            <Button
              grow
              variant="secondary"
              label="上一首"
              disabled={player.currentIndex <= 0 || busy}
              onTap={() => {
                'background only';
                playPreviousMedia();
              }}
              testid="player-previous"
            />
            <Button
              grow
              variant="secondary"
              label="下一首"
              disabled={
                player.currentIndex < 0 ||
                player.currentIndex + 1 >= player.queue.length ||
                busy
              }
              onTap={() => {
                'background only';
                playNextMedia();
              }}
              testid="player-next"
            />
            <Button
              grow
              variant="danger"
              label="停止"
              disabled={!hasSource || busy}
              onTap={stop}
              testid="player-stop"
            />
          </view>
        </SettingsGroup>

        {!player.available && player.initialized ? (
          <Hint tone="warning">
            当前客户端没有 PomeloPlayer 模块,请安装包含播放器的新版 IPA。
          </Hint>
        ) : null}
        {player.state === 'ended' ? (
          <Hint tone="caption">播放已结束,再次点击播放会从头开始。</Hint>
        ) : null}

        <PageTail />
      </scroll-view>
    </view>
  );
}
