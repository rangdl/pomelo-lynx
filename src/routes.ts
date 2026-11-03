/**
 * 路由路径的**唯一**来源。
 *
 * 这里只放字符串常量,不放组件:router.tsx 用它构造静态 route(保留
 * `navigate({ to })` 的字面量类型),ShellLayout 用 `AppPath` 做页面表、
 * 深度表和页面栈表的 key。三张表都是 `Record<AppPath, ...>`,所以新增
 * 路径时 TS 会强制补齐,而不是运行期静默回落到 `PAGE_STACKS['/settings']`。
 */
export const ROUTE_PATHS = {
  home: '/',
  player: '/player',
  settings: '/settings',
  about: '/settings/about',
  developer: '/settings/developer',
  theme: '/settings/theme',
  sources: '/settings/sources',
  playback: '/settings/playback',
  logs: '/settings/logs',
} as const;

export type AppPath = (typeof ROUTE_PATHS)[keyof typeof ROUTE_PATHS];
