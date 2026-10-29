import { useState } from '@lynx-js/react';
import { useNavigate } from '@tanstack/react-router';

import { clientBuild } from '../../core/config/constants.js';
import { releasePage } from '../../core/updater/release-resolver.js';
import { readLynxGlobal } from '../../native/native-modules.js';
import { openURL, setClipboard } from '../../native/platform.js';
import { isWebPlatform } from '../../native/web-platform.js';
import { PageTopBar } from '../../shared/layouts/PageTopBar.js';
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
      () => setCopyState('已复制'),
      () => setCopyState('复制失败'),
    );
  };

  return (
    <view className="settings" data-testid="about-page">
      <PageTopBar
        title="关于"
        backLabel="设置"
        onBack={() => navigate({ to: '/settings' })}
        testid="about-topbar"
        backTestid="about-back"
      />

      <scroll-view className="settings__scroll" scroll-orientation="vertical">
        <view className="settings-row">
          <text className="settings-row__label">宿主</text>
          <text className="settings-row__value">{hostName}</text>
        </view>
        <view className="settings-row">
          <text className="settings-row__label">Bundle 版本</text>
          <text className="settings-row__value">{clientBuild.version}</text>
        </view>
        {hostVersion ? (
          <view className="settings-row">
            <text className="settings-row__label">宿主版本</text>
            <text className="settings-row__value">{hostVersion}</text>
          </view>
        ) : null}

        <view
          className="settings-row"
          bindtap={copyVersionInfo}
          data-testid="about-row-copy"
        >
          <text className="settings-row__label">复制版本信息</text>
          <text className="settings-row__value">{copyState ?? '›'}</text>
        </view>
        {releaseUrl && !web ? (
          <view
            className="settings-row"
            bindtap={() => {
              'background only';
              openURL(releaseUrl);
            }}
            data-testid="about-row-release"
          >
            <text className="settings-row__label">打开发布页</text>
            <text className="settings-row__value">›</text>
          </view>
        ) : null}

        <view className="settings__section">
          {web ? (
            <view className="settings-row">
              <text className="settings-row__label">
                Web 端随部署更新,无独立热更新
              </text>
            </view>
          ) : (
            <ClientUpdateSection />
          )}
        </view>

        <view
          className="settings-row"
          bindtap={() => navigate({ to: '/settings/about/logs' })}
          data-testid="about-row-logs"
        >
          <text className="settings-row__label">日志</text>
          <text className="settings-row__value">›</text>
        </view>
        <view className="settings__tail" />
      </scroll-view>
    </view>
  );
}
