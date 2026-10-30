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
  const [inputFocused, setInputFocused] = useState(false);
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
    <view className="dev-server" data-testid="dev-server-section">
      <text className="dev-server__section-title">Dev Server</text>
      <view className="dev-server__row">
        <text className="dev-server__status-label">已配置来源</text>
        <text
          className="dev-server__status-value"
          data-testid="dev-server-current"
        >
          {current ? 'dev server' : '内嵌 bundle'}
        </text>
        {current ? (
          <text
            className="dev-server__status-value"
            data-testid="dev-server-url"
          >
            {current}
          </text>
        ) : null}
      </view>
      <view className="dev-server__row">
        <text className="dev-server__status-label">服务器状态</text>
        <text
          className="dev-server__status-value"
          data-testid="dev-server-status"
        >
          {probeText(probe, checking, supported, current)}
        </text>
        {current && supported ? (
          <text className="dev-server__status-value">
            每 3 秒探测;服务器恢复后自动重载
          </text>
        ) : null}
      </view>
      <view className="dev-server__input-row">
        <view
          className={
            inputFocused
              ? 'dev-server__input-frame dev-server__input-frame--focused'
              : 'dev-server__input-frame'
          }
        >
          <input
            default-value={draft}
            placeholder="http://192.168.x.x:3090/main.lynx.bundle"
            placeholder-class="dev-server__placeholder"
            maxlength={1000}
            avoid-keyboard={true}
            avoid-keyboard-spacing="12px"
            set-soft-input-mode="resize"
            style={{
              // Lynx 要求长度带单位:无单位数字会抛
              // "CSS length need units (except 0)"(真机 DevTool 报 130300)。
              flex: 1,
              fontSize: '13px',
              paddingLeft: '10px',
              paddingRight: '10px',
              height: '38px',
              backgroundColor: 'transparent',
              color: 'var(--color-text)',
            }}
            bindinput={(e: { detail: { value: string } }) => {
              'background only';
              setDraft(e.detail.value);
            }}
            bindfocus={() => {
              'background only';
              setInputFocused(true);
              logger.info('devserver', 'input focused');
            }}
            bindblur={() => {
              'background only';
              setInputFocused(false);
            }}
            data-testid="dev-server-input"
          />
        </view>
      </view>
      <text className="dev-server__draft" data-testid="dev-server-draft">
        {draft ? `待连接:${draft}` : '未输入 URL'}
      </text>
      {error ? (
        <text className="dev-server__error" data-testid="dev-server-error">
          {error}
        </text>
      ) : null}
      {autoRecovered ? (
        <text
          className="dev-server__note"
          data-testid="dev-server-auto-recovered"
        >
          已检测到服务器恢复,并自动重新下载 bundle。
        </text>
      ) : null}
      <view className="dev-server__actions">
        <view
          className={
            saving || !draft.trim() || !supported
              ? 'dev-server__btn dev-server__btn--disabled'
              : 'dev-server__btn'
          }
          bindtap={connect}
          data-testid="dev-server-connect"
        >
          <text className="dev-server__btn-text">连接并重载</text>
        </view>
        <view
          className={
            saving || !current || !supported
              ? 'dev-server__btn dev-server__btn--disabled'
              : 'dev-server__btn'
          }
          bindtap={refresh}
          data-testid="dev-server-refresh"
        >
          <text className="dev-server__btn-text">刷新</text>
        </view>
        <view
          className={
            saving || !current || !supported
              ? 'dev-server__btn dev-server__btn--disabled'
              : 'dev-server__btn'
          }
          bindtap={disconnect}
          data-testid="dev-server-disconnect"
        >
          <text className="dev-server__btn-text dev-server__btn-text--danger">
            断开
          </text>
        </view>
      </view>
      <text className="dev-server__note">
        电脑运行 pnpm dev(3090 端口已映射),粘贴终端打印的 bundle URL。连接时
        先下载校验,成功后才重新加载;失败不会影响当前页面。
      </text>
    </view>
  );
}
