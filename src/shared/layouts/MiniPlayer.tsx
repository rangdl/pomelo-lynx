import { useNavigate } from '@tanstack/react-router';

import {
  playNextMedia,
  toggleMedia,
  useMediaPlayer,
} from '../../core/media/player.js';
import { Button } from '../ui/Button.js';
import { IconBadge } from '../ui/IconBadge.js';
import './MiniPlayer.css';

/**
 * 底部导航上方的播放胶囊:除设置页外全局显示。
 * 点击主体进入播放页,暂停/下一首按钮阻止冒泡。
 */
export function MiniPlayer() {
  const navigate = useNavigate();
  const player = useMediaPlayer();
  const track = player.queue[player.currentIndex];
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

  return (
    <view
      className="mini-player"
      bindtap={() => navigate({ to: '/player' })}
      accessibility-element={true}
      accessibility-label={`${track.title}, ${detail}`}
      accessibility-traits="button"
      data-testid="mini-player"
    >
      <IconBadge glyph="♪" tone="indigo" />
      <view className="mini-player__meta">
        <text className="mini-player__title">{track.title}</text>
        <text className="mini-player__detail">{detail}</text>
      </view>
      <view className="mini-player__controls">
        <Button
          variant="text"
          label={playing ? '暂停' : '播放'}
          stopPropagation
          disabled={player.busy}
          onTap={toggle}
          testid="mini-player-toggle"
        />
        <Button
          variant="text"
          label="下一首"
          stopPropagation
          disabled={nextDisabled}
          onTap={next}
          testid="mini-player-next"
        />
      </view>
    </view>
  );
}
