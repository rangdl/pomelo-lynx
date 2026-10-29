import { useNavigate } from '@tanstack/react-router';

import { clientBuild } from '../../core/config/constants.js';
import { t } from '../../i18n/index.js';
import { isIosPlatform } from '../../native/web-platform.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import { DebugTunnelSection } from './DebugTunnelSection.js';
import { DevServerSection } from './DevServerSection.js';
import './settings.css';

/** 设置页:条目列表。「关于」进入关于页(含客户端更新区)。 */
export function SettingsPage() {
  const navigate = useNavigate();
  // dev server 与调试通道目前只有 iOS 宿主实现;Android/Web 上不展示,
  // 避免出现点了必然失败的入口。
  const showDeveloperSections =
    clientBuild.channel === 'dev' && isIosPlatform();

  return (
    <view className="settings" data-testid="settings-page">
      <scroll-view className="settings__scroll" scroll-orientation="vertical">
        <view className="settings__header">
          <text className="settings__title">{t('settings.title')}</text>
        </view>
        <ListRow
          label={t('settings.about')}
          value="›"
          onTap={() => navigate({ to: '/settings/about' })}
          testid="settings-row-about"
        />
        {showDeveloperSections ? <DevServerSection /> : null}
        {showDeveloperSections ? <DebugTunnelSection /> : null}
        <view className="settings__tail" />
      </scroll-view>
    </view>
  );
}
