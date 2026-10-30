import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * UI 交互契约:底栏指示器、外观下拉、页面转场与键盘避让。
 * 这些行为依赖平台相关细节,单测之外用源码闸门防止被改回旧实现。
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

test('底栏指示器固定高度并由父层居中', () => {
  const css = read('src/shared/layouts/ShellLayout.css');
  const indicator = css.match(/\.nav-indicator \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const pill = css.match(/\.nav-indicator__pill \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(indicator, /top: 0;/);
  assert.match(indicator, /bottom: 0;/);
  assert.doesNotMatch(
    indicator,
    /top: \d+px;/,
    '父层不能用 top 偏移,否则 iOS 上下边距不一致',
  );
  assert.match(pill, /height: 48px;/);
});

test('外观下拉是右侧锚定的绝对定位浮层', () => {
  const page = read('src/features/settings/SettingsPage.tsx');
  assert.match(page, /appearance-anchor/);
  assert.match(page, /appearance-popover/);
  assert.match(page, /appearance-trigger/);
  assert.match(page, /appearance-option-divider/);
  assert.doesNotMatch(
    page,
    /onTap=\{toggleAppearanceMenu\}/,
    '只有右侧下拉控件可点,整行不能绑定打开菜单',
  );
  assert.doesNotMatch(
    page,
    /boundingClientRect/,
    'Web 不支持 boundingClientRect;不要用它给下拉测位',
  );
  const css = read('src/features/settings/settings.css');
  const popover = css.match(/\.appearance-popover \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(popover, /position: absolute;/);
  assert.match(popover, /right: 0;/);
  assert.match(popover, /width: 208px;/);
  assert.match(css, /appearance-popover-in/);
  assert.match(css, /appearance-option-divider/);
  assert.match(css, /appearance-select__caret--open/);
  assert.doesNotMatch(
    page,
    /[▴▾]/,
    '下拉箭头应使用 CSS chevron,不要用字体字形',
  );
});

test('自动更新使用开关而不是文字状态', () => {
  const section = read('src/features/settings/ClientUpdateSection.tsx');
  assert.match(section, /client-update__switch/);
  assert.match(section, /client-update__switch-hit/);
  assert.doesNotMatch(section, /已开启|已关闭/);
  const css = read('src/features/settings/ClientUpdateSection.css');
  assert.match(css, /translateX\(20px\)/);
  assert.match(css, /height: 44px;/);
});

test('页面切换有 push/pop/fade 挂载动画', () => {
  const layout = read('src/shared/layouts/ShellLayout.tsx');
  assert.match(layout, /PAGE_STACKS/);
  assert.match(layout, /stackFor\(pathname\)/);
  assert.match(layout, /key=\{path\}/);
  assert.match(layout, /shell__page--\$\{pageDirection\}/);
  assert.match(layout, /page-stack/);
  const css = read('src/shared/layouts/ShellLayout.css');
  assert.match(css, /\.shell__page-layer/);
  for (const name of ['push', 'pop', 'fade']) {
    assert.match(css, new RegExp(`@keyframes shell-page-${name}`));
  }
  assert.match(
    css,
    /fill-mode: backwards|backwards;/,
    '动画结束后不能留下 transform,否则 fixed 浮层会改为相对页面定位',
  );
});

test('侧滑跟手由主线程平移并与路由开关联动', () => {
  const layout = read('src/shared/layouts/ShellLayout.tsx');
  assert.match(layout, /main-thread:ref=\{pageRef\}/);
  assert.match(layout, /subscribeNavigationSwipe/);
  assert.match(layout, /setNativeEdgeBackEnabled/);
  assert.match(layout, /lastSettingsPathRef/);
  assert.match(layout, /parentPath\(pathname\)/);
  assert.doesNotMatch(
    layout,
    /history\.back\(/,
    '返回必须走当前 tab 的栈父级,不能用全局 history.back',
  );
  const navigation = read('src/native/navigation.ts');
  assert.match(navigation, /PomeloNavigation\.swipe/);
});

test('开发者页输入框启用键盘避让', () => {
  for (const file of [
    'src/features/settings/DevServerSection.tsx',
    'src/features/settings/DebugTunnelSection.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /avoid-keyboard=\{true\}/, file);
    assert.match(source, /avoid-keyboard-spacing="12px"/, file);
    assert.match(source, /set-soft-input-mode="resize"/, file);
  }
});
