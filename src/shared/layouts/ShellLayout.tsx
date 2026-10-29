import { useEffect, useState } from '@lynx-js/react';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';

import {
  readSystemAppearance,
  subscribeSystemAppearance,
} from '../../native/system-appearance.js';
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
export function ShellLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [appearance, setAppearance] = useState(readSystemAppearance);

  useEffect(() => {
    setAppearance(readSystemAppearance());
    return subscribeSystemAppearance(setAppearance);
  }, []);

  const activePath = pathname.startsWith('/settings') ? '/settings' : '/';

  // 宿主上报的安全区用 inline 变量覆盖 :root 的 env() 默认值;值为 0 时
  // 不写,保留 CSS 的 env() 回退。
  const safeAreaStyle: Record<string, string> = {};
  if (appearance.safeTop > 0)
    safeAreaStyle['--safe-top'] = `${appearance.safeTop}px`;
  if (appearance.safeBottom > 0)
    safeAreaStyle['--safe-bottom'] = `${appearance.safeBottom}px`;
  if (appearance.safeLeft > 0)
    safeAreaStyle['--safe-left'] = `${appearance.safeLeft}px`;
  if (appearance.safeRight > 0)
    safeAreaStyle['--safe-right'] = `${appearance.safeRight}px`;

  return (
    <view
      className={`shell theme-${appearance.colorScheme}${
        pathname === '/' ? ' shell--home' : ''
      }`}
      style={safeAreaStyle}
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
              <text className="nav-item__label">{tab.label}</text>
            </view>
          </view>
        ))}
      </view>
    </view>
  );
}
