import { useEffect, useState } from '@lynx-js/react';
import { useNavigate } from '@tanstack/react-router';

import { trimCurrentMediaQueue } from '../../core/media/player.js';
import {
  DEFAULT_MEDIA_SETTINGS,
  loadMediaSettings,
  PAGE_SIZE_MAX,
  PAGE_SIZE_MIN,
  QUEUE_LIMIT_MAX,
  QUEUE_LIMIT_MIN,
  saveMediaSettings,
} from '../../core/media/settings.js';
import { t } from '../../i18n/index.js';
import { SettingsSubPage } from '../../shared/layouts/SettingsSubPage.js';
import { Button } from '../../shared/ui/Button.js';
import { Hint } from '../../shared/ui/Hint.js';
import { SettingsGroup } from '../../shared/ui/SettingsGroup.js';
import { TextField } from '../../shared/ui/TextField.js';
import './PlaybackSettingsPage.css';

function parseSetting(raw: string): number | null {
  const value = Number(raw.trim());
  return Number.isFinite(value) ? Math.round(value) : null;
}

/** 播放设置：队列上限、歌曲分页条数。 */
export function PlaybackSettingsPage() {
  const navigate = useNavigate();
  const [queueLimit, setQueueLimit] = useState('');
  const [pageSize, setPageSize] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const settings = await loadMediaSettings();
        if (!alive) return;
        setQueueLimit(String(settings.queueLimit));
        setPageSize(String(settings.pageSize));
        setFormKey((value) => value + 1);
      } catch {
        if (alive) setError('读取播放设置失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async (nextQueue = queueLimit, nextPage = pageSize) => {
    'background only';
    if (busy || loading) return;
    const queue = parseSetting(nextQueue);
    const page = parseSetting(nextPage);
    if (queue === null || queue < QUEUE_LIMIT_MIN || queue > QUEUE_LIMIT_MAX) {
      setError(`队列上限需要是 ${QUEUE_LIMIT_MIN}–${QUEUE_LIMIT_MAX} 的整数`);
      return;
    }
    if (page === null || page < PAGE_SIZE_MIN || page > PAGE_SIZE_MAX) {
      setError(`每页歌曲数需要是 ${PAGE_SIZE_MIN}–${PAGE_SIZE_MAX} 的整数`);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveMediaSettings({
        queueLimit: queue,
        pageSize: page,
      });
      trimCurrentMediaQueue();
      setQueueLimit(String(saved.queueLimit));
      setPageSize(String(saved.pageSize));
      setFormKey((value) => value + 1);
      setNotice('播放设置已保存');
    } catch {
      setError('保存播放设置失败');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    'background only';
    setQueueLimit(String(DEFAULT_MEDIA_SETTINGS.queueLimit));
    setPageSize(String(DEFAULT_MEDIA_SETTINGS.pageSize));
    void save(
      String(DEFAULT_MEDIA_SETTINGS.queueLimit),
      String(DEFAULT_MEDIA_SETTINGS.pageSize),
    );
  };

  return (
    <SettingsSubPage
      title={t('playback.title')}
      backLabel={t('playback.back')}
      onBack={() => navigate({ to: '/settings' })}
      testid="playback-settings-page"
      topbarTestid="playback-settings-topbar"
      backTestid="playback-settings-back"
    >
      <SettingsGroup title="播放队列">
        <view className="playback-settings__form">
          <TextField
            label="队列上限"
            value={queueLimit}
            onChange={setQueueLimit}
            onConfirm={() => save()}
            numeric
            disabled={busy || loading}
            hint={`${QUEUE_LIMIT_MIN}–${QUEUE_LIMIT_MAX} 首，默认 ${DEFAULT_MEDIA_SETTINGS.queueLimit}`}
            inputKey={`queue-limit-${formKey}`}
            testid="playback-queue-limit"
          />
        </view>
        <Hint tone="caption">
          超过上限时优先保留当前曲目，再丢弃最早加入的项目。
        </Hint>
      </SettingsGroup>

      <SettingsGroup title="歌曲分页">
        <view className="playback-settings__form">
          <TextField
            label="每页歌曲数"
            value={pageSize}
            onChange={setPageSize}
            onConfirm={() => save()}
            numeric
            disabled={busy || loading}
            hint={`${PAGE_SIZE_MIN}–${PAGE_SIZE_MAX} 首，默认 ${DEFAULT_MEDIA_SETTINGS.pageSize}`}
            inputKey={`page-size-${formKey}`}
            testid="playback-page-size"
          />
        </view>
        <Hint tone="caption">
          首页最近添加、歌单、搜索结果按这个条数分页加载。
        </Hint>
      </SettingsGroup>

      <view className="playback-settings__actions">
        <Button
          grow
          label={busy ? '保存中…' : '保存设置'}
          disabled={busy || loading}
          onTap={() => save()}
          testid="playback-save"
        />
        <Button
          grow
          variant="secondary"
          label="恢复默认"
          disabled={busy || loading}
          onTap={reset}
          testid="playback-reset"
        />
      </view>

      {loading ? <Hint tone="caption">正在读取设置…</Hint> : null}
      {error ? (
        <Hint tone="error" testid="playback-settings-error">
          {error}
        </Hint>
      ) : null}
      {notice ? (
        <Hint tone="muted" testid="playback-settings-notice">
          {notice}
        </Hint>
      ) : null}
    </SettingsSubPage>
  );
}
