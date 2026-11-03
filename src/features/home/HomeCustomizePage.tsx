import { useRef, useState } from '@lynx-js/react';
import { useNavigate } from '@tanstack/react-router';

import { ROUTE_PATHS } from '../../routes.js';
import {
  DEFAULT_HOME_SECTIONS,
  HOME_SECTION_LABELS,
  type HomeSectionConfig,
  type HomeSectionId,
  homeSectionsPreference,
  useHomeSections,
} from '../../shared/home/home-sections.js';
import { SettingsSubPage } from '../../shared/layouts/SettingsSubPage.js';
import { Button } from '../../shared/ui/Button.js';
import { Hint } from '../../shared/ui/Hint.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import {
  SettingsGroup,
  SettingsGroupDivider,
} from '../../shared/ui/SettingsGroup.js';
import { Switch } from '../../shared/ui/Switch.js';
import './HomeCustomizePage.css';

/** 单行高度(px),必须与 .home-custom__row 的 height 保持一致。 */
const ROW_HEIGHT = 64;

/** 取触点纵坐标;不同宿主给的字段不完全一致,按优先级兜底。 */
function touchY(event: {
  touches?: Array<{ clientY?: number; pageY?: number }>;
}) {
  const touch = event.touches?.[0];
  return touch?.clientY ?? touch?.pageY ?? null;
}

/**
 * 首页自定义页(/home/customize):调整首页条目的顺序与显隐。
 *
 * 两种排序方式并存:拖动行(触屏)与上移/下移按钮。按钮不是冗余——
 * 读屏用户无法拖动,无障碍必须有非手势的等价操作。
 * 每次变更立即写入偏好,首页通过订阅同步,无需返回时刷新。
 */
export function HomeCustomizePage() {
  const navigate = useNavigate();
  const sections = useHomeSections();
  // 拖动状态:起始行、起始纵坐标。用 ref 避免 move 期间重渲染丢值。
  const dragRef = useRef<{ index: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const commit = (next: readonly HomeSectionConfig[]) => {
    void homeSectionsPreference.setSections(next);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= sections.length || from === to) return;
    const next = [...sections];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    commit(next);
  };

  const toggle = (id: HomeSectionId, visible: boolean) => {
    commit(
      sections.map((section) =>
        section.id === id ? { ...section, visible } : section,
      ),
    );
  };

  const onTouchStart =
    (index: number) =>
    (event: { touches?: Array<{ clientY?: number; pageY?: number }> }) => {
      'background only';
      const y = touchY(event);
      if (y === null) return;
      dragRef.current = { index, y };
      setDragging(index);
    };

  const onTouchMove = (event: {
    touches?: Array<{ clientY?: number; pageY?: number }>;
  }) => {
    'background only';
    const drag = dragRef.current;
    if (!drag) return;
    const y = touchY(event);
    if (y === null) return;
    // 按整行高度换算成跨了几行;跨一行就立刻重排,并把基准点跟着移动,
    // 这样连续拖动可以一路换位,而不是攒到最后一次性跳。
    const steps = Math.round((y - drag.y) / ROW_HEIGHT);
    if (steps === 0) return;
    const from = drag.index;
    const to = Math.max(0, Math.min(sections.length - 1, from + steps));
    dragRef.current = { index: to, y: drag.y + (to - from) * ROW_HEIGHT };
    setDragging(to);
    move(from, to);
  };

  const onTouchEnd = () => {
    'background only';
    dragRef.current = null;
    setDragging(null);
  };

  const reset = () => {
    'background only';
    commit(DEFAULT_HOME_SECTIONS);
  };

  return (
    <SettingsSubPage
      title="自定义首页"
      backLabel="首页"
      onBack={() => navigate({ to: ROUTE_PATHS.home })}
      testid="home-customize-page"
      topbarTestid="home-customize-topbar"
      backTestid="home-customize-back"
      scrollTestid="home-customize-scroll"
    >
      <Hint tone="caption">
        拖动行可调整顺序,也可以点右侧箭头逐格移动;关掉开关即可在首页隐藏该条目。
      </Hint>

      <SettingsGroup title="首页条目">
        {sections.map((section, index) => (
          <view
            key={section.id}
            className={
              dragging === index
                ? 'home-custom__row home-custom__row--dragging'
                : 'home-custom__row'
            }
            bindtouchstart={onTouchStart(index)}
            bindtouchmove={onTouchMove}
            bindtouchend={onTouchEnd}
            bindtouchcancel={onTouchEnd}
            data-testid={`home-custom-row-${section.id}`}
          >
            <ListRow
              label={HOME_SECTION_LABELS[section.id]}
              trailing={
                <view className="home-custom__trailing">
                  <Button
                    variant="text"
                    icon="↑"
                    label="上移"
                    disabled={index === 0}
                    stopPropagation
                    onTap={() => move(index, index - 1)}
                    testid={`home-custom-up-${section.id}`}
                  />
                  <Button
                    variant="text"
                    icon="↓"
                    label="下移"
                    disabled={index === sections.length - 1}
                    stopPropagation
                    onTap={() => move(index, index + 1)}
                    testid={`home-custom-down-${section.id}`}
                  />
                  <Switch
                    checked={section.visible}
                    onChange={(visible) => toggle(section.id, visible)}
                    label={HOME_SECTION_LABELS[section.id]}
                    testid={`home-custom-switch-${section.id}`}
                  />
                </view>
              }
            />
            {index < sections.length - 1 ? <SettingsGroupDivider /> : null}
          </view>
        ))}
      </SettingsGroup>

      <view className="home-custom__actions">
        <Button
          grow
          variant="secondary"
          label="恢复默认"
          onTap={reset}
          testid="home-custom-reset"
        />
      </view>
    </SettingsSubPage>
  );
}
