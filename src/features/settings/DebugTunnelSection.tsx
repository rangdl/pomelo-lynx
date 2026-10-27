import { useEffect, useState } from '@lynx-js/react';

import { logger } from '../../core/log/index.js';
import { getPomeloStorage } from '../../core/storage/index.js';
import './DevServerSection.css';

const PREF_KEY = 'debug_tunnel_ws_url';

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
 * 场景:公司网络(手机)与家里服务器不在同一局域网,直接连不上 8901,
 * 此时手机主动连一个公网可达的中继(我们自己部署),工具侧再连中继。
 *
 * URL 持久化在 prefs(`debug_tunnel_ws_url`),原生侧 DevToolBoot.m 在启动时
 * 读取并走 `DebugRouter handleSchema: "lynx://remote_debug_lynx/enable?url=...&room=..."`
 * 主动连中继。中继断线或 app 未重启不影响常规启动。
 *
 * 与 DevServerSection 同为"写 prefs + 重启 app 生效"模式:改动后重启 app
 * 让 DebugRouter 重启时读到新地址。
 */
export function DebugTunnelSection() {
  const [current, setCurrent] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const connect = () => {
    'background only';
    const url = draft.trim();
    const problem = validate(url);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    getPomeloStorage()
      .prefs.set(PREF_KEY, url)
      .then(() => {
        setError(null);
        setCurrent(url);
        logger.info('debugtunnel', `ws url set → ${url}`);
      })
      .catch(() => setError('保存失败'))
      .finally(() => setSaving(false));
  };

  const disconnect = () => {
    'background only';
    setSaving(true);
    getPomeloStorage()
      .prefs.remove(PREF_KEY)
      .then(() => {
        setError(null);
        setCurrent(null);
        setDraft('');
        logger.info('debugtunnel', 'ws url cleared');
      })
      .catch(() => setError('清除失败'))
      .finally(() => setSaving(false));
  };

  return (
    <view className="dev-server" data-testid="debug-tunnel-section">
      <text className="dev-server__section-title">调试通道</text>
      <view className="dev-server__row">
        <text className="dev-server__status-label">当前中继</text>
        <text
          className="dev-server__status-value"
          data-testid="debug-tunnel-current"
        >
          {current ? `WS 中继\n${current}` : '未连接(直连模式)'}
        </text>
      </view>
      <view className="dev-server__input-row">
        <input
          default-value={draft}
          placeholder="ws://your-relay-ip:21783"
          placeholder-class="dev-server__placeholder"
          maxlength={1000}
          style={{
            // Lynx 要求长度带单位:无单位数字会抛
            // "CSS length need units (except 0)"(真机 DevTool 报 130300)。
            flex: 1,
            height: '40px',
            fontSize: '13px',
            paddingLeft: '10px',
            paddingRight: '10px',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            color: '#111111',
          }}
          bindinput={(e: { detail: { value: string } }) => {
            'background only';
            setDraft(e.detail.value);
          }}
          bindfocus={() => {
            'background only';
            logger.info('debugtunnel', 'input focused');
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
          <text className="dev-server__btn-text">连接并重启生效</text>
        </view>
        <view
          className={
            saving || !current
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
        手机与开发服务器不在同一局域网时使用。地址为公网可达的 WS 中继 (如
        ws://your-vps:21783),连接后需重启 app 生效。设错或中继不可达时 app
        仍能正常启动(DevTool 直连模式不受影响)。
      </text>
    </view>
  );
}
