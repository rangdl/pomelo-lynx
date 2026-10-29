import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * 主题 token 契约闸门。
 *
 * iOS Lynx 在移除 `.theme-dark` 后不会把继承的 CSS 变量恢复成 `:root`
 * 值:d→浅切换时页面会继续沿用上一次的深色 token。因此 `.theme-light`
 * 必须显式覆盖 `.theme-dark` 里的每一个变量,不能只依赖默认值。
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CSS = readFileSync(join(ROOT, 'src/shared/theme/tokens.css'), 'utf8');

function block(selector) {
  const start = CSS.indexOf(`${selector} {`);
  assert.ok(start >= 0, `tokens.css 缺少 ${selector} 规则`);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('}', open);
  assert.ok(close > open, `${selector} 规则未闭合`);
  return CSS.slice(open + 1, close);
}

function variables(source) {
  return [...source.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map(
    (match) => match[1],
  );
}

test('theme-light 显式覆盖 theme-dark 的每个 token', () => {
  const dark = new Set(variables(block('.theme-dark')));
  const light = new Set(variables(block('.theme-light')));
  for (const name of dark) {
    assert.ok(
      light.has(name),
      `.theme-light 缺少 ${name};从深色切回浅色时该变量会保留深色值`,
    );
  }
});

test('theme-light 覆盖 :root 的所有颜色 token', () => {
  const root = variables(block(':root')).filter(
    (name) => !name.startsWith('--safe-'),
  );
  const light = new Set(variables(block('.theme-light')));
  for (const name of root) {
    assert.ok(
      light.has(name),
      `.theme-light 缺少 :root 中的 ${name};新增颜色 token 时需同步浅色规则`,
    );
  }
});

test('ShellLayout 在主题变化时重建根视图', () => {
  const source = readFileSync(
    join(ROOT, 'src/shared/layouts/ShellLayout.tsx'),
    'utf8',
  );
  assert.match(
    source,
    /key=\{theme\}/,
    'ShellLayout 根 view 必须用 theme 作为 key,iOS 才能丢弃旧的 CSS 变量缓存',
  );
});
