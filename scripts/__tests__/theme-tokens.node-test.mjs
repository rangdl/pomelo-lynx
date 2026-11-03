import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * 主题 token 契约闸门。
 *
 * iOS Lynx 在切换 class 后不会可靠回退到 :root 值,因此每个
 * `theme-<palette>-<scheme>` 变体都必须自包含全部颜色角色,不能靠叠加。
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TOKENS = readFileSync(join(ROOT, 'src/shared/theme/tokens.css'), 'utf8');
const PALETTES = readFileSync(
  join(ROOT, 'src/shared/theme/palettes.css'),
  'utf8',
);

function block(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.ok(start >= 0, `缺少 ${selector} 规则`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  assert.ok(close > open, `${selector} 规则未闭合`);
  return source.slice(open + 1, close);
}

function variables(source) {
  return [...source.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map(
    (match) => match[1],
  );
}

const PALETTES_IDS = ['default', 'violet', 'sunset', 'teal'];
const VARIANTS = PALETTES_IDS.flatMap((palette) => [
  `.theme-${palette}-light`,
  `.theme-${palette}-dark`,
]);

const REQUIRED = [
  '--color-surface',
  '--color-surface-container-low',
  '--color-surface-container',
  '--color-surface-container-high',
  '--color-on-surface',
  '--color-on-surface-variant',
  '--color-on-surface-faint',
  '--color-primary',
  '--color-on-primary',
  '--color-primary-container',
  '--color-on-primary-container',
  '--color-secondary',
  '--color-on-secondary',
  '--color-secondary-container',
  '--color-on-secondary-container',
  '--color-outline',
  '--color-outline-variant',
  '--color-error',
  '--color-on-error',
  '--color-shadow',
];

test('每个主题变体都自包含核心颜色角色', () => {
  for (const selector of VARIANTS) {
    const present = new Set(variables(block(PALETTES, selector)));
    for (const name of REQUIRED) {
      assert.ok(present.has(name), `${selector} 缺少核心角色 ${name}`);
    }
  }
});

test('每个 palette 的 light 显式覆盖对应 dark 的全部 token', () => {
  for (const palette of PALETTES_IDS) {
    const dark = new Set(variables(block(PALETTES, `.theme-${palette}-dark`)));
    const light = new Set(
      variables(block(PALETTES, `.theme-${palette}-light`)),
    );
    for (const name of dark) {
      assert.ok(
        light.has(name),
        `.theme-${palette}-light 缺少 ${name};d→浅切换会保留深色值`,
      );
    }
  }
});

test('每个 light 变体覆盖 :root 的所有颜色 token', () => {
  const root = variables(block(TOKENS, ':root')).filter(
    (name) => !name.startsWith('--safe-'),
  );
  for (const palette of PALETTES_IDS) {
    const light = new Set(
      variables(block(PALETTES, `.theme-${palette}-light`)),
    );
    for (const name of root) {
      assert.ok(
        light.has(name),
        `.theme-${palette}-light 缺少 :root 中的 ${name}`,
      );
    }
  }
});

test('ShellLayout 直接切换完整 variant class,不重建页面树', () => {
  const source = readFileSync(
    join(ROOT, 'src/shared/layouts/ShellLayout.tsx'),
    'utf8',
  );
  assert.match(source, /resolveThemeVariant\(themePalette, theme\)/);
  assert.doesNotMatch(
    source,
    /key=\{themeVariant\}/,
    '切主题不应重建 Shell,否则页面状态丢失且会重播进入动画',
  );
  assert.match(source, /theme-\$\{themeVariant\}/);
  assert.match(source, /scheme-\$\{theme\}/);
});

/** 读 palette 变体里的单个颜色 token,供 TS 映射对拍。 */
function colorOf(palette, scheme, name) {
  const body = block(PALETTES, `.theme-${palette}-${scheme}`);
  const match = body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  assert.ok(match, `.theme-${palette}-${scheme} 缺少 ${name}`);
  return match[1].trim().toLowerCase();
}

test('底栏图标颜色 TS 映射与 palettes.css 各变体一致', () => {
  const source = readFileSync(
    join(ROOT, 'src/shared/theme/nav-colors.ts'),
    'utf8',
  );
  // 表项形如 ['default', 'light', '#007aff', '#666666'],
  const rows = [
    ...source.matchAll(
      /\[\s*'(\w+)'\s*,\s*'(light|dark)'\s*,\s*'(#[0-9a-fA-F]{6})'\s*,\s*'(#[0-9a-fA-F]{6})'\s*\]/g,
    ),
  ].map(([, palette, scheme, active, inactive]) => ({
    palette,
    scheme,
    active,
    inactive,
  }));

  assert.equal(
    rows.length,
    PALETTES_IDS.length * 2,
    '每个 palette × scheme 都必须有底栏配色,否则切主题后图标色不同步',
  );

  for (const row of rows) {
    assert.equal(
      colorOf(row.palette, row.scheme, '--color-primary'),
      row.active.toLowerCase(),
      `${row.palette}-${row.scheme} 的选中色应与 --color-primary 一致`,
    );
    assert.equal(
      colorOf(row.palette, row.scheme, '--color-on-surface-variant'),
      row.inactive.toLowerCase(),
      `${row.palette}-${row.scheme} 的未选中色应与 --color-on-surface-variant 一致`,
    );
  }
});
