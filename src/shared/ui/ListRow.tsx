import type { ReactNode } from '@lynx-js/react';

import './ListRow.css';

interface ListRowProps {
  label: string;
  /** 右侧单行值,通常是一段短文本或 `›`。 */
  value?: ReactNode;
  /** 标签下方的辅助说明。 */
  detail?: string;
  onTap?: () => void;
  testid?: string;
  /** 危险操作(恢复内置、删除等)使用红色标签。 */
  danger?: boolean;
  /** 完全自定义右侧内容;提供时忽略 value。 */
  trailing?: ReactNode;
}

/**
 * 设置/关于页的通用列表行:左侧 label(+ detail),右侧 value 或自定义插槽。
 * 与 `.settings-row` 视觉一致,新页面优先用它。
 */
export function ListRow({
  label,
  value,
  detail,
  onTap,
  testid,
  danger,
  trailing,
}: ListRowProps) {
  return (
    <view
      className={danger ? 'list-row list-row--danger' : 'list-row'}
      bindtap={onTap}
      data-testid={testid}
    >
      <view className="list-row__content">
        <text className="list-row__label">{label}</text>
        {detail ? <text className="list-row__detail">{detail}</text> : null}
      </view>
      {trailing ? (
        trailing
      ) : value !== undefined ? (
        <text className="list-row__value">{value}</text>
      ) : null}
    </view>
  );
}
