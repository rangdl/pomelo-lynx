import { useEffect, useState } from '@lynx-js/react';

import { getPomeloStorage } from '../../core/storage/index.js';
import './DevServerSection.css';

const PREF_KEY = 'dev_server_url';

function validate(url: string): string | null {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'URL 必须以 http:// 或 https:// 开头';
  }
  if (!url.includes('.lynx.bundle')) {
    return 'URL 必须指向 .lynx.bundle 文件';
  }
  return null;
}

/**
 * 开发者区(dev channel):连接 rspeedy dev server 实时加载 bundle。
 * URL 持久化在 prefs(`dev_server_url`),原生侧 ViewController 启动时
 * 读取并交给 HostTemplateProvider 的 http(s) 分支拉取;加载失败时原生
 * 会自动清掉该 key 并回退内嵌 bundle。
 *
 * 连接后需重启 app(或等待下一次冷启动)生效——宿主在启动时选择 bundle。
 */
export function DevServerSection() {
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
      })
      .catch(() => setError('清除失败'))
      .finally(() => setSaving(false));
  };

  return (
    <view className="dev-server" data-testid="dev-server-section">
      <text className="dev-server__section-title">开发者</text>
      <view className="dev-server__row">
        <text className="dev-server__status-label">当前 bundle 来源</text>
        <text
          className="dev-server__status-value"
          data-testid="dev-server-current"
        >
          {current ? `dev server\n${current}` : '内嵌 bundle'}
        </text>
      </view>
      <view className="dev-server__input-wrap">
        <input
          className="dev-server__input"
          placeholder="http://192.168.x.x:3000/main.lynx.bundle"
          type="text"
          confirm-type="done"
          maxlength={200}
          bindinput={(e: { detail: { value: string } }) => {
            'background only';
            setDraft(e.detail.value);
          }}
          data-testid="dev-server-input"
        />
      </view>
      {error ? (
        <text className="dev-server__error" data-testid="dev-server-error">
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
          data-testid="dev-server-connect"
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
          data-testid="dev-server-disconnect"
        >
          <text className="dev-server__btn-text dev-server__btn-text--danger">
            断开连接
          </text>
        </view>
      </view>
      <text className="dev-server__note">
        电脑运行 pnpm dev,手机与电脑同网段,粘贴终端打印的 bundle URL。
        连接后需重启 app 生效。
      </text>
    </view>
  );
}
