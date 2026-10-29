import { useNavigate } from '@tanstack/react-router';

import { t } from '../../i18n/index.js';
import { PageTopBar } from '../../shared/layouts/PageTopBar.js';
import { DebugTunnelSection } from './DebugTunnelSection.js';
import { DevServerSection } from './DevServerSection.js';
import './settings.css';

/**
 * 开发者子页(/settings/developer):dev 通道才从设置页进入。
 * 页面本身沿用设置页的滚动容器与尾部 spacer 约束。
 */
export function DeveloperPage() {
  const navigate = useNavigate();

  return (
    <view className="settings" data-testid="developer-page">
      <PageTopBar
        title={t('developer.title')}
        backLabel={t('settings.title')}
        onBack={() => navigate({ to: '/settings' })}
        testid="developer-topbar"
        backTestid="developer-back"
      />
      <scroll-view className="settings__scroll" scroll-orientation="vertical">
        <DevServerSection />
        <DebugTunnelSection />
        <view className="settings__tail" />
      </scroll-view>
    </view>
  );
}
