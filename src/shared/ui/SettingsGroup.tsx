import type { ReactNode } from '@lynx-js/react';

import './SettingsGroup.css';

interface SettingsGroupProps {
  title: string;
  children: ReactNode;
}

/** 设置分组卡片:组标题 + 圆角 14px 的条目容器。 */
export function SettingsGroup({ title, children }: SettingsGroupProps) {
  return (
    <view className="settings-group">
      <text className="settings-group__title">{title}</text>
      <view className="settings-group__body">{children}</view>
    </view>
  );
}

/** 条目之间的 1px 分隔线,左缩进与图标列对齐。 */
export function SettingsGroupDivider() {
  return <view className="settings-group__divider" />;
}
