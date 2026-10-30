import { useEffect, useState } from '@lynx-js/react';

import { logger } from '../../core/log/index.js';
import { getPomeloStorage } from '../../core/storage/index.js';
import { readNativeModules } from '../../native/native-modules.js';
import './DevServerSection.css';

const PREF_KEY = 'debug_tunnel_ws_url';

/** Shape returned by `NativeModules.PomeloDebugTunnel.getStatus`. */
interface TunnelStatus {
  url?: string;
  room?: string;
  attempted?: boolean;
  handled?: boolean;
  state?: number;
  state_text?: 'disconnected' | 'connecting' | 'connected' | 'unknown';
  connected?: boolean;
  room_id?: string;
  server_url?: string;
  schema?: string;
  last_event?: string;
  last_error?: string;
}

interface PomeloDebugTunnelNative {
  getStatus(callback: (status: TunnelStatus) => void): void;
  reconnect(callback: (status: TunnelStatus) => void): void;
  disconnect(callback: (status: TunnelStatus) => void): void;
}

function readTunnelModule(): PomeloDebugTunnelNative | null {
  const mod = readNativeModules()?.PomeloDebugTunnel as
    | PomeloDebugTunnelNative
    | undefined;
  if (!mod || typeof mod.getStatus !== 'function') return null;
  return mod;
}

function statusText(
  current: string | null,
  status: TunnelStatus | null,
): string {
  if (!current) return '未启用(直连模式)';
  if (!status) return '旧包不支持状态查询';
  switch (status.state_text) {
    case 'connected':
      return `已连接 · room=${status.room_id || status.room || '-'}`;
    case 'connecting':
      return '连接中…';
    case 'disconnected':
      return '未连接';
    default:
      return '未知(原生未上报)';
  }
}

function validate(url: string): string | null {
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    return '中继地址必须以 ws:// 或 wss:// 开头';
  }
  const rest = url.replace(/^wss?:\/\//, '');
  if (!rest.includes(':')) {
    return '中继地址需要带端口(如 ws://1.2.3.4:21783)';
  }
  return null;
}

/**
 * 开发者区(dev channel):DebugRouter 反向调试通道(WS 中继)。
 *
 * 设备端 DebugRouter 只实现明文 WebSocket,且写死 IPv4,所以地址必须是
 * `ws://`(经 Cloudflare 80 端口等明文入口),`wss://` 在设备端会失败。
 *
 * URL 持久化在 prefs(`debug_tunnel_ws_url`),原生侧 `PomeloDebugTunnel`
 * 模块负责读取、拨号、上报状态。保存后立即重连,不再需要重启 app;
 * 页面每秒轮询 `getStatus` 显示已连接/连接中/未连接。
 */
export function DebugTunnelSection() {
  const [current, setCurrent] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [status, setStatus] = useState<TunnelStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPomeloStorage()
      .prefs.get(PREF_KEY)
      .then((value) => {
        if (!cancelled) setCurrent(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll the native tunnel state once a second (recursive setTimeout rather
  // than setInterval so a slow bridge can never pile callbacks up).
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mod = readTunnelModule();
    if (!mod) return;
    const tick = () => {
      if (!alive) return;
      try {
        mod.getStatus((next) => {
          if (alive && next) setStatus(next);
        });
      } catch {
        // Bridge gone (JS reload?) — keep the last known state.
      }
      timer = setTimeout(tick, 1000);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // The native module reads the same prefs directly; prefer it when the JS
  // storage read is empty (e.g. after a reinstall or a bridge hiccup).
  const shownUrl = (current ?? '').trim() || (status?.url ?? '').trim() || null;

  const connect = () => {
    'background only';
    const url = (draft.trim() || shownUrl || '').trim();
    const problem = validate(url);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const mod = readTunnelModule();
    const dial = () => {
      if (!mod) {
        setError('已保存;当前包不支持热重连,请重启 app 生效');
        setSaving(false);
        return;
      }
      try {
        mod.reconnect((next) => {
          if (next) setStatus(next);
          setSaving(false);
        });
      } catch {
        setError('原生重连调用失败');
        setSaving(false);
      }
    };

    if (draft.trim() && draft.trim() !== shownUrl) {
      getPomeloStorage()
        .prefs.set(PREF_KEY, url)
        .then(() => {
          setError(null);
          setCurrent(url);
          setDraft('');
          logger.info('debugtunnel', `ws url set → ${url}`);
          dial();
        })
        .catch(() => {
          setError('保存失败');
          setSaving(false);
        });
    } else {
      setError(null);
      dial();
    }
  };

  const disconnect = () => {
    'background only';
    setSaving(true);
    const mod = readTunnelModule();
    getPomeloStorage()
      .prefs.remove(PREF_KEY)
      .then(() => {
        setError(null);
        setCurrent(null);
        setDraft('');
        logger.info('debugtunnel', 'ws url cleared');
        if (mod) {
          try {
            mod.disconnect((next) => {
              if (next) setStatus(next);
              setSaving(false);
            });
            return;
          } catch {
            // Fall through to the local reset below.
          }
        }
        setSaving(false);
      })
      .catch(() => {
        setError('清除失败');
        setSaving(false);
      });
  };

  const nativeDetail = status
    ? `原生: handled=${status.handled ? '1' : '0'} · state=${
        status.state_text ?? '?'
      } · event=${status.last_event || '-'} · url=${status.url || '-'}`
    : '原生: 状态模块不可用(需安装含 PomeloDebugTunnel 的新包)';

  return (
    <view className="dev-server" data-testid="debug-tunnel-section">
      <text className="dev-server__section-title">调试通道</text>
      <view className="dev-server__row">
        <text className="dev-server__status-label">当前中继</text>
        <text
          className="dev-server__status-value"
          data-testid="debug-tunnel-current"
        >
          {shownUrl ? 'WS 中继' : '未启用(直连模式)'}
        </text>
        {shownUrl ? (
          <text
            className="dev-server__status-value"
            data-testid="debug-tunnel-url"
          >
            {shownUrl}
          </text>
        ) : null}
      </view>
      <view className="dev-server__row">
        <text className="dev-server__status-label">运行状态</text>
        <text
          className="dev-server__status-value"
          data-testid="debug-tunnel-status"
        >
          {statusText(shownUrl, status)}
        </text>
      </view>
      <text
        className="dev-server__draft"
        data-testid="debug-tunnel-native-state"
      >
        {nativeDetail}
      </text>
      {status?.last_error ? (
        <text
          className="dev-server__error"
          data-testid="debug-tunnel-last-error"
        >
          {status.last_error}
        </text>
      ) : null}
      <view className="dev-server__input-row">
        <input
          default-value={draft}
          placeholder="ws://your-relay-ip:21783"
          placeholder-class="dev-server__placeholder"
          maxlength={1000}
          avoid-keyboard={true}
          avoid-keyboard-spacing="12px"
          set-soft-input-mode="resize"
          style={{
            // Lynx 要求长度带单位:无单位数字会抛
            // "CSS length need units (except 0)"(真机 DevTool 报 130300)。
            flex: 1,
            height: '40px',
            fontSize: '13px',
            paddingLeft: '10px',
            paddingRight: '10px',
            backgroundColor: 'var(--color-surface)',
            borderRadius: '10px',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: inputFocused
              ? 'var(--color-accent)'
              : 'var(--color-input-border)',
            color: 'var(--color-text)',
          }}
          bindinput={(e: { detail: { value: string } }) => {
            'background only';
            setDraft(e.detail.value);
          }}
          bindfocus={() => {
            'background only';
            setInputFocused(true);
            logger.info('debugtunnel', 'input focused');
          }}
          bindblur={() => {
            'background only';
            setInputFocused(false);
          }}
          data-testid="debug-tunnel-input"
        />
      </view>
      <text className="dev-server__draft" data-testid="debug-tunnel-draft">
        {draft ? `待连接:${draft}` : '未输入中继地址'}
      </text>
      {error ? (
        <text className="dev-server__error" data-testid="debug-tunnel-error">
          {error}
        </text>
      ) : null}
      <view className="dev-server__actions">
        <view
          className={
            saving
              ? 'dev-server__btn dev-server__btn--disabled'
              : 'dev-server__btn'
          }
          bindtap={connect}
          data-testid="debug-tunnel-connect"
        >
          <text className="dev-server__btn-text">
            {draft.trim() && draft.trim() !== shownUrl
              ? '保存并连接'
              : '重新连接'}
          </text>
        </view>
        <view
          className={
            saving || !shownUrl
              ? 'dev-server__btn dev-server__btn--disabled'
              : 'dev-server__btn'
          }
          bindtap={disconnect}
          data-testid="debug-tunnel-disconnect"
        >
          <text className="dev-server__btn-text dev-server__btn-text--danger">
            断开中继
          </text>
        </view>
      </view>
      <text className="dev-server__note">
        设备端 DebugRouter 只支持明文 WebSocket + IPv4,请填 ws:// 地址(如经
        Cloudflare 80 端口的 ws://relay.example.com:80)。状态每秒刷新;保存后
        立即尝试连接,无需重启,切后台回到前台会自动重连。设错或中继不可达时 app
        仍能正常启动(DevTool 直连模式不受影响)。
      </text>
    </view>
  );
}
