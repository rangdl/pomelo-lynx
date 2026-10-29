import type { ReactNode } from '@lynx-js/react';

import './PageTopBar.css';

interface PageTopBarProps {
  title: string;
  /** 返回按钮文案;省略时只显示 `‹`。 */
  backLabel?: string;
  /** 省略时不渲染返回按钮(根页面)。 */
  onBack?: () => void;
  /** 右侧操作插槽,与返回按钮对称占位。 */
  right?: ReactNode;
  testid?: string;
  backTestid?: string;
}

/**
 * 标准子页导航栏:iOS 44px 内容高度 + 顶部安全区,左右两侧各固定 88px,
 * 标题居中。根 tab 页(设置)使用大标题,不套这个组件。
 */
export function PageTopBar({
  title,
  backLabel,
  onBack,
  right,
  testid,
  backTestid,
}: PageTopBarProps) {
  return (
    <view className="page-topbar" data-testid={testid}>
      <view className="page-topbar__side">
        {onBack ? (
          <view
            className="page-topbar__back"
            bindtap={onBack}
            data-testid={backTestid}
          >
            <text className="page-topbar__back-text">
              {backLabel ? `‹ ${backLabel}` : '‹'}
            </text>
          </view>
        ) : null}
      </view>
      <text className="page-topbar__title">{title}</text>
      <view className="page-topbar__side page-topbar__side--right">
        {right}
      </view>
    </view>
  );
}
