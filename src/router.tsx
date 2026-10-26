import { Component, type ReactNode, useLayoutEffect } from '@lynx-js/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { reportUpdateStartupFailure } from './core/updater/native-updater.js';
import { UpdateStartup } from './core/updater/UpdateStartup.js';
import { HomePage } from './features/home/HomePage.js';
import { AboutPage } from './features/settings/AboutPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import { ShellLayout } from './shared/layouts/ShellLayout.js';
import { confirmAppMounted, markStage } from './shims/crash-guard.js';
import { ensureRouterEnv } from './shims/router-env.js';

/** App 树成功 commit 后通知诊断器静默(useLayoutEffect 同步于 commit,先于诊断屏的 setTimeout)。 */
function MarkAppMounted() {
  useLayoutEffect(() => {
    confirmAppMounted();
  }, []);
  return null;
}

/**
 * Catches render errors in the route tree so the whole app does not go blank.
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
    markStage(`✗ RouteErrorBoundary:${String(error)}`);
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

markStage('② router.tsx 顶层已执行(依赖评估完),创建路由表前');

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

markStage('③ 路由表已创建,等待 index 顶层/构造');

/**
 * 构造应用路由。`ensureRouterEnv()` 必须与 router 构造同线程同 realm 调用
 * (见 src/shims/router-env.ts 注释)。memory history:Lynx 无地址栏。
 *
 * `isServer: false` 是 load-bearing(官方文档明确要求,亦见 songloft 源码):
 * Lynx 无 `document`,不显式指定时 router 会误判为 server 环境——构建按
 * `development`/`node` 条件解析 `router-core` 时模块级 `isServer` 常量为
 * undefined,`this.isServer` 回退为真,真机首屏渲染异常(黑屏)。
 */
export function createAppRouter() {
  ensureRouterEnv();
  markStage('⑥ ensureRouterEnv 完成,即将 createRouter');
  markStage('⑦ createRouter 构造中(此阶段停留 = 构造内崩溃)');
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: false,
  });
  markStage('⑧ createRouter 返回');
  return router;
}

export function App() {
  markStage('⑤ App render() 执行中');
  return (
    <RouteErrorBoundary>
      <MarkAppMounted />
      {/* 真实路由挂载后 1.5s 按 bundleId 确认 trial 启动,并启动自动更新调度 */}
      <UpdateStartup />
      <RouterProvider router={createAppRouter()} />
    </RouteErrorBoundary>
  );
}
