import type { ReactNode } from '@lynx-js/react';

import { IconBadge, type IconTone } from './IconBadge.js';
import './ListRow.css';

interface ListRowProps {
  label: string;
  /** 右侧单行值,通常是短文本。 */
  value?: string;
  /** 标签下方的辅助说明。 */
  detail?: string;
  onTap?: () => void;
  testid?: string;
  /** 危险操作(恢复内置、删除等)使用红色标签。 */
  danger?: boolean;
  disabled?: boolean;
  /** 完全自定义右侧内容;提供时忽略 value/chevron。 */
  trailing?: ReactNode;
  /** 设置行图标;由 IconBadge 统一色板和尺寸。 */
  iconGlyph?: string;
  iconTone?: IconTone;
  /** 显示右侧箭头。 */
  chevron?: boolean;
  /** 读屏文案;省略时用 label。 */
  accessibilityLabel?: string;
}

/**
 * 设置条目行:左侧彩色图标块 + 标题/描述,右侧值、箭头或自定义控件。
 * toggle 行不要把 onTap 绑在整行上,避免与开关冒泡叠加。
 */
export function ListRow({
  label,
  value,
  detail,
  onTap,
  testid,
  danger,
  disabled,
  trailing,
  iconGlyph,
  iconTone,
  chevron,
  accessibilityLabel,
}: ListRowProps) {
  const classes = ['list-row'];
  if (iconGlyph) classes.push('list-row--with-icon');
  if (danger) classes.push('list-row--danger');
  if (disabled) classes.push('list-row--disabled');

  return (
    <view
      className={classes.join(' ')}
      bindtap={disabled ? undefined : onTap}
      data-testid={testid}
      accessibility-element={onTap ? true : undefined}
      accessibility-label={onTap ? (accessibilityLabel ?? label) : undefined}
      accessibility-traits={onTap ? 'button' : undefined}
    >
      {iconGlyph ? <IconBadge glyph={iconGlyph} tone={iconTone} /> : null}
      <view className="list-row__content">
        <text className="list-row__label">{label}</text>
        {detail ? <text className="list-row__detail">{detail}</text> : null}
      </view>
      {trailing ? (
        trailing
      ) : (
        <>
          {value !== undefined ? (
            <text className="list-row__value">{value}</text>
          ) : null}
          {chevron ? <text className="list-row__arrow">›</text> : null}
        </>
      )}
    </view>
  );
}
