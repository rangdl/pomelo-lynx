import { Component, type ReactNode } from '@lynx-js/react';

import { reportUpdateStartupFailure } from './core/updater/native-updater.js';
import { UpdateStartup } from './core/updater/UpdateStartup.js';
import { HomePage } from './features/home/HomePage.js';
import { AboutPage } from './features/settings/AboutPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import { ShellLayout } from './shared/layouts/ShellLayout.js';
import { RouterProvider, useRouterState } from './shared/router.js';

/**
 * Catches render errors so the whole app does not go blank.
 * A render failure during a trial bundle's first launch reports the failure so
 * the next cold start rolls back (mirrors songloft-player-lynx).
 */
class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    reportUpdateStartupFailure();
    // eslint-disable-next-line no-console
    console.error('[RouteErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <view
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <text>页面出错了,请重启应用</text>
        </view>
      );
    }
    return this.props.children;
  }
}

/** 前缀匹配:`/settings/about` 也归属「设置」tab,由 ShellLayout 点亮。 */
function AppRoutes() {
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  let page: ReactNode;
  if (pathname.startsWith('/settings/about')) {
    page = <AboutPage />;
  } else if (pathname.startsWith('/settings')) {
    page = <SettingsPage />;
  } else {
    page = <HomePage />;
  }

  return <ShellLayout>{page}</ShellLayout>;
}

export function App() {
  return (
    <RouteErrorBoundary>
      {/* 真实路由挂载后 1.5s 按 bundleId 确认 trial 启动,并启动自动更新调度 */}
      <UpdateStartup />
      <RouterProvider>
        <AppRoutes />
      </RouterProvider>
    </RouteErrorBoundary>
  );
}
