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
import {
  bundleReasonText,
  updateErrorText,
} from '../../shared/errors/error-text.js';
import { Hint } from '../../shared/ui/Hint.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import { SettingsGroupDivider } from '../../shared/ui/SettingsGroup.js';
import { SwitchRow } from '../../shared/ui/SwitchRow.js';
import './BundleUpdateSection.css';

/**
 * Bundle 热更新区:通道、自动更新开关、手动检查、下载进度、恢复内置。
 * 与 native 客户端更新(IPA/APK)是两条独立链路。
 */
export function BundleUpdateSection() {
  const [session, setSession] = useState(updateSession.getState());
  const [automatic, setAutomatic] = useState(
    automaticUpdatePolicy.store.getState(),
  );
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const web = isWebPlatform();
  const native = !web && nativeUpdaterAvailable();
  const available = web || nativeUpdateMetadataAvailable();
  const { checking, check } = session;
  const error = session.checkError ? updateErrorText(session.checkError) : null;
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
  const taskError = session.error ? updateErrorText(session.error) : null;

  return (
    <view className="client-update" data-testid="client-update-section">
      <ListRow
        iconGlyph="⇄"
        iconTone="sky"
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
        <Hint tone="muted">{updateErrorText('metadata_unavailable')}</Hint>
      ) : null}

      {native ? (
        <>
          <SettingsGroupDivider />
          <SwitchRow
            iconGlyph="↻"
            iconTone="green"
            label="自动检查更新"
            detail="启动时自动检查并下载更新"
            checked={automatic.enabled}
            onChange={changeAutomatic}
            testid="client-update-automatic"
            switchTestid="client-update-automatic-switch"
          />
        </>
      ) : null}

      <SettingsGroupDivider />
      <ListRow
        iconGlyph="⟳"
        iconTone="blue"
        label={checking ? '正在检查…' : '检查更新'}
        detail="手动检查并下载新版本"
        disabled={busy || !available}
        onTap={startCheck}
        testid="client-update-check"
      />

      {error ? (
        <Hint tone="error" testid="client-update-error">
          {error}
        </Hint>
      ) : null}

      {check ? (
        <>
          <SettingsGroupDivider />
          <ListRow
            iconGlyph="i"
            iconTone="neutral"
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
                iconGlyph="↓"
                iconTone="blue"
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
            <Hint tone="muted">
              {bundleReasonText(check.bundleReason ?? '')}
            </Hint>
          ) : null}
        </>
      ) : null}

      {progress &&
      (session.operation === 'download' || session.native?.download) ? (
        <>
          <SettingsGroupDivider />
          <Hint tone="muted" testid="client-update-progress">
            {`正在下载 ${
              progress.total > 0
                ? `${Math.floor((progress.bytes * 100) / progress.total)}%`
                : '…'
            }`}
          </Hint>
          <ListRow
            iconGlyph="×"
            iconTone="danger"
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
            iconGlyph="⌛"
            iconTone="orange"
            label="待生效更新"
            value={pending.version}
            detail={pending.git_commit}
            testid="client-update-pending"
          />
        </>
      ) : null}

      {session.restored ? (
        <Hint tone="muted">已恢复内置版本,下次冷启动生效</Hint>
      ) : null}
      {taskError ? <Hint tone="error">{taskError}</Hint> : null}
      {['rollback_unconfirmed', 'startup_failed'].includes(
        session.native?.last_error ?? '',
      ) ? (
        <Hint tone="muted">上次启动未确认,已回退到此前版本</Hint>
      ) : null}

      {showRestore && !session.restored ? (
        <>
          <SettingsGroupDivider />
          <ListRow
            iconGlyph="⟲"
            iconTone="danger"
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
