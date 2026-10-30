import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

import {
  type ClientIdentity,
  formatDisplayVersion,
  readBundleDisplayVersion,
  readClientIdentity,
} from '../client-identity.js';

const globals = globalThis as unknown as { lynx?: unknown };

describe('client identity', () => {
  beforeEach(() => {
    globals.lynx = undefined;
  });
  afterEach(() => {
    globals.lynx = undefined;
  });

  test('stable/dev 展示版本带通道前缀,构建号放在括号里', () => {
    expect(
      formatDisplayVersion({
        channel: 'stable',
        version: '0.0.3',
        build_number: 125,
      }),
    ).toBe('0.0.3 (125)');
    expect(
      formatDisplayVersion({
        channel: 'dev',
        version: '0.0.3',
        build_number: 125,
      }),
    ).toBe('dev-0.0.3 (125)');
    expect(formatDisplayVersion({ channel: 'stable', version: '0.0.3' })).toBe(
      '0.0.3',
    );
  });

  test('优先读取宿主注入的版本、构建号和通道', () => {
    globals.lynx = {
      __globalProps: {
        hostVersion: '0.0.3',
        hostBuild: '125',
        hostChannel: 'stable',
      },
    };
    expect(readClientIdentity()).toMatchObject({
      version: '0.0.3',
      build_number: 125,
      channel: 'stable',
      display_version: '0.0.3 (125)',
    });
  });

  test('宿主版本带 dev- 前缀时归一化为 semver', () => {
    globals.lynx = {
      __globalProps: {
        hostVersion: 'dev-0.0.3',
        hostBuild: 126,
        hostChannel: 'dev',
      },
    };
    expect(readClientIdentity()).toMatchObject({
      version: '0.0.3',
      build_number: 126,
      channel: 'dev',
      display_version: 'dev-0.0.3 (126)',
    });
  });

  test('旧宿主缺少字段时回退到 bundle 身份,非法构建号被忽略', () => {
    globals.lynx = {
      __globalProps: {
        hostVersion: 'not-semver',
        hostBuild: '-1',
        hostChannel: 'nightly',
      },
    };
    const identity: ClientIdentity = readClientIdentity();
    expect(identity.version).toBe('0.0.0');
    expect(identity.channel).toBe('dev');
    expect(identity.build_number).toBe(1);
    expect(readBundleDisplayVersion()).toBe('dev-0.0.0 (1)');
  });
});
