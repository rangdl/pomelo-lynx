import { useEffect, useState } from '@lynx-js/react';
import { useNavigate } from '@tanstack/react-router';

import {
  playNextMedia,
  toggleMedia,
  useMediaPlayer,
} from '../../core/media/player.js';
import { ROUTE_PATHS } from '../../routes.js';
import { Button } from '../ui/Button.js';
import './MiniPlayer.css';

/**
 * 底部导航上方的播放胶囊:除设置页外全局显示。
 *
 * 左侧是当前曲目封面,右侧是播放/暂停与下一首的图标按钮(文字由
 * 无障碍标签提供),胶囊底部是一条与播放进度同步的进度条。
 * 点击主体进入播放页,按钮用 catchtap 阻止冒泡。
 */
export function MiniPlayer() {
  const navigate = useNavigate();
  const player = useMediaPlayer();
  const track = player.queue[player.currentIndex];
  // 封面可能随刷新播放链接一起换 token,上一次的失败态要跟着重置。
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => {
    setCoverFailed(false);
  }, [track?.artwork]);
  if (!track || !player.url || player.state === 'idle') return null;

  const toggle = () => {
    'background only';
    toggleMedia();
  };
  const next = () => {
    'background only';
    playNextMedia();
  };
  const playing = player.state === 'playing';
  const nextDisabled =
    player.busy ||
    player.currentIndex < 0 ||
    player.currentIndex + 1 >= player.queue.length;
  const detail = player.refreshing
    ? '刷新播放链接中…'
    : [track.artist, track.album].filter(Boolean).join(' · ') || '正在播放';

  // 时长未知(直播/尚未回调)时不画进度,避免出现半截假进度。
  const progress =
    player.duration > 0
      ? Math.min(100, Math.max(0, (player.position / player.duration) * 100))
      : 0;
  const showProgress = player.duration > 0;

  return (
    <view
      className="mini-player"
      bindtap={() => navigate({ to: ROUTE_PATHS.player })}
      accessibility-element={true}
      accessibility-label={`${track.title}, ${detail}`}
      accessibility-traits="button"
      data-testid="mini-player"
    >
      <view className="mini-player__row">
        {track.artwork && !coverFailed ? (
          <image
            className="mini-player__cover"
            src={track.artwork}
            mode="aspectFill"
            binderror={() => setCoverFailed(true)}
            accessibility-element={false}
          />
        ) : (
          <view className="mini-player__cover mini-player__cover--empty">
            <text className="mini-player__cover-glyph">♪</text>
          </view>
        )}
        <view className="mini-player__meta">
          <text className="mini-player__title">{track.title}</text>
          <text className="mini-player__detail">{detail}</text>
        </view>
        <view className="mini-player__controls">
          <Button
            variant="text"
            icon={playing ? '❚❚' : '▶'}
            label={playing ? '暂停' : '播放'}
            stopPropagation
            disabled={player.busy}
            onTap={toggle}
            testid="mini-player-toggle"
          />
          <Button
            variant="text"
            icon="▶❚"
            label="下一首"
            stopPropagation
            disabled={nextDisabled}
            onTap={next}
            testid="mini-player-next"
          />
        </view>
      </view>
      {showProgress ? (
        <view
          className="mini-player__progress"
          accessibility-element={false}
          data-testid="mini-player-progress"
        >
          <view
            className="mini-player__progress-fill"
            style={{ width: `${progress}%` }}
          />
        </view>
      ) : null}
    </view>
  );
}
