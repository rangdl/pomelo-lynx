import { useCallback, useEffect, useMemo, useState } from '@lynx-js/react';
import { useNavigate } from '@tanstack/react-router';

import {
  fetchLevel,
  fetchRecent,
  fetchRetentionDays,
  filterEntries,
  hasNativeLog,
  LOG_LEVELS,
  logger,
  loggerCore,
  setPushEnabled,
  shareRecent,
  storeLevel,
  storeRetentionDays,
  subscribeLogAppend,
} from '../../core/log/index.js';
import type { LogLevelName } from '../../core/log/levels.js';
import { levelLetter, levelName } from '../../core/log/levels.js';
import type { LogEntry } from '../../core/log/types.js';
import { t } from '../../i18n/index.js';
import { PageTopBar } from '../../shared/layouts/PageTopBar.js';
import { PageTail } from '../../shared/layouts/SettingsSubPage.js';
import { Button } from '../../shared/ui/Button.js';
import { Hint } from '../../shared/ui/Hint.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import {
  SettingsGroup,
  SettingsGroupDivider,
} from '../../shared/ui/SettingsGroup.js';
import { SwitchRow } from '../../shared/ui/SwitchRow.js';
import './LogsPage.css';

/**
 * 日志页(/settings/logs)。
 *
 * 数据流:挂载时先订阅(本地 core + 原生推送 `PomeloLog.append`),再打开推送
 * 开关,最后拉一次 `getRecent` 快照补齐历史——三路来源按 `entryId` 合并去重,
 * 不存在轮询。卸载时关推送并退订。
 *
 * Web 端没有原生模块:列表就是当前 realm 的 `loggerCore`(天然实时),设置区
 * 只保留显示级别与跟随开关,导出隐藏。
 */

const DISPLAY_LIMIT = 300;
const SNAPSHOT_LIMIT = 500;
const RETENTION_OPTIONS = [1, 7, 30, 90];

const LEVEL_LABELS: Record<LogLevelName, string> = {
  verbose: '详细',
  debug: '调试',
  info: '信息',
  warn: '警告',
  error: '错误',
};

function toLevelName(value: string): LogLevelName {
  return (LOG_LEVELS as readonly string[]).includes(value)
    ? (value as LogLevelName)
    : 'debug';
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** `14:50:01.234` — the file-side date part is dropped, rows are same-day mostly. */
function formatTime(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function LogsPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<readonly LogEntry[]>(() =>
    loggerCore.getAll(),
  );
  const [displayLevel, setDisplayLevel] = useState<LogLevelName>('info');
  const [storageLevel, setStorageLevel] = useState<LogLevelName>('debug');
  const [retention, setRetention] = useState(7);
  const [native, setNative] = useState(false);
  const [follow, setFollow] = useState(true);
  const [scrollTick, setScrollTick] = useState(0);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    const nativeAvailable = hasNativeLog();
    setNative(nativeAvailable);

    const unsubscribeCore = loggerCore.subscribe((all) => setEntries(all));
    const unsubscribePush = subscribeLogAppend((incoming) => {
      loggerCore.ingest(incoming);
    });

    if (nativeAvailable) {
      // Order matters: listener attached above, then the push gate opens, so
      // nothing produced between subscribe and snapshot is lost (the snapshot
      // and the push may overlap — `entryId` merge dedupes).
      setPushEnabled(true);
      void fetchRecent(SNAPSHOT_LIMIT).then((snapshot) => {
        if (snapshot.length > 0) loggerCore.ingest(snapshot);
      });
      void fetchLevel().then((name) => setStorageLevel(toLevelName(name)));
      void fetchRetentionDays().then((days) => setRetention(days));
    }

    logger.info('logs', 'log page opened');

    return () => {
      unsubscribePush();
      unsubscribeCore();
      if (nativeAvailable) setPushEnabled(false);
    };
  }, []);

  const rows = useMemo(
    () => filterEntries(entries, displayLevel, DISPLAY_LIMIT),
    [entries, displayLevel],
  );

  // Auto-follow: nudge the scroll position past the content once per append.
  // scroll-top is the default-path prop form; out-of-range values clamp to the
  // bottom, and the tick parity makes the prop change on every batch.
  useEffect(() => {
    if (!follow || rows.length === 0) return;
    setScrollTick((tick) => tick + 1);
  }, [rows.length, follow]);
  const scrollTop = scrollTick % 2 === 0 ? 999999 : 1000000;

  const cycleDisplayLevel = useCallback(() => {
    setDisplayLevel((prev) => {
      const index = LOG_LEVELS.indexOf(prev);
      return LOG_LEVELS[(index + 1) % LOG_LEVELS.length] ?? 'info';
    });
  }, []);

  const cycleStorageLevel = useCallback(() => {
    const index = LOG_LEVELS.indexOf(storageLevel);
    const next = LOG_LEVELS[(index + 1) % LOG_LEVELS.length];
    if (!next) return;
    void storeLevel(next).then((saved) => {
      const level = toLevelName(saved);
      setStorageLevel(level);
      logger.info('logs', `storage level → ${level}`);
    });
  }, [storageLevel]);

  const cycleRetention = useCallback(() => {
    const index = RETENTION_OPTIONS.indexOf(retention);
    const next = RETENTION_OPTIONS[(index + 1) % RETENTION_OPTIONS.length];
    if (!next) return;
    void storeRetentionDays(next).then((saved) => {
      setRetention(saved);
      logger.info('logs', `retention → ${saved}d`);
    });
  }, [retention]);

  const share = useCallback(() => {
    if (sharing) return;
    setSharing(true);
    shareRecent(SNAPSHOT_LIMIT).then(
      () => setSharing(false),
      () => setSharing(false),
    );
  }, [sharing]);

  return (
    <view className="logs" data-testid="logs-page">
      <PageTopBar
        title={t('logs.title')}
        backLabel={t('logs.back')}
        onBack={() => navigate({ to: '/settings' })}
        testid="logs-topbar"
        backTestid="logs-back"
      />
      <text className="logs__summary">
        {entries.length} 条 / 显示 {rows.length}
      </text>

      <SettingsGroup title="日志设置">
        <ListRow
          label="显示级别"
          value={`${LEVEL_LABELS[displayLevel]} · ${displayLevel}`}
          chevron
          onTap={cycleDisplayLevel}
          testid="logs-level-display"
        />
        {native ? (
          <>
            <SettingsGroupDivider />
            <ListRow
              label="存储级别"
              value={`${LEVEL_LABELS[storageLevel]} · ${storageLevel}`}
              chevron
              onTap={cycleStorageLevel}
              testid="logs-level-storage"
            />
            <SettingsGroupDivider />
            <ListRow
              label="保存天数"
              value={`${retention} 天`}
              chevron
              onTap={cycleRetention}
              testid="logs-retention"
            />
          </>
        ) : null}
        <SettingsGroupDivider />
        <SwitchRow
          label="自动跟随新日志"
          checked={follow}
          onChange={setFollow}
          testid="logs-follow"
          switchTestid="logs-follow-switch"
        />
      </SettingsGroup>

      {native ? (
        <view className="logs__share">
          <Button
            grow
            label={sharing ? '正在导出…' : '导出日志'}
            variant="secondary"
            disabled={sharing}
            onTap={share}
            testid="logs-share"
          />
        </view>
      ) : (
        <Hint tone="caption">Web 端日志仅保存在当前会话内存中</Hint>
      )}

      <scroll-view
        className="logs__list"
        scroll-orientation="vertical"
        scroll-top={scrollTop}
        data-testid="logs-list"
      >
        {rows.length === 0 ? (
          <view className="logs__empty">
            <text className="logs__empty-text">暂无日志</text>
          </view>
        ) : (
          rows.map((entry) => (
            <view
              className="logs__row"
              key={entry.entryId}
              data-testid="logs-row"
            >
              <text className="logs__time">{formatTime(entry.ts)}</text>
              <text
                className={`logs__level logs__level--${levelName(entry.level)}`}
              >
                {levelLetter(entry.level)}
              </text>
              <text className="logs__tag">{entry.tag}</text>
              <text className="logs__msg">{entry.msg}</text>
            </view>
          ))
        )}
        <PageTail />
      </scroll-view>
    </view>
  );
}
