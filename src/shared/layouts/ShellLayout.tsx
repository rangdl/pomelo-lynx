import type { ReactNode } from '@lynx-js/react';

import { useNavigate, useRouterState } from '../router.js';
import './ShellLayout.css';

interface TabItem {
  path: '/' | '/settings';
  label: string;
  testid: string;
}

const TABS: TabItem[] = [
  { path: '/', label: '首页', testid: 'nav-item-home' },
  { path: '/settings', label: '设置', testid: 'nav-item-settings' },
];

/**
 * 底部导航外壳(仿 songloft-player-lynx 的窄屏底部导航样式,精简为双 tab)。
 * 当前激活项按路由前缀归属判断:/settings 及其子页(如 /settings/about)
 * 都点亮「设置」。
 */
export function ShellLayout({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const activePath = pathname.startsWith('/settings') ? '/settings' : '/';

  return (
    <view className="shell" data-testid="shell-root">
      <view className="shell__body">{children}</view>
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
              <text className="nav-item__label">{tab.label}</text>
            </view>
          </view>
        ))}
      </view>
    </view>
  );
}
