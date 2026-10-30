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

const PALETTES_IDS = ['default', 'violet'];
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

test('ShellLayout 使用完整 variant class 并在切换时重建', () => {
  const source = readFileSync(
    join(ROOT, 'src/shared/layouts/ShellLayout.tsx'),
    'utf8',
  );
  assert.match(source, /const themeVariant = `default-\$\{theme\}`/);
  assert.match(source, /key=\{themeVariant\}/);
  assert.match(source, /theme-\$\{themeVariant\}/);
  assert.match(source, /scheme-\$\{theme\}/);
});
