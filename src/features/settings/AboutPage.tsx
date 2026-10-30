import { useState } from '@lynx-js/react';
import { useNavigate } from '@tanstack/react-router';

import { clientBuild } from '../../core/config/constants.js';
import { releasePage } from '../../core/updater/release-resolver.js';
import { t } from '../../i18n/index.js';
import { readLynxGlobal } from '../../native/native-modules.js';
import { openURL, setClipboard } from '../../native/platform.js';
import { isWebPlatform } from '../../native/web-platform.js';
import { PageTopBar } from '../../shared/layouts/PageTopBar.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import {
  SettingsGroup,
  SettingsGroupDivider,
} from '../../shared/ui/SettingsGroup.js';
import { ClientUpdateSection } from './ClientUpdateSection.js';
import './settings.css';

/**
 * 关于页:壳身份信息 + 客户端更新区。
 * 更新区在 Web 端只提示"随部署更新";原生端为完整热更新交互。
 */
export function AboutPage() {
  const navigate = useNavigate();
  const [copyState, setCopyState] = useState<string | null>(null);
  const props: Record<string, unknown> = readLynxGlobal()?.__globalProps ?? {};
  const hostName =
    typeof props.hostName === 'string' ? props.hostName : 'pomelo-host';
  const hostVersion =
    typeof props.hostVersion === 'string' ? props.hostVersion : '';
  const clientVersion =
    hostVersion || clientBuild.native_version || clientBuild.version;
  const web = isWebPlatform();
  const releaseUrl = releasePage(clientBuild.channel);
  const versionInfo = [
    `PomeloLynx ${clientBuild.version}`,
    `channel=${clientBuild.channel}`,
    `commit=${clientBuild.git_commit}`,
    `host=${hostName}`,
    ...(hostVersion ? [`hostVersion=${hostVersion}`] : []),
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
        <SettingsGroup title={t('about.group.app')}>
          <ListRow
            icon={<text className="list-row__icon-text">⌂</text>}
            iconColor="#3b82f6"
            label={t('about.client')}
            value={clientVersion}
            detail={`${hostName} · ${clientBuild.git_commit}`}
          />
          <SettingsGroupDivider />
          <ListRow
            icon={<text className="list-row__icon-text">#</text>}
            iconColor="#8e8e93"
            label={t('about.bundleVersion')}
            value={clientBuild.version}
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
          {releaseUrl && !web ? (
            <>
              <SettingsGroupDivider />
              <ListRow
                icon={<text className="list-row__icon-text">↗</text>}
                iconColor="#e5484d"
                label={t('about.release')}
                chevron
                onTap={() => {
                  'background only';
                  openURL(releaseUrl);
                }}
                testid="about-row-release"
              />
            </>
          ) : null}
        </SettingsGroup>

        <SettingsGroup title={t('about.group.update')}>
          {web ? (
            <ListRow
              icon={<text className="list-row__icon-text">↻</text>}
              iconColor="#0ea5e9"
              label={t('about.webUpdate')}
            />
          ) : (
            <ClientUpdateSection showTitle={false} />
          )}
        </SettingsGroup>

        <SettingsGroup title={t('about.group.support')}>
          <ListRow
            icon={<text className="list-row__icon-text">≡</text>}
            iconColor="#6b7280"
            label={t('about.logs')}
            chevron
            onTap={() => navigate({ to: '/settings/about/logs' })}
            testid="about-row-logs"
          />
        </SettingsGroup>
        <view className="settings__tail" />
      </scroll-view>
    </view>
  );
}
