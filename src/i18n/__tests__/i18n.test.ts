import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

import { currentLocale, t } from '../index.js';

const globals = globalThis as unknown as { lynx?: unknown };

describe('i18n', () => {
  beforeEach(() => {
    globals.lynx = undefined;
  });

  afterEach(() => {
    globals.lynx = undefined;
  });

  test('默认中文', () => {
    expect(currentLocale()).toBe('zh');
    expect(t('settings.title')).toBe('设置');
  });

  test('宿主语言为英文时使用英文词典', () => {
    globals.lynx = { __globalProps: { language: 'en-US' } };
    expect(currentLocale()).toBe('en');
    expect(t('settings.title')).toBe('Settings');
    expect(t('about.copy')).toBe('Copy version info');
  });

  test('未知语言回落中文', () => {
    globals.lynx = { __globalProps: { language: 'fr-FR' } };
    expect(currentLocale()).toBe('zh');
    expect(t('nav.home')).toBe('首页');
  });
});
