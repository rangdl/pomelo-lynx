import { Component, type ReactNode } from '@lynx-js/react';
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
import { ROUTE_PATHS } from './routes.js';
import { ShellLayout } from './shared/layouts/ShellLayout.js';
import { ensureRouterEnv } from './shims/router-env.js';

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

const rootRoute = createRootRoute({ component: Outlet });

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: ShellLayout,
});

/**
 * 子路由只声明路径,不声明 `component`。
 *
 * ShellLayout 是单 LynxView 内的页面栈:它按 `PAGE_COMPONENTS` 同时挂载
 * 当前 tab 的祖先页(侧滑返回时父页真实垫在下面),没有 `<Outlet>`。
 * 因此这里的 `component` 永远不会被渲染,写上去只会让人以为改了它就能改页面。
 * 组件注册见 src/shared/layouts/ShellLayout.tsx 的 PAGE_COMPONENTS。
 *
 * 路径值来自 ROUTE_PATHS,而不是字面量:本仓库没有 `declare module
 * '@tanstack/react-router'` 的 Register Router 声明,`navigate({ to })`
 * 本来就是宽 string 类型(已用 `/settings/nope` 探针验证),所以这里
 * 折成 `Object.values()` 不会让类型从「收窄」退化成「宽松」——它一直没收窄过。
 */
const childRoutes = Object.values(ROUTE_PATHS).map((path) =>
  createRoute({ getParentRoute: () => shellRoute, path }),
);

const routeTree = rootRoute.addChildren([shellRoute.addChildren(childRoutes)]);

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
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: false,
  });
}

export function App() {
  return (
    <RouteErrorBoundary>
      {/* 真实路由挂载后 1.5s 按 bundleId 确认 trial 启动,并启动自动更新调度 */}
      <UpdateStartup />
      <RouterProvider router={createAppRouter()} />
    </RouteErrorBoundary>
  );
}
