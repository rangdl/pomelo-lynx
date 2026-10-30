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
import { SwitchRow } from '../../shared/ui/SwitchRow.js';
import { TextField } from '../../shared/ui/TextField.js';
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
      <SwitchRow
        iconGlyph="⇄"
        iconTone="sky"
        label="使用代理更新"
        detail="Release API、version.json、client.json 与 Bundle/IPA 下载"
        checked={enabled}
        onChange={(next) => {
          'background only';
          persist({ enabled: next, address: draft });
        }}
        disabled={saving}
        testid="update-proxy-switch-row"
        switchTestid="update-proxy-switch"
      />

      <SettingsGroupDivider />
      <TextField
        className="update-proxy__editor"
        label="代理地址"
        value={draft}
        onChange={setDraft}
        onBlur={commitAddress}
        onConfirm={commitAddress}
        placeholder={DEFAULT_UPDATE_PROXY}
        hint={`默认 ${DEFAULT_UPDATE_PROXY};仅支持 https://，保存后立即用于两个更新链路。第三方代理只做传输加速，Bundle 仍会验签。`}
        error={error}
        inputKey={`update-proxy-${loaded ? address : 'loading'}`}
        maxlength={300}
        disabled={saving}
        testid="update-proxy-input"
      />

      <SettingsGroupDivider />
      <ListRow
        iconGlyph="↺"
        iconTone="neutral"
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
    </view>
  );
}
