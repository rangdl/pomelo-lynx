import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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

test('开关统一使用 Switch/SwitchRow,不再在业务区复制 CSS', () => {
  const section = read('src/features/settings/BundleUpdateSection.tsx');
  assert.match(section, /SwitchRow/);
  assert.doesNotMatch(section, /client-update__switch/);
  assert.doesNotMatch(section, /已开启|已关闭/);

  const proxy = read('src/features/settings/UpdateProxySection.tsx');
  assert.match(proxy, /SwitchRow/);
  assert.doesNotMatch(proxy, /update-proxy__switch/);

  const shared = read('src/shared/ui/Switch.tsx');
  assert.match(shared, /accessibility-label/);
  const css = read('src/shared/ui/Switch.css');
  assert.match(css, /translateX\(20px\)/);
  assert.match(css, /height: var\(--tap-target\)/);
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

test('设置页每项有描述,关于页版本行使用 value + detail', () => {
  const settings = read('src/features/settings/SettingsPage.tsx');
  for (const key of [
    'settings.aboutDetail',
    'appearance.themeDetail',
    'settings.themePaletteDetail',
    'settings.developerDetail',
  ]) {
    assert.match(settings, new RegExp(key.replaceAll('.', '\\.')));
  }
  const about = read('src/features/settings/AboutPage.tsx');
  assert.match(about, /about\.client/);
  assert.match(about, /clientBuild\.git_commit/);
  assert.match(about, /clientBuild\.channel/);
  assert.doesNotMatch(about, /about\.hostVersion/);
});

test('日志入口移到设置页独立路由,关于页不再放日志', () => {
  const settings = read('src/features/settings/SettingsPage.tsx');
  assert.match(settings, /settings-row-logs/);
  assert.match(settings, /settings\.logsDetail/);
  const about = read('src/features/settings/AboutPage.tsx');
  assert.doesNotMatch(about, /about\.logs/);
  assert.match(about, /about\.client/);
  const logs = read('src/features/settings/LogsPage.tsx');
  assert.match(logs, /navigate\(\{ to: '\/settings' \}\)/);
  const router = read('src/router.tsx');
  assert.match(router, /path: '\/settings\/logs'/);
  assert.doesNotMatch(router, /settings\/about\/logs/);
});

test('更新区使用 ListRow,且不再渲染重复版本行', () => {
  const section = read('src/features/settings/BundleUpdateSection.tsx');
  assert.match(section, /<ListRow/);
  assert.doesNotMatch(section, /className="settings-row/);
  assert.doesNotMatch(section, /Bundle 版本|宿主版本/);
});

test('客户端更新与 Bundle 热更新拆成两个分组,下载合并为单入口', () => {
  const about = read('src/features/settings/AboutPage.tsx');
  assert.match(about, /ClientReleaseSection/);
  assert.match(about, /BundleUpdateSection/);
  assert.match(about, /about\.group\.clientUpdate/);
  assert.match(about, /about\.group\.bundleUpdate/);
  assert.doesNotMatch(
    about,
    /about-row-release/,
    '发布页入口应移入客户端更新组件',
  );

  const client = read('src/features/settings/ClientReleaseSection.tsx');
  assert.match(client, /client-release-download/);
  assert.match(client, /about\.openDownload/);
  assert.doesNotMatch(client, /client-release-download-github/);
  assert.doesNotMatch(client, /client-release-download-accelerated/);
  assert.match(client, /about-row-release/);
  assert.match(client, /checkClientRelease/);
  assert.match(client, /readUpdateProxy/);
  assert.match(client, /about\.changes/);

  const bundle = read('src/features/settings/BundleUpdateSection.tsx');
  assert.doesNotMatch(bundle, /client-release-download/);
});

test('加速设置同时接入两个更新链路并支持默认地址/自定义/开关', () => {
  const about = read('src/features/settings/AboutPage.tsx');
  assert.match(about, /UpdateProxySection/);
  assert.match(about, /about\.group\.acceleration/);

  const section = read('src/features/settings/UpdateProxySection.tsx');
  assert.match(section, /使用代理更新/);
  assert.doesNotMatch(section, /使用更新代理/);
  assert.match(section, /update-proxy-switch/);
  assert.match(section, /update-proxy-input/);
  assert.match(section, /DEFAULT_UPDATE_PROXY/);
  assert.match(section, /readUpdateProxySettings/);
  assert.match(section, /writeUpdateProxySettings/);
  assert.match(section, /TextField/);
  assert.doesNotMatch(section, /avoid-keyboard/);

  const prefs = read('src/core/updater/update-preferences.ts');
  assert.match(prefs, /update_proxy_enabled/);
  assert.match(prefs, /DEFAULT_UPDATE_PROXY/);
  assert.match(prefs, /readUpdateProxy\(/);
});

test('主题色子页覆盖四个调色板并接入设置与路由', () => {
  const meta = read('src/shared/theme/theme-palettes.ts');
  for (const id of ['default', 'violet', 'sunset', 'teal']) {
    assert.match(meta, new RegExp(`id: '${id}'`));
  }
  const page = read('src/features/settings/ThemePalettePage.tsx');
  assert.match(page, /ThemePaletteCard/);
  const card = read('src/features/settings/ThemePaletteCard.tsx');
  assert.match(card, /theme-\$\{option\.id\}-\$\{scheme\}/);
  assert.match(card, /PaletteSwatches/);
  const settings = read('src/features/settings/SettingsPage.tsx');
  assert.match(settings, /settings-row-theme-palette/);
  assert.match(settings, /PaletteSwatches/);
  const router = read('src/router.tsx');
  assert.match(router, /path: '\/settings\/theme'/);
});

test('开发者页统一使用 TextField/Button,键盘避让只在共享组件里', () => {
  for (const file of [
    'src/features/settings/DevServerSection.tsx',
    'src/features/settings/DebugTunnelSection.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /TextField/, file);
    assert.match(source, /Button/, file);
    assert.doesNotMatch(source, /avoid-keyboard/, file);
    assert.doesNotMatch(source, /dev-server__input-frame/, file);
  }
  const field = read('src/shared/ui/TextField.tsx');
  assert.match(field, /avoid-keyboard=\{true\}/);
  assert.match(field, /avoid-keyboard-spacing="12px"/);
  assert.match(field, /set-soft-input-mode="resize"/);
  assert.match(field, /bindblur=/);
  const css = read('src/shared/ui/TextField.css');
  assert.match(css, /border-color: var\(--color-outline\)/);
  assert.match(css, /\.text-field__frame--focused/);
});

test('标准滚动子页统一使用 SettingsSubPage', () => {
  for (const file of [
    'src/features/settings/AboutPage.tsx',
    'src/features/settings/DeveloperPage.tsx',
    'src/features/settings/ThemePalettePage.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /SettingsSubPage/, file);
    assert.doesNotMatch(source, /<PageTopBar/, file);
  }
  const settings = read('src/features/settings/SettingsPage.tsx');
  assert.match(settings, /SettingsLargeTitle/);
  assert.match(settings, /PageTail/);
});

test('业务页面禁止重新手写图标颜色和输入框属性', () => {
  for (const file of [
    'src/features/settings/SettingsPage.tsx',
    'src/features/settings/AboutPage.tsx',
    'src/features/settings/BundleUpdateSection.tsx',
    'src/features/settings/ClientReleaseSection.tsx',
    'src/features/settings/UpdateProxySection.tsx',
    'src/features/settings/DevServerSection.tsx',
    'src/features/settings/DebugTunnelSection.tsx',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /iconColor=/, file);
    assert.doesNotMatch(source, /avoid-keyboard/, file);
  }
  assert.doesNotMatch(
    read('src/features/settings/BundleUpdateSection.css'),
    /__switch/,
  );
  assert.doesNotMatch(
    read('src/features/settings/UpdateProxySection.css'),
    /__switch|input-frame/,
  );
});

test('feature CSS 不再重复共享控件样式', () => {
  const dir = join(ROOT, 'src/features/settings');
  const forbidden = [
    '__switch',
    'input-frame',
    'dev-server__btn',
    'client-update__note',
    'client-update__error',
    'client-release__note',
    'client-release__error',
    'update-proxy__note',
    'update-proxy__error',
    'dev-server__note',
    'dev-server__error',
    'dev-server__draft',
    'dev-server__section-title',
    'dev-server__status',
  ];
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.css'))) {
    const css = readFileSync(join(dir, name), 'utf8');
    for (const token of forbidden) {
      assert.doesNotMatch(
        css,
        new RegExp(token.replaceAll('-', '\\-')),
        `${name}: ${token} 应立即使用共享组件`,
      );
    }
  }
});
