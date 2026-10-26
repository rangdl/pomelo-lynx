import { useNavigate } from '../../shared/router.js';

import './settings.css';

/** 设置页:条目列表。「关于」进入关于页(含客户端更新区)。 */
export function SettingsPage() {
  const navigate = useNavigate();

  return (
    <view className="settings" data-testid="settings-page">
      <view className="settings__header">
        <text className="settings__title">设置</text>
      </view>
      <view
        className="settings-row"
        bindtap={() => navigate({ to: '/settings/about' })}
        data-testid="settings-row-about"
      >
        <text className="settings-row__label">关于</text>
        <text className="settings-row__value">›</text>
      </view>
    </view>
  );
}
