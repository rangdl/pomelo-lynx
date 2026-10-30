import { useState } from '@lynx-js/react';
import { useNavigate } from '@tanstack/react-router';

import {
  readBundleDisplayVersion,
  readClientIdentity,
} from '../../core/config/client-identity.js';
import { clientBuild } from '../../core/config/constants.js';
import { t } from '../../i18n/index.js';
import { readLynxGlobal } from '../../native/native-modules.js';
import { setClipboard } from '../../native/platform.js';
import { isWebPlatform } from '../../native/web-platform.js';
import { PageTopBar } from '../../shared/layouts/PageTopBar.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import {
  SettingsGroup,
  SettingsGroupDivider,
} from '../../shared/ui/SettingsGroup.js';
import { BundleUpdateSection } from './BundleUpdateSection.js';
import { ClientReleaseSection } from './ClientReleaseSection.js';
import './settings.css';

/**
 * 关于页:壳身份信息 + 客户端更新 + Bundle 热更新。
 * Web 端只提示“随部署更新”;原生端两条更新链路分开显示。
 */
export function AboutPage() {
  const navigate = useNavigate();
  const [copyState, setCopyState] = useState<string | null>(null);
  const props: Record<string, unknown> = readLynxGlobal()?.__globalProps ?? {};
  const hostName =
    typeof props.hostName === 'string' ? props.hostName : 'pomelo-host';
  const client = readClientIdentity();
  const bundleVersion = readBundleDisplayVersion();
  const web = isWebPlatform();
  const versionInfo = [
    `client=${client.display_version}`,
    `bundle=${bundleVersion}`,
    `channel=${client.channel}`,
    `commit=${client.git_commit}`,
    `host=${hostName}`,
  ].join(' ');

  const copyVersionInfo = () => {
    'background only';
    void setClipboard(versionInfo).then(
      () => setCopyState(t('about.copied')),
      () => setCopyState(t('about.copyFailed')),
    );
  };

  return (
    <view className="settings" data-testid="about-page">
      <PageTopBar
        title={t('about.title')}
        backLabel={t('about.back')}
        onBack={() => navigate({ to: '/settings' })}
        testid="about-topbar"
        backTestid="about-back"
      />

      <scroll-view className="settings__scroll" scroll-orientation="vertical">
        <SettingsGroup>
          <ListRow
            icon={<text className="list-row__icon-text">⌂</text>}
            iconColor="#3b82f6"
            label={t('about.client')}
            value={client.display_version}
            detail={`${client.display_version} · ${client.git_commit}`}
          />
          <SettingsGroupDivider />
          <ListRow
            icon={<text className="list-row__icon-text">#</text>}
            iconColor="#8e8e93"
            label={t('about.bundleVersion')}
            value={bundleVersion}
            detail={`${clientBuild.channel} · ${clientBuild.git_commit}`}
          />
          <SettingsGroupDivider />
          <ListRow
            icon={<text className="list-row__icon-text">⧉</text>}
            iconColor="#5a5ad6"
            label={t('about.copy')}
            value={copyState ?? undefined}
            chevron={!copyState}
            onTap={copyVersionInfo}
            testid="about-row-copy"
          />
        </SettingsGroup>

        {web ? (
          <SettingsGroup title={t('about.group.update')}>
            <ListRow
              icon={<text className="list-row__icon-text">↻</text>}
              iconColor="#0ea5e9"
              label={t('about.webUpdate')}
            />
          </SettingsGroup>
        ) : (
          <>
            <SettingsGroup title={t('about.group.clientUpdate')}>
              <ClientReleaseSection />
            </SettingsGroup>
            <SettingsGroup title={t('about.group.bundleUpdate')}>
              <BundleUpdateSection showTitle={false} />
            </SettingsGroup>
          </>
        )}

        <view className="settings__tail" />
      </scroll-view>
    </view>
  );
}
