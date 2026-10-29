import {
  runOnMainThread,
  useEffect,
  useMainThreadRef,
  useMemo,
  useState,
} from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';
import {
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';

import { type MessageKey, t } from '../../i18n/index.js';
import { subscribeNavigationBack } from '../../native/navigation.js';
import {
  readSystemAppearance,
  subscribeSystemAppearance,
} from '../../native/system-appearance.js';
import { isIosPlatform, isWebPlatform } from '../../native/web-platform.js';
import {
  resolveTheme,
  useAppearanceMode,
} from '../theme/appearance-preference.js';
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

/**
 * 底部导航外壳(仿 songloft-player-lynx 的窄屏底部导航样式,精简为双 tab)。
 * 当前激活项按路由前缀归属判断:/settings 及其子页(如 /settings/about)
 * 都点亮「设置」。
 */
export function ShellLayout() {
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [appearance, setAppearance] = useState(readSystemAppearance);
  const appearanceMode = useAppearanceMode();
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    setAppearance(readSystemAppearance());
    return subscribeSystemAppearance(setAppearance);
  }, []);

  // iOS 左边缘侧滑:只有子页响应;有历史就 pop,否则回设置根页。
  // 根 tab(首页/设置)不响应,避免把 tab 当成导航栈。
  useEffect(() => {
    if (!pathname.startsWith('/settings/')) return;
    return subscribeNavigationBack(() => {
      if (router.history.canGoBack()) {
        router.history.back();
        return;
      }
      navigate({
        to:
          pathname === '/settings/about/logs' ? '/settings/about' : '/settings',
      });
    });
  }, [navigate, pathname, router]);

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

  return (
    // iOS Lynx 移除 `.theme-dark` 后可能保留旧 CSS 变量;主题变化时重建
    // 整棵 shell,保证页面以新主题重新解析样式。
    <view
      key={theme}
      className={`shell theme-${theme}${
        pathname === '/' ? ' shell--home' : ''
      }`}
      data-testid="shell-root"
    >
      <view className="shell__body">
        <Outlet />
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
              bindtap={() => navigate({ to: tab.path })}
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
