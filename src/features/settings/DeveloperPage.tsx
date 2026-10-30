import { useNavigate } from '@tanstack/react-router';

import { t } from '../../i18n/index.js';
import { SettingsSubPage } from '../../shared/layouts/SettingsSubPage.js';
import { DebugTunnelSection } from './DebugTunnelSection.js';
import { DevServerSection } from './DevServerSection.js';

/**
 * 开发者子页(/settings/developer):dev 通道才从设置页进入。
 * 页面骨架由 SettingsSubPage 统一维护。
 */
export function DeveloperPage() {
  const navigate = useNavigate();

  return (
    <SettingsSubPage
      title={t('developer.title')}
      backLabel={t('settings.title')}
      onBack={() => navigate({ to: '/settings' })}
      testid="developer-page"
      topbarTestid="developer-topbar"
      backTestid="developer-back"
      scrollTestid="developer-scroll"
    >
      <DevServerSection />
      <DebugTunnelSection />
    </SettingsSubPage>
  );
}
