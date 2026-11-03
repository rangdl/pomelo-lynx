import { Button } from './Button.js';
import './SongRow.css';

export interface SongRowProps {
  title: string;
  subtitle: string;
  artwork?: string;
  busy?: boolean;
  onTap: () => void;
  onAdd: () => void;
  testid?: string;
}

/** 首页歌曲列表行：封面缩略图 + 标题/歌手 + 加入队列。 */
export function SongRow({
  title,
  subtitle,
  artwork,
  busy,
  onTap,
  onAdd,
  testid,
}: SongRowProps) {
  return (
    <view
      className="song-row"
      bindtap={onTap}
      accessibility-element={true}
      accessibility-label={`${title}, ${subtitle}`}
      accessibility-traits="button"
      data-testid={testid}
    >
      {artwork ? (
        <image
          className="song-row__cover"
          src={artwork}
          mode="aspectFill"
          accessibility-element={false}
        />
      ) : (
        <view className="song-row__cover song-row__cover--empty">
          <text className="song-row__glyph">♪</text>
        </view>
      )}
      <view className="song-row__content">
        <text className="song-row__title">{title}</text>
        <text className="song-row__subtitle">{subtitle}</text>
      </view>
      <Button
        variant="text"
        label={busy ? '…' : '加入'}
        stopPropagation
        disabled={busy}
        onTap={onAdd}
        testid={testid ? `${testid}-add` : undefined}
      />
    </view>
  );
}
