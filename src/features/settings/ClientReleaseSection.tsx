import { useState } from '@lynx-js/react';

import { readClientIdentity } from '../../core/config/client-identity.js';
import {
  type ClientReleaseCheck,
  checkClientRelease,
} from '../../core/updater/client-release.js';
import { releasePage } from '../../core/updater/release-resolver.js';
import { readUpdateProxy } from '../../core/updater/update-preferences.js';
import { t } from '../../i18n/index.js';
import { openTrollStoreInstall, openURL } from '../../native/platform.js';
import {
  isIosPlatform,
  isWebPlatform,
  platformName,
} from '../../native/web-platform.js';
import { Hint } from '../../shared/ui/Hint.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import { SettingsGroupDivider } from '../../shared/ui/SettingsGroup.js';
import './ClientReleaseSection.css';

function clientErrorText(error: string): string {
  const known: Record<string, string> = {
    client_metadata_missing: '此版本未提供客户端更新信息',
    release_unpublished: '发布尚未公开',
    release_rate_limited: '请求过于频繁,请稍后再试',
    metadata_failed: '无法读取发布信息',
    metadata_too_large: '发布信息过大',
    invalid_release: '发布信息无效',
    invalid_update_proxy: '更新代理地址无效',
    update_channel_unsupported: '当前通道不支持客户端更新检查',
    update_unavailable: '当前宿主不支持更新检查',
    open_url_failed: '无法打开链接',
    trollstore_unavailable: '未检测到 TrollStore,请先安装或打开下载页',
  };
  return known[error] ?? '检查失败,请稍后再试';
}

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function statusText(check: ClientReleaseCheck): string {
  if (check.comparison === 'newer') return t('about.clientUpdateAvailable');
  if (check.comparison === 'current') return t('about.clientUpToDate');
  return t('about.clientUpdateUnknown');
}

/**
 * native 客户端更新区:检查 IPA/APK 版本、展示变更,并提供 GitHub 与
 * 国内加速两个下载入口。iOS 不自动安装,只交给系统浏览器下载。
 */
export function ClientReleaseSection() {
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ClientReleaseCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = isWebPlatform();
  const ios = isIosPlatform();
  const android = platformName() === 'android';
  const releaseURL =
    check?.releasePage ?? releasePage(readClientIdentity().channel);

  const startCheck = () => {
    'background only';
    if (checking) return;
    setChecking(true);
    setError(null);
    void (async () => {
      try {
        const proxy = await readUpdateProxy();
        setCheck(await checkClientRelease({ proxy, force: true }));
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setChecking(false);
      }
    })();
  };

  const open = (url: string | null) => {
    'background only';
    if (!url) return;
    if (!openURL(url)) setError('open_url_failed');
  };

  if (web) return null;

  const asset = check?.asset ?? null;
  const changes = check?.changes.slice(0, 8) ?? [];
  // 代理开启时优先打开加速地址;关闭或地址非法时回退 GitHub 原始地址。
  const downloadURL =
    check?.acceleratedDownloadURL ?? check?.downloadURL ?? null;

  return (
    <view className="client-release" data-testid="client-release-section">
      <ListRow
        iconGlyph="⟳"
        iconTone="blue"
        label={
          checking ? t('about.checkingClient') : t('about.checkClientUpdate')
        }
        detail={t('about.checkClientUpdateDetail')}
        disabled={checking}
        onTap={startCheck}
        testid="client-release-check"
      />

      {check ? (
        <>
          <SettingsGroupDivider />
          <ListRow
            iconGlyph="i"
            iconTone="neutral"
            label={statusText(check)}
            value={check.candidate.display_version}
            detail={check.candidate.git_commit}
            testid="client-release-status"
          />
          {changes.length > 0 ? (
            <view
              className="client-release__changes"
              data-testid="client-release-changes"
            >
              <text className="client-release__changes-title">
                {t('about.changes')}
              </text>
              {changes.map((change, index) => (
                <view
                  className="client-release__change"
                  key={`${index}-${change}`}
                >
                  <text className="client-release__change-dot">•</text>
                  <text className="client-release__change-text">{change}</text>
                </view>
              ))}
            </view>
          ) : null}
        </>
      ) : null}

      {check && asset && downloadURL ? (
        <>
          <SettingsGroupDivider />
          <ListRow
            iconGlyph="↓"
            iconTone="blue"
            label={t('about.openDownload')}
            detail={`${asset.name} · ${sizeText(asset.size)} · ${
              check.accelerator ? t('about.viaProxy') : t('about.directGithub')
            }`}
            chevron
            onTap={() => open(downloadURL)}
            testid="client-release-download"
          />
          {ios ? (
            <>
              <SettingsGroupDivider />
              <ListRow
                iconGlyph="◆"
                iconTone="green"
                label="用 TrollStore 安装"
                detail="需要设备已安装 TrollStore，并在设置中启用 URL Scheme"
                chevron
                onTap={() => {
                  'background only';
                  if (!openTrollStoreInstall(downloadURL))
                    setError('trollstore_unavailable');
                }}
                testid="client-release-trollstore"
              />
            </>
          ) : null}
        </>
      ) : null}

      {check && !asset && check.comparison === 'newer' ? (
        <Hint tone="muted">
          {ios
            ? '此版本没有 iOS 安装包'
            : android
              ? '此版本没有 Android 安装包'
              : '此版本没有当前平台的安装包'}
        </Hint>
      ) : null}

      {error ? (
        <Hint tone="error" testid="client-release-error">
          {clientErrorText(error)}
        </Hint>
      ) : null}

      {releaseURL ? (
        <>
          <SettingsGroupDivider />
          <ListRow
            iconGlyph="↗"
            iconTone="red"
            label={t('about.release')}
            detail="github.com/rangdl/pomelo-lynx"
            chevron
            onTap={() => open(releaseURL)}
            testid="about-row-release"
          />
        </>
      ) : null}

      {ios ? (
        <Hint tone="muted">
          iOS 会先下载到「文件」，无法直接点击安装；请使用 TrollStore
          或自行重签。使用代理更新时下载地址会走加速地址，否则走 GitHub
          原始地址。
        </Hint>
      ) : null}
    </view>
  );
}
