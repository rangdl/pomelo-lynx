import { beforeEach, describe, expect, test } from '@rstest/core';

import { createMemoryStorage, setPomeloStorage } from '../../storage/index.js';
import {
  DEFAULT_UPDATE_PROXY,
  PREF_UPDATE_PROXY,
  PREF_UPDATE_PROXY_ENABLED,
  readUpdateProxy,
  readUpdateProxySettings,
  writeUpdateProxySettings,
} from '../update-preferences.js';

describe('update proxy preferences', () => {
  beforeEach(() => {
    setPomeloStorage(createMemoryStorage());
  });

  test('默认开启并使用内置加速地址', async () => {
    await expect(readUpdateProxySettings()).resolves.toEqual({
      enabled: true,
      address: DEFAULT_UPDATE_PROXY,
    });
  });

  test('保存自定义地址与关闭状态并持久化', async () => {
    await writeUpdateProxySettings({
      enabled: false,
      address: 'https://proxy.example/github',
    });
    await expect(readUpdateProxySettings()).resolves.toEqual({
      enabled: false,
      address: 'https://proxy.example/github',
    });
    await expect(readUpdateProxy()).resolves.toBe('');
  });

  test('开启时代理地址参与更新链路', async () => {
    await writeUpdateProxySettings({
      enabled: true,
      address: 'https://proxy.example',
    });
    await expect(readUpdateProxy()).resolves.toBe('https://proxy.example');
  });

  test('非法存储值回退到默认地址,非法写入被拒绝', async () => {
    const storage = createMemoryStorage();
    await storage.prefs.set(PREF_UPDATE_PROXY, 'http://user:pass@proxy');
    setPomeloStorage(storage);
    await expect(readUpdateProxySettings()).resolves.toMatchObject({
      address: DEFAULT_UPDATE_PROXY,
    });
    await expect(
      writeUpdateProxySettings({
        enabled: true,
        address: 'http://proxy.example',
      }),
    ).rejects.toThrow('invalid_update_proxy');
  });

  test('禁用后不会把代理地址传给更新链路', async () => {
    const storage = createMemoryStorage();
    await storage.prefs.set(PREF_UPDATE_PROXY_ENABLED, 'false');
    await storage.prefs.set(PREF_UPDATE_PROXY, 'https://proxy.example');
    setPomeloStorage(storage);
    await expect(readUpdateProxy()).resolves.toBe('');
  });
});
