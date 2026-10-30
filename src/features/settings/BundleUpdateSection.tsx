import { useEffect, useState } from '@lynx-js/react';
import { automaticUpdatePolicy } from '../../core/updater/automatic-update-policy.js';
import { updateIdentity } from '../../core/updater/client-updates.js';
import {
  nativeUpdateMetadataAvailable,
  nativeUpdaterAvailable,
} from '../../core/updater/native-updater.js';
import {
  cancelClientBundle,
  checkClientRelease,
  downloadClientBundle,
  refreshUpdateSession,
  restoreClientBuiltin,
  updateSession,
} from '../../core/updater/update-session.js';
import { isWebPlatform } from '../../native/web-platform.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import { SettingsGroupDivider } from '../../shared/ui/SettingsGroup.js';
import './BundleUpdateSection.css';

function errorText(error: string): string {
  const known: Record<string, string> = {
    release_rate_limited: '请求过于频繁,请稍后再试',
    release_unpublished: '发布尚未公开',
    release_missing_asset: '发布缺少必要资产',
    release_changed: '发布在读取过程中发生了变化',
    metadata_unavailable: '此版本不支持安全元数据读取,请安装新版安装包',
    update_channel_unsupported: '更新通道不受支持',
    insufficient_space: '剩余空间不足',
    cancelled: '已取消',
    checksum_mismatch: '下载内容校验失败',
    invalid_release: '发布信息无效',
  };
  return known[error] ?? '操作失败,请稍后再试';
}

function reasonText(reason: string): string {
  const known: Record<string, string> = {
    unavailable: '热更新不可用,请安装完整安装包',
    signing_key: '此安装包未配置受信签名密钥,无法热更新',
    signature_missing: '发布未包含签名,无法热更新',
    signature_invalid: '签名校验失败',
  };
  return known[reason] ?? '此更新与当前宿主不兼容,请安装完整安装包';
}

/**
 * Bundle 热更新区:通道、自动更新开关、手动检查、下载进度、恢复内置。
 * 与 native 客户端更新(IPA/APK)是两条独立链路。
 */
export function BundleUpdateSection({
  showTitle = true,
}: {
  showTitle?: boolean;
} = {}) {
  const [session, setSession] = useState(updateSession.getState());
  const [automatic, setAutomatic] = useState(
    automaticUpdatePolicy.store.getState(),
  );
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const web = isWebPlatform();
  const native = !web && nativeUpdaterAvailable();
  const available = web || nativeUpdateMetadataAvailable();
  const { checking, check } = session;
  const error = session.checkError ? errorText(session.checkError) : null;
  const identity = updateIdentity(session.native);

  const busy =
    checking || session.operation !== null || !!session.native?.download;

  useEffect(() => {
    const unsubscribe = updateSession.subscribe(setSession);
    setSession(updateSession.getState());
    void refreshUpdateSession();
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!native) return;
    const unsubscribe = automaticUpdatePolicy.store.subscribe(setAutomatic);
    setAutomatic(automaticUpdatePolicy.store.getState());
    void automaticUpdatePolicy.hydrate();
    return unsubscribe;
  }, [native]);
  useEffect(() => {
    if (!session.native?.download || session.operation) return;
    const timer = setInterval(() => {
      void refreshUpdateSession();
    }, 2000);
    return () => clearInterval(timer);
  }, [session.native?.download?.task_id, session.operation]);

  const startCheck = () => {
    'background only';
    if (!busy) void checkClientRelease({ force: true }).catch(() => {});
  };
  const changeAutomatic = (enabled: boolean) => {
    'background only';
    void automaticUpdatePolicy.setEnabled(enabled);
  };
  const restore = () => {
    if (!restoreConfirm) setRestoreConfirm(true);
    else {
      setRestoreConfirm(false);
      void restoreClientBuiltin();
    }
  };

  const pending = session.native?.pending;
  const progress = session.progress ?? session.native?.download;
  const showRestore =
    native &&
    !!session.native &&
    (session.native.running.kind !== 'builtin' ||
      !!pending ||
      !!session.native.active);
  const taskError = session.error ? errorText(session.error) : null;

  return (
    <view className="client-update" data-testid="client-update-section">
      {showTitle ? (
        <text className="client-update__section-title">Bundle 热更新</text>
      ) : null}

      <ListRow
        icon={<text className="list-row__icon-text">⇄</text>}
        iconColor="#0ea5e9"
        label="通道"
        value={
          identity.channel === 'dev'
            ? 'dev(跟随每次构建)'
            : identity.channel === 'stable'
              ? 'stable(正式发版)'
              : '不受支持'
        }
      />

      {!available && !web ? (
        <text className="client-update__note">
          {errorText('metadata_unavailable')}
        </text>
      ) : null}

      {native ? (
        <>
          <SettingsGroupDivider />
          <ListRow
            icon={<text className="list-row__icon-text">↻</text>}
            iconColor="#34c759"
            label="自动检查更新"
            detail="启动时自动检查并下载更新"
            testid="client-update-automatic"
            trailing={
              <view
                className="client-update__switch-hit"
                bindtap={() => {
                  'background only';
                  changeAutomatic(!automatic.enabled);
                }}
                accessibility-element={true}
                accessibility-label="自动检查更新"
                accessibility-traits="button"
                data-testid="client-update-automatic-switch"
              >
                <view
                  className={
                    automatic.enabled
                      ? 'client-update__switch client-update__switch--on'
                      : 'client-update__switch'
                  }
                >
                  <view className="client-update__switch-thumb" />
                </view>
              </view>
            }
          />
        </>
      ) : null}

      <SettingsGroupDivider />
      <ListRow
        icon={<text className="list-row__icon-text">⟳</text>}
        iconColor="#007aff"
        label={checking ? '正在检查…' : '检查更新'}
        detail="手动检查并下载新版本"
        disabled={busy || !available}
        onTap={startCheck}
        testid="client-update-check"
      />

      {error ? (
        <text
          className="client-update__error"
          data-testid="client-update-error"
        >
          {error}
        </text>
      ) : null}

      {check ? (
        <>
          <SettingsGroupDivider />
          <ListRow
            icon={<text className="list-row__icon-text">i</text>}
            iconColor="#8e8e93"
            label={
              check.comparison === 'newer'
                ? '有新版本'
                : check.comparison === 'current'
                  ? '已是最新'
                  : '无法确定'
            }
            value={check.candidate.manifest.version}
            detail={check.candidate.manifest.git_commit}
          />
          {check.comparison === 'newer' &&
          check.bundleURL &&
          !pending &&
          !session.restored ? (
            <>
              <SettingsGroupDivider />
              <ListRow
                icon={<text className="list-row__icon-text">↓</text>}
                iconColor="#007aff"
                label="下载更新"
                detail="下次冷启动生效"
                onTap={() => {
                  'background only';
                  void downloadClientBundle(check);
                }}
                testid="client-update-download"
              />
            </>
          ) : null}
          {check.comparison === 'newer' && !check.bundleURL && !web ? (
            <text className="client-update__note">
              {reasonText(check.bundleReason ?? '')}
            </text>
          ) : null}
        </>
      ) : null}

      {progress &&
      (session.operation === 'download' || session.native?.download) ? (
        <>
          <SettingsGroupDivider />
          <text
            className="client-update__note"
            data-testid="client-update-progress"
          >
            正在下载{' '}
            {progress.total > 0
              ? `${Math.floor((progress.bytes * 100) / progress.total)}%`
              : '…'}
          </text>
          <ListRow
            icon={<text className="list-row__icon-text">×</text>}
            iconColor="#d93025"
            danger
            label="取消下载"
            onTap={cancelClientBundle}
            testid="client-update-cancel"
          />
        </>
      ) : null}

      {pending ? (
        <>
          <SettingsGroupDivider />
          <ListRow
            icon={<text className="list-row__icon-text">⌛</text>}
            iconColor="#f59e0b"
            label="待生效更新"
            value={pending.version}
            detail={pending.git_commit}
            testid="client-update-pending"
          />
        </>
      ) : null}

      {session.restored ? (
        <text className="client-update__note">
          已恢复内置版本,下次冷启动生效
        </text>
      ) : null}
      {taskError ? (
        <text className="client-update__error">{taskError}</text>
      ) : null}
      {['rollback_unconfirmed', 'startup_failed'].includes(
        session.native?.last_error ?? '',
      ) ? (
        <text className="client-update__note">
          上次启动未确认,已回退到此前版本
        </text>
      ) : null}

      {showRestore && !session.restored ? (
        <>
          <SettingsGroupDivider />
          <ListRow
            icon={<text className="list-row__icon-text">⟲</text>}
            iconColor="#d93025"
            danger
            label={restoreConfirm ? '再次点击确认恢复内置' : '恢复内置版本'}
            onTap={restore}
            testid="client-update-restore"
          />
        </>
      ) : null}
    </view>
  );
}
