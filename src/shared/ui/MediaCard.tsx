import { useEffect, useState } from '@lynx-js/react';

import './MediaCard.css';

export interface MediaCardProps {
  title: string;
  subtitle?: string;
  artwork?: string;
  onTap: () => void;
  testid?: string;
}

/**
 * 音乐首页的方形封面卡片：封面 + 标题 + 副标题。
 * 用于最近添加/歌单横向卡片架，不做列表行。
 */
export function MediaCard({
  title,
  subtitle,
  artwork,
  onTap,
  testid,
}: MediaCardProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [artwork]);
  return (
    <view
      className="media-card"
      bindtap={onTap}
      accessibility-element={true}
      accessibility-label={subtitle ? `${title}, ${subtitle}` : title}
      accessibility-traits="button"
      data-testid={testid}
    >
      <view className="media-card__cover-wrap">
        {artwork && !failed ? (
          <image
            className="media-card__cover"
            src={artwork}
            mode="aspectFill"
            binderror={() => setFailed(true)}
            accessibility-element={false}
          />
        ) : (
          <view className="media-card__cover media-card__cover--empty">
            <text className="media-card__glyph">♪</text>
          </view>
        )}
      </view>
      <text className="media-card__title">{title}</text>
      {subtitle ? (
        <text className="media-card__subtitle">{subtitle}</text>
      ) : null}
    </view>
  );
}
