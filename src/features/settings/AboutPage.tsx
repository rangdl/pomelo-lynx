import { useNavigate } from '@tanstack/react-router';

import { clientBuild } from '../../core/config/constants.js';
import { readLynxGlobal } from '../../native/native-modules.js';
import { isWebPlatform } from '../../native/web-platform.js';
import { ClientUpdateSection } from './ClientUpdateSection.js';
import './settings.css';

/**
 * 关于页:壳身份信息 + 客户端更新区。
 * 更新区在 Web 端只提示"随部署更新";原生端为完整热更新交互。
 */
export function AboutPage() {
  const navigate = useNavigate();
  const props: Record<string, unknown> = readLynxGlobal()?.__globalProps ?? {};
  const hostName =
    typeof props.hostName === 'string' ? props.hostName : 'pomelo-host';
  const hostVersion =
    typeof props.hostVersion === 'string' ? props.hostVersion : '';
  const web = isWebPlatform();

  return (
    <view className="settings" data-testid="about-page">
      <view className="settings__navbar">
        <view
          className="settings__back"
          bindtap={() => navigate({ to: '/settings' })}
          data-testid="about-back"
        >
          <text className="settings__back-text">‹ 设置</text>
        </view>
        <text className="settings__nav-title">关于</text>
        <view className="settings__nav-spacer" />
      </view>

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
    </view>
  );
}
