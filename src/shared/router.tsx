import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from '@lynx-js/react';

/**
 * 轻量内存路由(替代 TanStack Router——其在 Lynx 引擎上构造即崩,黑屏根因已二分坐实)。
 * 双 tab + 关于子页的规模用不上路由库:memory history + 前缀匹配足够。
 */

interface RouterValue {
  pathname: string;
  navigate: (opts: { to: string }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [pathname, setPathname] = useState('/');
  const navigate = useCallback((opts: { to: string }) => {
    setPathname(opts.to);
  }, []);
  const value = { pathname, navigate };
  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}

function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) {
    throw new Error('[router] use outside <RouterProvider>');
  }
  return value;
}

/** 与原 TanStack 调用面兼容:`navigate({ to: '/settings' })`。 */
export function useNavigate() {
  return useRouter().navigate;
}

/** 与原 TanStack 调用面兼容:`useRouterState({ select: (s) => s.location.pathname })`。 */
export function useRouterState<T>({
  select,
}: {
  select: (state: { location: { pathname: string } }) => T;
}): T {
  const { pathname } = useRouter();
  return select({ location: { pathname } });
}
