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
import { SettingsSubPage } from '../../shared/layouts/SettingsSubPage.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import {
  SettingsGroup,
  SettingsGroupDivider,
} from '../../shared/ui/SettingsGroup.js';
import { BundleUpdateSection } from './BundleUpdateSection.js';
import { ClientReleaseSection } from './ClientReleaseSection.js';
import { UpdateProxySection } from './UpdateProxySection.js';

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
    <SettingsSubPage
      title={t('about.title')}
      backLabel={t('about.back')}
      onBack={() => navigate({ to: '/settings' })}
      testid="about-page"
      topbarTestid="about-topbar"
      backTestid="about-back"
      scrollTestid="about-scroll"
    >
      <SettingsGroup>
        <ListRow
          iconGlyph="⌂"
          iconTone="azure"
          label={t('about.client')}
          value={client.display_version}
          detail={`${client.display_version} · ${client.git_commit}`}
        />
        <SettingsGroupDivider />
        <ListRow
          iconGlyph="#"
          iconTone="neutral"
          label={t('about.bundleVersion')}
          value={bundleVersion}
          detail={`${clientBuild.channel} · ${clientBuild.git_commit}`}
        />
        <SettingsGroupDivider />
        <ListRow
          iconGlyph="⧉"
          iconTone="indigo"
          label={t('about.copy')}
          value={copyState ?? undefined}
          chevron={!copyState}
          onTap={copyVersionInfo}
          testid="about-row-copy"
        />
      </SettingsGroup>

      {web ? (
        <SettingsGroup title={t('about.group.update')}>
          <ListRow iconGlyph="↻" iconTone="sky" label={t('about.webUpdate')} />
        </SettingsGroup>
      ) : (
        <>
          <SettingsGroup title={t('about.group.acceleration')}>
            <UpdateProxySection />
          </SettingsGroup>
          <SettingsGroup title={t('about.group.clientUpdate')}>
            <ClientReleaseSection />
          </SettingsGroup>
          <SettingsGroup title={t('about.group.bundleUpdate')}>
            <BundleUpdateSection />
          </SettingsGroup>
        </>
      )}
    </SettingsSubPage>
  );
}
