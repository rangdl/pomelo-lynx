import { expect, test } from '@rstest/core';

import { createMemoryStorage } from '../../../core/storage/index.js';
import {
  APPEARANCE_PREF_KEY,
  type AppearanceMode,
  AppearancePreference,
  resolveTheme,
} from '../appearance-preference.js';

test('resolveTheme 跟随系统或使用固定值', () => {
  expect(resolveTheme('system', 'dark')).toBe('dark');
  expect(resolveTheme('system', 'light')).toBe('light');
  expect(resolveTheme('light', 'dark')).toBe('light');
  expect(resolveTheme('dark', 'light')).toBe('dark');
});

test('hydrate 读取已保存的偏好', async () => {
  const storage = createMemoryStorage();
  await storage.prefs.set(APPEARANCE_PREF_KEY, 'dark');
  const preference = new AppearancePreference(() => storage);
  await preference.hydrate();
  expect(preference.getMode()).toBe('dark');
});

test('setMode 持久化并通知订阅者', async () => {
  const storage = createMemoryStorage();
  const preference = new AppearancePreference(() => storage);
  const seen: AppearanceMode[] = [];
  preference.subscribe(() => seen.push(preference.getMode()));

  await preference.setMode('light');
  expect(preference.getMode()).toBe('light');
  expect(await storage.prefs.get(APPEARANCE_PREF_KEY)).toBe('light');
  expect(seen).toEqual(['light']);
});

test('非法偏好回落 system', async () => {
  const storage = createMemoryStorage();
  await storage.prefs.set(APPEARANCE_PREF_KEY, 'sepia');
  const preference = new AppearancePreference(() => storage);
  await preference.hydrate();
  expect(preference.getMode()).toBe('system');
});

test('用户先选择时,迟到的 hydrate 不覆盖', async () => {
  const storage = createMemoryStorage();
  await storage.prefs.set(APPEARANCE_PREF_KEY, 'dark');
  const preference = new AppearancePreference(() => storage);

  await preference.setMode('light');
  await preference.hydrate();
  expect(preference.getMode()).toBe('light');
});
