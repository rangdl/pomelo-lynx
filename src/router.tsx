import { Component, type ReactNode } from '@lynx-js/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';

import { HomePage } from './features/home/HomePage.js';
import { AboutPage } from './features/settings/AboutPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import { ShellLayout } from './shared/layouts/ShellLayout.js';
import { ensureRouterEnv } from './shims/router-env.js';

/**
 * Catches render errors in the route tree so the whole app does not go blank.
 *
 * 阶段 2/3 接线点:songloft 在 componentDidCatch 里调
 * `reportUpdateStartupFailure()`(core/updater/native-updater),让未确认的
 * trial bundle 在下次冷启动回滚。JS updater 落地后接这里。
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

const rootRoute = createRootRoute({ component: Outlet });

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: ShellLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  component: HomePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  component: SettingsPage,
});

const aboutRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings/about',
  component: AboutPage,
});

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([homeRoute, settingsRoute, aboutRoute]),
]);

/**
 * 构造应用路由。`ensureRouterEnv()` 必须与 router 构造同线程同 realm 调用
 * (见 src/shims/router-env.ts 注释)。memory history:Lynx 无地址栏。
 */
export function createAppRouter() {
  ensureRouterEnv();
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

export function App() {
  return (
    <RouteErrorBoundary>
      <RouterProvider router={createAppRouter()} />
    </RouteErrorBoundary>
  );
}
