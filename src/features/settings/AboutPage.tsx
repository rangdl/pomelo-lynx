import { useNavigate } from '@tanstack/react-router';

import { readLynxGlobal } from '../../native/native-modules.js';
import { isWebPlatform } from '../../native/web-platform.js';
import './settings.css';

/**
 * 关于页:壳身份信息 + 客户端更新区。
 *
 * 阶段 1 范围:更新区只是占位(结构对齐 songloft 的 UpgradeSection),
 * 检查/下载/恢复内置在阶段 3 接入 `src/core/updater/`。Web 端不显示更新
 * 交互,只提示"随部署更新"。
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
      <view className="settings__header settings__header--with-back">
        <view
          className="settings__back"
          bindtap={() => navigate({ to: '/settings' })}
          data-testid="about-back"
        >
          <text className="settings__back-text">‹ 设置</text>
        </view>
        <text className="settings__title">关于</text>
      </view>

      <view className="settings-row">
        <text className="settings-row__label">宿主</text>
        <text className="settings-row__value">{hostName}</text>
      </view>
      {hostVersion ? (
        <view className="settings-row">
          <text className="settings-row__label">版本</text>
          <text className="settings-row__value">{hostVersion}</text>
        </view>
      ) : null}

      <view className="settings__section">
        <text className="settings__section-title">客户端更新</text>
        {web ? (
          <view className="settings-row">
            <text className="settings-row__label">
              Web 端随部署更新,无独立热更新
            </text>
          </view>
        ) : (
          <view className="settings-row" data-testid="upgrade-section">
            <text className="settings-row__label">检查更新</text>
            <text className="settings-row__value">即将上线</text>
          </view>
        )}
      </view>
    </view>
  );
}
