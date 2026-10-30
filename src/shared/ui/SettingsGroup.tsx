import type { ReactNode } from '@lynx-js/react';

import './SettingsGroup.css';

interface SettingsGroupProps {
  /** 省略时不渲染组标题,只保留卡片容器。 */
  title?: string;
  testid?: string;
  children: ReactNode;
}

/** 设置分组卡片:可选组标题 + 圆角 14px 的条目容器。 */
export function SettingsGroup({ title, testid, children }: SettingsGroupProps) {
  return (
    <view
      className={
        title ? 'settings-group' : 'settings-group settings-group--untitled'
      }
      data-testid={testid}
    >
      {title ? <text className="settings-group__title">{title}</text> : null}
      <view className="settings-group__body">{children}</view>
    </view>
  );
}

/** 条目之间的 1px 分隔线,左缩进与图标列对齐。 */
export function SettingsGroupDivider() {
  return <view className="settings-group__divider" />;
}
