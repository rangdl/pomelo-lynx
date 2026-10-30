import './IconBadge.css';

export type IconTone =
  | 'azure'
  | 'blue'
  | 'danger'
  | 'gray'
  | 'green'
  | 'indigo'
  | 'neutral'
  | 'orange'
  | 'red'
  | 'sky'
  | 'violet';

/**
 * 设置行图标块。色板集中在这里,业务页面不要再写 iconColor="#..."。
 * 图标是品牌色例外,不随主题变体变化。
 */
export function IconBadge({
  glyph,
  tone = 'blue',
}: {
  glyph: string;
  tone?: IconTone;
}) {
  return (
    <view
      className={`icon-badge icon-badge--${tone}`}
      accessibility-element={false}
    >
      <text className="icon-badge__glyph">{glyph}</text>
    </view>
  );
}
