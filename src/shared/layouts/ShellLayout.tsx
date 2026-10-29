import { useEffect, useState } from '@lynx-js/react';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';

import { type MessageKey, t } from '../../i18n/index.js';
import {
  readSystemAppearance,
  subscribeSystemAppearance,
} from '../../native/system-appearance.js';
import './ShellLayout.css';

interface TabItem {
  path: '/' | '/settings';
  labelKey: MessageKey;
  testid: string;
}

const TABS: TabItem[] = [
  { path: '/', labelKey: 'nav.home', testid: 'nav-item-home' },
  { path: '/settings', labelKey: 'nav.settings', testid: 'nav-item-settings' },
];

/**
 * 底部导航外壳(仿 songloft-player-lynx 的窄屏底部导航样式,精简为双 tab)。
 * 当前激活项按路由前缀归属判断:/settings 及其子页(如 /settings/about)
 * 都点亮「设置」。
 */
export function ShellLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [appearance, setAppearance] = useState(readSystemAppearance);

  useEffect(() => {
    setAppearance(readSystemAppearance());
    return subscribeSystemAppearance(setAppearance);
  }, []);

  const activePath = pathname.startsWith('/settings') ? '/settings' : '/';

  return (
    <view
      className={`shell theme-${appearance.colorScheme}${
        pathname === '/' ? ' shell--home' : ''
      }`}
      data-testid="shell-root"
    >
      <view className="shell__body">
        <Outlet />
      </view>
      <view className="shell__bottombar">
        {TABS.map((tab) => (
          <view
            key={tab.path}
            className={
              activePath === tab.path ? 'nav-item nav-item--active' : 'nav-item'
            }
            bindtap={() => navigate({ to: tab.path })}
            data-testid={tab.testid}
          >
            <view className="nav-item__pill">
              <text className="nav-item__label">{t(tab.labelKey)}</text>
            </view>
          </view>
        ))}
      </view>
    </view>
  );
}
