import type { ReactNode } from '@lynx-js/react';
import {
  runOnMainThread,
  useEffect,
  useMainThreadRef,
  useMemo,
  useRef,
  useState,
} from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';
import { useNavigate, useRouterState } from '@tanstack/react-router';

import { HomePage } from '../../features/home/HomePage.js';
import { AboutPage } from '../../features/settings/AboutPage.js';
import { DeveloperPage } from '../../features/settings/DeveloperPage.js';
import { LogsPage } from '../../features/settings/LogsPage.js';
import { SettingsPage } from '../../features/settings/SettingsPage.js';
import { type MessageKey, t } from '../../i18n/index.js';
import { subscribeNavigationSwipe } from '../../native/navigation.js';
import { setNativeEdgeBackEnabled } from '../../native/platform.js';
import {
  readSystemAppearance,
  subscribeSystemAppearance,
} from '../../native/system-appearance.js';
import { isIosPlatform, isWebPlatform } from '../../native/web-platform.js';
import {
  resolveTheme,
  useAppearanceMode,
} from '../theme/appearance-preference.js';
import {
  resolveThemeVariant,
  useThemePalette,
} from '../theme/theme-palette-preference.js';
import { TabIcon, type TabIconName } from './TabIcon.js';
import './ShellLayout.css';

interface TabItem {
  path: '/' | '/settings';
  labelKey: MessageKey;
  icon: TabIconName;
  testid: string;
}

const TABS: TabItem[] = [
  { path: '/', labelKey: 'nav.home', icon: 'home', testid: 'nav-item-home' },
  {
    path: '/settings',
    labelKey: 'nav.settings',
    icon: 'settings',
    testid: 'nav-item-settings',
  },
];

/** 底栏宽度自适应:每个 tab 96px,最多 4 个槽位;超出后最后一个是「更多」。 */
const MAX_VISIBLE_SLOTS = 4;
const SLOT_WIDTH = 84;
const BAR_EXTRA_WIDTH = 8;

type PageDirection = 'push' | 'pop' | 'fade' | 'none';
type AppPath =
  | '/'
  | '/settings'
  | '/settings/about'
  | '/settings/developer'
  | '/settings/about/logs';
type SettingsPath = Exclude<AppPath, '/'>;

const ROUTE_DEPTH: Record<AppPath, number> = {
  '/': 0,
  '/settings': 1,
  '/settings/about': 2,
  '/settings/developer': 2,
  '/settings/about/logs': 3,
};

const PAGE_COMPONENTS: Record<AppPath, () => ReactNode> = {
  '/': HomePage,
  '/settings': SettingsPage,
  '/settings/about': AboutPage,
  '/settings/developer': DeveloperPage,
  '/settings/about/logs': LogsPage,
};

/** 每个 tab 一条栈;栈里保持祖先页面挂载,侧滑时父页就在下面。 */
const PAGE_STACKS: Record<AppPath, readonly AppPath[]> = {
  '/': ['/'],
  '/settings': ['/settings'],
  '/settings/about': ['/settings', '/settings/about'],
  '/settings/developer': ['/settings', '/settings/developer'],
  '/settings/about/logs': [
    '/settings',
    '/settings/about',
    '/settings/about/logs',
  ],
};

const SETTINGS_PATHS = new Set<AppPath>([
  '/settings',
  '/settings/about',
  '/settings/developer',
  '/settings/about/logs',
]);

function routeDepth(pathname: string): number {
  return ROUTE_DEPTH[pathname as AppPath] ?? 2;
}

function stackFor(pathname: string): readonly AppPath[] {
  return PAGE_STACKS[pathname as AppPath] ?? PAGE_STACKS['/settings'];
}

/** 当前 tab 栈里的上一页;侧滑返回只在这一条栈内移动。 */
function parentPath(pathname: string): AppPath | null {
  const stack = stackFor(pathname);
  return stack.length > 1 ? stack[stack.length - 2] : null;
}

function isSettingsPath(pathname: string): pathname is SettingsPath {
  return SETTINGS_PATHS.has(pathname as AppPath);
}

function tabOf(pathname: string): 'home' | 'settings' {
  return pathname.startsWith('/settings') ? 'settings' : 'home';
}

/**
 * 底部导航外壳(仿 songloft-player-lynx 的窄屏底部导航样式,精简为双 tab)。
 * 当前激活项按路由前缀归属判断:/settings 及其子页(如 /settings/about)
 * 都点亮「设置」。
 */
export function ShellLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [appearance, setAppearance] = useState(readSystemAppearance);
  const appearanceMode = useAppearanceMode();
  const themePalette = useThemePalette();
  const [showMore, setShowMore] = useState(false);
  // 记住设置 tab 的最后位置;从其它 tab 切回来时恢复整条栈。
  const lastSettingsPathRef = useRef<SettingsPath>('/settings');
  if (isSettingsPath(pathname)) lastSettingsPathRef.current = pathname;

  // 单 LynxView 没有原生导航栈;用页面挂载动画模拟 push/pop。
  // ref 只在 pathname 真正变化时更新,避免普通重渲染重播动画。
  const lastPathRef = useRef(pathname);
  const lastDepthRef = useRef(routeDepth(pathname));
  const pageDirectionRef = useRef<PageDirection>('none');
  if (lastPathRef.current !== pathname) {
    const nextDepth = routeDepth(pathname);
    if (tabOf(lastPathRef.current) !== tabOf(pathname)) {
      // 切 tab 是栈切换,不是页面 push;直接显示恢复点,避免底层页闪一下。
      pageDirectionRef.current = 'none';
    } else if (nextDepth > lastDepthRef.current) {
      pageDirectionRef.current = 'push';
    } else if (nextDepth < lastDepthRef.current) {
      pageDirectionRef.current = 'pop';
    } else {
      pageDirectionRef.current = 'none';
    }
    lastPathRef.current = pathname;
    lastDepthRef.current = nextDepth;
  }
  const pageDirection = pageDirectionRef.current;

  // 跟手滑动:主线程直接写 transform,松手再动画到 0 或屏宽。
  const pageRef = useMainThreadRef<MainThread.Element>(null);
  const pageAnimationRef = useMainThreadRef<MainThread.Animation | null>(null);
  const followPage = useMemo(
    () =>
      runOnMainThread((offset: number) => {
        'main thread';
        const page = pageRef.current;
        if (!page) return;
        pageAnimationRef.current?.cancel();
        pageAnimationRef.current = null;
        page.setStyleProperty('transform', `translateX(${offset}px)`);
      }),
    [],
  );
  const settlePage = useMemo(
    () =>
      runOnMainThread((from: number, to: number, duration: number) => {
        'main thread';
        const page = pageRef.current;
        if (!page) return;
        pageAnimationRef.current?.cancel();
        pageAnimationRef.current = null;
        if (typeof page.animate !== 'function') {
          page.setStyleProperty('transform', `translateX(${to}px)`);
          return;
        }
        page.setStyleProperty('transform', `translateX(${from}px)`);
        pageAnimationRef.current = page.animate(
          [
            { transform: `translateX(${from}px)` },
            { transform: `translateX(${to}px)` },
          ],
          {
            duration,
            easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
            fill: 'forwards',
          },
        );
      }),
    [],
  );
  const clearPageMotion = useMemo(
    () =>
      runOnMainThread(() => {
        'main thread';
        pageAnimationRef.current?.cancel();
        pageAnimationRef.current = null;
        pageRef.current?.setStyleProperty('transform', 'translateX(0px)');
      }),
    [],
  );

  useEffect(() => {
    setAppearance(readSystemAppearance());
    return subscribeSystemAppearance(setAppearance);
  }, []);

  // 根 tab 关闭原生边缘手势,避免冻结触摸却不移动页面。
  useEffect(() => {
    setNativeEdgeBackEnabled(pathname.startsWith('/settings/'));
  }, [pathname]);

  // iOS 左边缘跟手返回:只有子页响应;根 tab(首页/设置)不响应。
  useEffect(() => {
    if (!pathname.startsWith('/settings/')) return;
    let navTimer: ReturnType<typeof setTimeout> | undefined;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let translation = 0;
    let committed = false;
    let ended = false;

    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      // 原生 end 丢失时(系统取消手势等)兜底回弹,避免页面卡在半途。
      watchdog = setTimeout(() => {
        if (committed) return;
        settlePage(translation, 0, 200);
        translation = 0;
        clearTimer = setTimeout(() => clearPageMotion(), 240);
      }, 1200);
    };

    const unsubscribe = subscribeNavigationSwipe((event) => {
      if (navTimer) {
        clearTimeout(navTimer);
        navTimer = undefined;
      }
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = undefined;
      }
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = undefined;
      }

      if (event.phase === 'begin') {
        committed = false;
        ended = false;
        translation = 0;
        followPage(0);
        armWatchdog();
        return;
      }
      if (event.phase === 'change') {
        // end 之后可能还有排队中的 change;忽略,避免页面又被推回半途。
        if (committed || ended) return;
        translation = Math.max(0, event.translation);
        followPage(translation);
        armWatchdog();
        return;
      }

      ended = true;
      if (event.commit && !committed) {
        committed = true;
        const offscreen = event.width > 0 ? event.width : 400;
        settlePage(translation, offscreen, 180);
        const parent = parentPath(pathname);
        navTimer = setTimeout(() => {
          if (parent) navigate({ to: parent });
        }, 190);
        return;
      }

      settlePage(translation, 0, 220);
      clearTimer = setTimeout(() => clearPageMotion(), 240);
      // 第二道保险:动画/清理任一步失败时强制归零。
      watchdog = setTimeout(() => {
        followPage(0);
        clearPageMotion();
      }, 700);
    });

    return () => {
      if (navTimer) clearTimeout(navTimer);
      if (clearTimer) clearTimeout(clearTimer);
      if (watchdog) clearTimeout(watchdog);
      unsubscribe();
    };
  }, [clearPageMotion, followPage, navigate, pathname, settlePage]);

  const handleTab = (tab: TabItem) => {
    if (tab.path === '/') {
      if (pathname !== '/') navigate({ to: '/' });
      return;
    }
    if (isSettingsPath(pathname)) {
      // 再点当前 tab:回到该 tab 的栈根。
      if (pathname !== '/settings') navigate({ to: '/settings' });
      return;
    }
    navigate({ to: lastSettingsPathRef.current });
  };

  const activePath = pathname.startsWith('/settings') ? '/settings' : '/';
  const rawActiveIndex = TABS.findIndex((tab) => tab.path === activePath);
  const visibleTabs =
    TABS.length > MAX_VISIBLE_SLOTS
      ? TABS.slice(0, MAX_VISIBLE_SLOTS - 1)
      : TABS;
  const overflowTabs = TABS.slice(visibleTabs.length);
  const hasMore = overflowTabs.length > 0;
  const slotCount = visibleTabs.length + (hasMore ? 1 : 0);
  const activeIndex =
    hasMore && rawActiveIndex >= visibleTabs.length
      ? visibleTabs.length
      : Math.max(0, rawActiveIndex);
  const moreActive = hasMore && rawActiveIndex >= visibleTabs.length;
  const barWidth = slotCount * SLOT_WIDTH + BAR_EXTRA_WIDTH;
  const theme = resolveTheme(appearanceMode, appearance.colorScheme);
  const dark = theme === 'dark';
  const ios = isIosPlatform();
  const glass = ios || isWebPlatform();
  const iconColor = (active: boolean): string =>
    active ? (dark ? '#4da3ff' : '#007aff') : dark ? '#b0b7c3' : '#666666';
  const stack = stackFor(pathname);
  const themeVariant = resolveThemeVariant(themePalette, theme);

  return (
    // 主题变体变化时重建 shell,保证 iOS 重新解析完整 token 集。
    <view
      key={themeVariant}
      className={`shell theme-${themeVariant} scheme-${theme}${
        pathname === '/' ? ' shell--home' : ''
      }`}
      data-testid="shell-root"
    >
      <view className="shell__body">
        <view className="page-stack">
          {stack.map((path, index) => {
            const Page = PAGE_COMPONENTS[path];
            const top = index === stack.length - 1;
            if (top) {
              const animate =
                pageDirection === 'push' || pageDirection === 'fade';
              return (
                <view
                  key={path}
                  className={`shell__page-layer${
                    animate ? ` shell__page--${pageDirection}` : ''
                  }`}
                  main-thread:ref={pageRef}
                  style={{ zIndex: index + 1 }}
                  data-testid="shell-page"
                >
                  <Page />
                </view>
              );
            }
            return (
              <view
                key={path}
                className="shell__page-layer"
                style={{ zIndex: index + 1 }}
              >
                <Page />
              </view>
            );
          })}
        </view>
      </view>
      <view className="shell__bottombar" style={{ width: `${barWidth}px` }}>
        {/* iOS 用 XElement/BlurView 采样底栏背后的内容;tint 在其上做
            半透明着色,图标/文字继续在最上层。其它平台只显示 tint。 */}
        {ios ? (
          <blur-view
            className="shell__bottombar-glass"
            blur-radius="24px"
            blur-effect={dark ? 'dark' : 'extra-light'}
            accessibility-element={false}
          />
        ) : glass ? (
          <blur-view
            className="shell__bottombar-glass"
            blur-radius="24px"
            accessibility-element={false}
          />
        ) : null}
        <view
          className={
            glass
              ? 'shell__bottombar-tint shell__bottombar-tint--glass'
              : 'shell__bottombar-tint'
          }
        />
        {/* 单个滑动选中胶囊:主线程 spring 动画,宽度按槽位等分。 */}
        <TabIndicator index={activeIndex} count={slotCount} />
        {visibleTabs.map((tab) => {
          const active = activePath === tab.path;
          return (
            <view
              key={tab.path}
              className={active ? 'nav-item nav-item--active' : 'nav-item'}
              bindtap={() => handleTab(tab)}
              data-testid={tab.testid}
              accessibility-element={true}
              accessibility-label={t(tab.labelKey)}
              accessibility-traits="button"
            >
              <view className="nav-item__pill">
                <TabIcon name={tab.icon} color={iconColor(active)} />
                <text className="nav-item__label">{t(tab.labelKey)}</text>
              </view>
            </view>
          );
        })}
        {hasMore ? (
          <view
            className={moreActive ? 'nav-item nav-item--active' : 'nav-item'}
            bindtap={() => setShowMore(true)}
            data-testid="nav-item-more"
            accessibility-element={true}
            accessibility-label={t('nav.more')}
            accessibility-traits="button"
          >
            <view className="nav-item__pill">
              <TabIcon name="more" color={iconColor(moreActive)} />
              <text className="nav-item__label">{t('nav.more')}</text>
            </view>
          </view>
        ) : null}
      </view>

      {showMore ? (
        <view className="more-sheet" bindtap={() => setShowMore(false)}>
          <view className="more-sheet__panel" catchtap={() => {}}>
            <text className="more-sheet__title">{t('nav.more')}</text>
            {overflowTabs.map((tab) => (
              <view
                key={tab.path}
                className="more-sheet__row"
                bindtap={() => {
                  setShowMore(false);
                  navigate({ to: tab.path });
                }}
              >
                <TabIcon name={tab.icon} color={iconColor(false)} />
                <text className="more-sheet__label">{t(tab.labelKey)}</text>
              </view>
            ))}
          </view>
        </view>
      ) : null}
    </view>
  );
}

/* === 主线程 spring 指示器 ===============================================
 * 与 songloft 的 LiquidTabIndicator 同思路:350ms snappy spring,
 * 指示器位移和 jelly 形变都由 main thread 的关键帧驱动,切 tab 时不经过
 * background 的逐帧渲染。这里只保留窄屏底栏需要的 travel + jelly。
 */
const TAB_SPRING_DURATION_MS = 350;
const TAB_SETTLE_MS = 560;

interface TabSpring {
  from: number;
  target: number;
  velocity: number;
  startedAt: number;
}

interface TabMotionState {
  spring: TabSpring;
  travel?: MainThread.Animation;
  jelly?: MainThread.Animation;
}

function sampleTabSpring(spring: TabSpring, elapsedMs: number) {
  'main thread';
  const seconds = Math.max(0, elapsedMs) / 1000;
  if (elapsedMs >= TAB_SETTLE_MS)
    return { position: spring.target, velocity: 0 };
  const omega = (2 * Math.PI) / (TAB_SPRING_DURATION_MS / 1000);
  const decay = omega * 0.85;
  const frequency = omega * Math.sqrt(1 - 0.85 ** 2);
  const offset = spring.from - spring.target;
  const amplitude = (spring.velocity + decay * offset) / frequency;
  const cos = Math.cos(frequency * seconds);
  const sin = Math.sin(frequency * seconds);
  const envelope = Math.exp(-decay * seconds);
  return {
    position: spring.target + envelope * (offset * cos + amplitude * sin),
    velocity:
      envelope *
      ((amplitude * frequency - decay * offset) * cos -
        (offset * frequency + decay * amplitude) * sin),
  };
}

function tabJellyScale(velocity: number, slotCount: number) {
  'main thread';
  const alignmentVelocity =
    (Math.abs(velocity) * 2) / Math.max(1, slotCount - 1);
  const distortion = Math.min(alignmentVelocity / 10, 1) * 0.35;
  return { x: 1 - distortion * 0.5, y: 1 + distortion * 0.3 };
}

function tabSpringFrames(spring: TabSpring, slotCount: number) {
  'main thread';
  const travel: Record<string, string | number>[] = [];
  const jelly: Record<string, string | number>[] = [];
  for (let index = 0; index <= 36; index++) {
    const elapsed = (TAB_SETTLE_MS * index) / 36;
    const pose = sampleTabSpring(spring, elapsed);
    const squash = tabJellyScale(pose.velocity, slotCount);
    const engagement = Math.min(
      1,
      Math.abs(pose.velocity) / 2 + Math.abs(pose.position - spring.target) * 2,
    );
    travel.push({ transform: `translateX(${pose.position * 100}%)` });
    jelly.push({
      transform: `scaleX(${squash.x * (1 + 0.02 * engagement)}) scaleY(${
        squash.y * (1 + 0.02 * engagement)
      })`,
    });
  }
  return { travel, jelly };
}

function TabIndicator({ index, count }: { index: number; count: number }) {
  const travelRef = useMainThreadRef<MainThread.Element>(null);
  const jellyRef = useMainThreadRef<MainThread.Element>(null);
  const motionRef = useMainThreadRef<TabMotionState | null>(null);
  // 只固定首帧位置;后续位置由主线程动画写入,避免 background 的 style
  // 更新和动画抢同一个 transform。
  const [initialIndex] = useState(index);

  const update = useMemo(
    () =>
      runOnMainThread((target: number, slots: number, instant: boolean) => {
        'main thread';
        const previous = motionRef.current;
        const now = Date.now();
        const pose = previous
          ? sampleTabSpring(previous.spring, now - previous.spring.startedAt)
          : { position: target, velocity: 0 };
        previous?.travel?.cancel();
        previous?.jelly?.cancel();
        const travel = travelRef.current;
        const jelly = jellyRef.current;
        if (!travel || !jelly) return;

        travel.setStyleProperty('transform', `translateX(${target * 100}%)`);
        jelly.setStyleProperty('transform', 'scaleX(1) scaleY(1)');
        const spring: TabSpring = {
          from: pose.position,
          target,
          velocity: pose.velocity,
          startedAt: now,
        };
        if (
          instant ||
          !previous ||
          typeof travel.animate !== 'function' ||
          typeof jelly.animate !== 'function'
        ) {
          motionRef.current = {
            spring: {
              ...spring,
              from: target,
              velocity: 0,
              startedAt: now - TAB_SETTLE_MS,
            },
          };
          return;
        }
        const frames = tabSpringFrames(spring, slots);
        const options = {
          duration: TAB_SETTLE_MS,
          easing: 'linear',
          fill: 'forwards' as const,
        };
        motionRef.current = {
          spring,
          travel: travel.animate(frames.travel, options),
          jelly: jelly.animate(frames.jelly, options),
        };
      }),
    [],
  );

  useEffect(() => {
    void update(index, count, false);
  }, [index, count, update]);

  useEffect(
    () => () => {
      void update(0, 1, true);
    },
    [update],
  );

  return (
    <view
      className="nav-indicator"
      main-thread:ref={travelRef}
      style={{
        width: `${100 / count}%`,
        transform: `translateX(${initialIndex * 100}%)`,
      }}
    >
      <view className="nav-indicator__pill" main-thread:ref={jellyRef} />
    </view>
  );
}
