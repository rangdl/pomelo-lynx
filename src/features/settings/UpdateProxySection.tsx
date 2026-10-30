import { useEffect, useState } from '@lynx-js/react';

import {
  DEFAULT_UPDATE_PROXY,
  isValidUpdateProxy,
  normalizeUpdateProxy,
  readUpdateProxySettings,
  type UpdateProxySettings,
  writeUpdateProxySettings,
} from '../../core/updater/update-preferences.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import { SettingsGroupDivider } from '../../shared/ui/SettingsGroup.js';
import './UpdateProxySection.css';

/**
 * 更新代理设置:同时作用于客户端更新与 Bundle 热更新的 Release API、
 * version.json/client.json 和资产下载。默认开启,地址默认 gh-proxy。
 */
export function UpdateProxySection() {
  const [enabled, setEnabled] = useState(true);
  const [address, setAddress] = useState(DEFAULT_UPDATE_PROXY);
  const [draft, setDraft] = useState(DEFAULT_UPDATE_PROXY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    readUpdateProxySettings()
      .then((settings) => {
        if (!alive) return;
        setEnabled(settings.enabled);
        setAddress(settings.address);
        setDraft(settings.address);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const persist = (next: UpdateProxySettings): void => {
    'background only';
    const normalized = normalizeUpdateProxy(next.address);
    if (!isValidUpdateProxy(normalized)) {
      setError('代理地址必须是无凭据、无查询串的 https:// 地址');
      return;
    }
    setSaving(true);
    setError(null);
    void writeUpdateProxySettings({
      enabled: next.enabled,
      address: normalized,
    })
      .then(() => {
        setEnabled(next.enabled);
        setAddress(normalized);
        setDraft(normalized);
      })
      .catch(() => {
        setError('保存代理设置失败,请稍后重试');
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const toggle = () => {
    'background only';
    if (saving) return;
    persist({ enabled: !enabled, address: draft });
  };

  const commitAddress = () => {
    'background only';
    if (saving) return;
    const normalized = normalizeUpdateProxy(draft);
    if (!isValidUpdateProxy(normalized)) {
      setError('代理地址必须是无凭据、无查询串的 https:// 地址');
      return;
    }
    setDraft(normalized);
    if (normalized !== address) persist({ enabled, address: normalized });
  };

  return (
    <view className="update-proxy" data-testid="update-proxy-section">
      <ListRow
        icon={<text className="list-row__icon-text">⇄</text>}
        iconColor="#0ea5e9"
        label="使用代理更新"
        detail="Release API、version.json、client.json 与 Bundle/IPA 下载"
        testid="update-proxy-switch-row"
        trailing={
          <view
            className="update-proxy__switch-hit"
            bindtap={toggle}
            accessibility-element={true}
            accessibility-label="使用代理更新"
            accessibility-traits="button"
            data-testid="update-proxy-switch"
          >
            <view
              className={
                enabled
                  ? 'update-proxy__switch update-proxy__switch--on'
                  : 'update-proxy__switch'
              }
            >
              <view className="update-proxy__switch-thumb" />
            </view>
          </view>
        }
      />

      <SettingsGroupDivider />
      <view className="update-proxy__editor">
        <text className="update-proxy__label">代理地址</text>
        <view
          className={
            focused
              ? 'update-proxy__input-frame update-proxy__input-frame--focused'
              : 'update-proxy__input-frame'
          }
        >
          <input
            key={`update-proxy-${loaded ? address : 'loading'}`}
            default-value={draft}
            placeholder={DEFAULT_UPDATE_PROXY}
            placeholder-class="update-proxy__placeholder"
            maxlength={300}
            avoid-keyboard={true}
            avoid-keyboard-spacing="12px"
            set-soft-input-mode="resize"
            style={{
              flex: 1,
              fontSize: '13px',
              paddingLeft: '10px',
              paddingRight: '10px',
              height: '38px',
              backgroundColor: 'transparent',
              color: 'var(--color-on-surface)',
            }}
            bindinput={(event: { detail: { value: string } }) => {
              'background only';
              setDraft(event.detail.value);
            }}
            bindfocus={() => {
              'background only';
              setFocused(true);
            }}
            bindblur={() => {
              'background only';
              setFocused(false);
              commitAddress();
            }}
            bindconfirm={commitAddress}
            data-testid="update-proxy-input"
          />
        </view>
        <text className="update-proxy__note">
          默认 {DEFAULT_UPDATE_PROXY};仅支持
          https://，保存后立即用于两个更新链路。 第三方代理只做传输加速，Bundle
          仍会验签。
        </text>
      </view>

      <SettingsGroupDivider />
      <ListRow
        icon={<text className="list-row__icon-text">↺</text>}
        iconColor="#8e8e93"
        label="恢复默认地址"
        value={DEFAULT_UPDATE_PROXY}
        disabled={saving}
        onTap={() => {
          'background only';
          setDraft(DEFAULT_UPDATE_PROXY);
          persist({ enabled, address: DEFAULT_UPDATE_PROXY });
        }}
        testid="update-proxy-reset"
      />

      {error ? (
        <text className="update-proxy__error" data-testid="update-proxy-error">
          {error}
        </text>
      ) : null}
    </view>
  );
}
