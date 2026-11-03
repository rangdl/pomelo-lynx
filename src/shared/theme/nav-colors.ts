import type { ColorScheme } from '../../native/system-appearance.js';
import type { ThemePaletteId } from './theme-palette-preference.js';

/**
 * 底栏图标颜色。
 *
 * 为什么不用 CSS 变量:图标是 `<svg content=...>`,颜色只能来自 SVG 字符串本身。
 * Lynx 的 `<svg>` 不跟随外层 color 级联,`current-color` 属性在 @lynx-js/types
 * 里也只标注了 Android 1.5 / iOS 4.1 / Harmony 4.0,没有 @Web;
 * @lynx-js/web-elements 的 XSvg 把 content 塞进 `<img>` 的 blob URL,
 * 完全不处理 current-color。因此在 TS 侧查表成具体色值,是唯一三端都成立的路径。
 *
 * 取值必须与 palettes.css 各变体的 `--color-primary`(active)
 * 和 `--color-on-surface-variant`(inactive)一致;
 * scripts/__tests__/theme-tokens.node-test.mjs 会逐项比对。
 */
const NAV_COLOR_TABLE: readonly (readonly [
  ThemePaletteId,
  ColorScheme,
  string,
  string,
])[] = [
  ['default', 'light', '#007aff', '#666666'],
  ['default', 'dark', '#4da3ff', '#b0b7c3'],
  ['violet', 'light', '#7c3aed', '#62576f'],
  ['violet', 'dark', '#b794ff', '#c1b5d0'],
  ['sunset', 'light', '#c2410c', '#6b5347'],
  ['sunset', 'dark', '#ff9a5a', '#d0b8a8'],
  ['teal', 'light', '#0f766e', '#496a64'],
  ['teal', 'dark', '#5eead4', '#a9c7c1'],
];

const NAV_COLORS = new Map(
  NAV_COLOR_TABLE.map(([palette, scheme, active, inactive]) => [
    `${palette}-${scheme}`,
    { active, inactive },
  ]),
);

/** 底栏图标色;未知组合回落到 default 的对应明暗。 */
export function navIconColor(
  palette: ThemePaletteId,
  scheme: ColorScheme,
  active: boolean,
): string {
  const pair =
    NAV_COLORS.get(`${palette}-${scheme}`) ??
    NAV_COLORS.get(`default-${scheme}`);
  // 表覆盖全部 8 种组合,回落分支只是类型安全兜底。
  return active ? (pair?.active ?? '#007aff') : (pair?.inactive ?? '#666666');
}
