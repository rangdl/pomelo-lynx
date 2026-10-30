import { expect, test } from '@rstest/core';

import { createMemoryStorage } from '../../../core/storage/index.js';
import {
  DEFAULT_THEME_PALETTE,
  resolveThemeVariant,
  THEME_PALETTE_PREF_KEY,
  type ThemePaletteId,
  ThemePalettePreference,
} from '../theme-palette-preference.js';

test('resolveThemeVariant 组合 palette 与明暗', () => {
  expect(resolveThemeVariant('default', 'light')).toBe('default-light');
  expect(resolveThemeVariant('violet', 'dark')).toBe('violet-dark');
});

test('默认调色板是 default,hydrate 读取已保存值', async () => {
  const storage = createMemoryStorage();
  const preference = new ThemePalettePreference(() => storage);
  expect(preference.getPalette()).toBe(DEFAULT_THEME_PALETTE);

  await storage.prefs.set(THEME_PALETTE_PREF_KEY, 'violet');
  await preference.hydrate();
  expect(preference.getPalette()).toBe('violet');
});

test('setPalette 持久化并通知订阅者', async () => {
  const storage = createMemoryStorage();
  const preference = new ThemePalettePreference(() => storage);
  const seen: ThemePaletteId[] = [];
  preference.subscribe(() => seen.push(preference.getPalette()));

  await preference.setPalette('violet');
  expect(preference.getPalette()).toBe('violet');
  expect(await storage.prefs.get(THEME_PALETTE_PREF_KEY)).toBe('violet');
  expect(seen).toEqual(['violet']);
});

test('非法调色板回落 default', async () => {
  const storage = createMemoryStorage();
  await storage.prefs.set(THEME_PALETTE_PREF_KEY, 'sepia');
  const preference = new ThemePalettePreference(() => storage);
  await preference.hydrate();
  expect(preference.getPalette()).toBe(DEFAULT_THEME_PALETTE);
});

test('用户先选择时,迟到的 hydrate 不覆盖', async () => {
  const storage = createMemoryStorage();
  await storage.prefs.set(THEME_PALETTE_PREF_KEY, 'violet');
  const preference = new ThemePalettePreference(() => storage);

  await preference.setPalette('default');
  await preference.hydrate();
  expect(preference.getPalette()).toBe('default');
});
