import { useEffect, useRef, useState } from '@lynx-js/react';

import { logger } from '../../core/log/index.js';
import { getPomeloStorage } from '../../core/storage/index.js';
import {
  applyDevServer,
  clearDevServer,
  type DevServerProbe,
  hasDevServerControl,
  probeDevServer,
  reloadBundle,
} from '../../native/platform.js';
import { Button } from '../../shared/ui/Button.js';
import { Hint } from '../../shared/ui/Hint.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import {
  SettingsGroup,
  SettingsGroupDivider,
} from '../../shared/ui/SettingsGroup.js';
import { TextField } from '../../shared/ui/TextField.js';
import './DevServerSection.css';

const PREF_KEY = 'dev_server_url';
const POLL_INTERVAL_MS = 3000;

function validate(url: string): string | null {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'URL 必须以 http:// 或 https:// 开头';
  }
  if (!url.split(/[?#]/)[0]?.endsWith('.lynx.bundle')) {
    return 'URL 必须指向 .lynx.bundle 文件';
  }
  return null;
}

function friendlyMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  switch (message) {
    case 'devserver_unsupported':
      return '当前客户端不支持热重载,请安装最新 IPA';
    case 'devserver_invalid_url':
      return 'URL 必须以 http(s):// 开头并指向 .lynx.bundle';
    case 'platform_timeout':
      return '下载超时,请检查服务器与网络';
    default:
      return message || '操作失败';
  }
}

function probeText(
  probe: DevServerProbe | null,
  checking: boolean,
  supported: boolean,
  current: string | null,
): string {
  if (!current) return '未配置';
  if (!supported) return '当前客户端不支持状态探测';
  if (checking && !probe) return '检查中…';
  if (!probe) return '检查中…';
  if (probe.ok) return `在线 · HTTP ${probe.status}`;
  if (probe.status > 0) return `离线 · HTTP ${probe.status}`;
  return `离线 · ${probe.error ?? '不可达'}`;
}

/**
 * 开发者区(dev channel):连接 rspeedy dev server 实时加载 bundle。
 *
 * 连接/刷新都先由原生完整下载并校验 bundle,成功后才重建 LynxView,
 * 因此不再需要冷启动;失败时当前页面保持不动。页面会每隔 3 秒发一次
 * 轻量 HEAD 探测,服务器重启恢复后自动重新下载并重载。
 *
 * URL 持久化在 prefs(`dev_server_url`),原生侧 ViewController 冷启动时
 * 读取并交给 HostTemplateProvider 的 http(s) 分支拉取。
 */
export function DevServerSection() {
  const [current, setCurrent] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState<DevServerProbe | null>(null);
  const [checking, setChecking] = useState(false);
  const [autoRecovered, setAutoRecovered] = useState(false);
  const previousOnline = useRef<boolean | null>(null);
  const busy = useRef(false);
  const supported = hasDevServerControl();

  useEffect(() => {
    let cancelled = false;
    getPomeloStorage()
      .prefs.get(PREF_KEY)
      .then((value) => {
        if (!cancelled) setCurrent(value || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!current || !supported) {
      previousOnline.current = null;
      setProbe(null);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (!alive) return;
      setChecking(true);
      probeDevServer(current)
        .then((next) => {
          if (!alive) return;
          setProbe(next);
          setChecking(false);
          const wasOnline = previousOnline.current;
          previousOnline.current = next.ok;
          if (wasOnline === false && next.ok && !busy.current) {
            logger.info('devserver', 'server recovered; reloading bundle');
            setAutoRecovered(true);
            setError(null);
            busy.current = true;
            setSaving(true);
            reloadBundle()
              .then(() => {
                if (alive) setSaving(false);
              })
              .catch((reason) => {
                if (!alive) return;
                // 下次探测仍在线时再试一次,直到下载校验成功。
                previousOnline.current = false;
                setError(friendlyMessage(reason));
                setSaving(false);
              })
              .finally(() => {
                busy.current = false;
              });
          }
        })
        .catch((reason) => {
          if (!alive) return;
          setChecking(false);
          setProbe({ ok: false, status: -1, error: friendlyMessage(reason) });
          previousOnline.current = false;
        });
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [current, supported]);

  const connect = () => {
    'background only';
    if (busy.current) return;
    const url = draft.trim();
    const problem = validate(url);
    if (problem) {
      setError(problem);
      return;
    }
    if (!supported) {
      setError('当前客户端不支持热重载,请安装最新 IPA');
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    applyDevServer(url)
      .then(() => {
        setCurrent(url);
        setDraft('');
        setProbe(null);
        previousOnline.current = null;
        logger.info('devserver', `applied ${url}; reloading`);
      })
      .catch((reason) => setError(friendlyMessage(reason)))
      .finally(() => {
        busy.current = false;
        setSaving(false);
      });
  };

  const refresh = () => {
    'background only';
    if (busy.current || !current || !supported) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    reloadBundle()
      .then(() => {
        logger.info('devserver', 'manual reload requested');
      })
      .catch((reason) => setError(friendlyMessage(reason)))
      .finally(() => {
        busy.current = false;
        setSaving(false);
      });
  };

  const disconnect = () => {
    'background only';
    if (busy.current || !current || !supported) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    clearDevServer()
      .then(() => {
        setCurrent(null);
        setDraft('');
        setProbe(null);
        setAutoRecovered(false);
        previousOnline.current = null;
        logger.info('devserver', 'cleared; reloading embedded bundle');
      })
      .catch((reason) => setError(friendlyMessage(reason)))
      .finally(() => {
        busy.current = false;
        setSaving(false);
      });
  };

  return (
    <SettingsGroup title="Dev Server" testid="dev-server-section">
      <ListRow
        iconGlyph="⌁"
        iconTone="sky"
        label="已配置来源"
        value={current ? 'dev server' : '内嵌 bundle'}
        detail={current ?? undefined}
        testid="dev-server-current"
      />
      <SettingsGroupDivider />
      <ListRow
        iconGlyph="◉"
        iconTone="blue"
        label="服务器状态"
        value={probeText(probe, checking, supported, current)}
        detail={
          current && supported ? '每 3 秒探测;服务器恢复后自动重载' : undefined
        }
        testid="dev-server-status"
      />
      <SettingsGroupDivider />
      <view className="dev-server__form">
        <TextField
          value={draft}
          onChange={setDraft}
          placeholder="http://192.168.x.x:3090/main.lynx.bundle"
          inputKey={`dev-server-${current ?? 'embedded'}`}
          onFocus={() => logger.info('devserver', 'input focused')}
          testid="dev-server-input"
        />
      </view>
      <Hint tone="caption" testid="dev-server-draft">
        {draft ? `待连接:${draft}` : '未输入 URL'}
      </Hint>
      {error ? (
        <Hint tone="error" testid="dev-server-error">
          {error}
        </Hint>
      ) : null}
      {autoRecovered ? (
        <Hint tone="muted" testid="dev-server-auto-recovered">
          已检测到服务器恢复,并自动重新下载 bundle。
        </Hint>
      ) : null}
      <view className="dev-server__actions">
        <Button
          grow
          label="连接并重载"
          disabled={saving || !draft.trim() || !supported}
          onTap={connect}
          testid="dev-server-connect"
        />
        <Button
          grow
          variant="secondary"
          label="刷新"
          disabled={saving || !current || !supported}
          onTap={refresh}
          testid="dev-server-refresh"
        />
        <Button
          grow
          variant="danger"
          label="断开"
          disabled={saving || !current || !supported}
          onTap={disconnect}
          testid="dev-server-disconnect"
        />
      </view>
      <Hint tone="caption">
        电脑运行 pnpm dev(3090 端口已映射),粘贴终端打印的 bundle URL。连接时
        先下载校验,成功后才重新加载;失败不会影响当前页面。
      </Hint>
    </SettingsGroup>
  );
}
