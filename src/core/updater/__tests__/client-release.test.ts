import { describe, expect, test } from '@rstest/core';
import type { ClientIdentity } from '../../config/client-identity.js';
import {
  buildClientDownloadLinks,
  type ClientReleaseMetadata,
  ClientReleaseResolver,
  checkClientRelease,
  compareClientRelease,
  DEFAULT_CLIENT_DOWNLOAD_PROXY,
  parseClientRelease,
} from '../client-release.js';
import { RELEASE_REPOSITORY } from '../release-resolver.js';

const SHA = 'a'.repeat(64);
const IPA = 'pomelo-lynx-ios-nosign.ipa';

function metadata(channel: 'dev' | 'stable' = 'stable'): ClientReleaseMetadata {
  return {
    schema: 1,
    channel,
    version: '0.0.3',
    display_version: channel === 'dev' ? 'dev-0.0.3' : '0.0.3',
    build_number: channel === 'dev' ? 101 : 125,
    git_commit: 'abcdef0',
    build_time: '2026-10-30T00:00:00.000Z',
    release_tag: channel === 'dev' ? 'dev' : 'v0.0.3',
    ...(channel === 'dev' ? { build_tag: 'dev-v0.0.3-abcdef0' } : {}),
    changes: ['新增：客户端更新检查', '修复：下载链接'],
    assets: [{ platform: 'ios', name: IPA, size: 1234, sha256: SHA }],
  };
}

function release(channel: 'dev' | 'stable' = 'stable') {
  const value = metadata(channel);
  const tag = value.release_tag;
  return {
    tag_name: tag,
    draft: false,
    prerelease: channel === 'dev',
    assets: [
      {
        name: 'client.json',
        size: JSON.stringify(value).length,
        browser_download_url: `${RELEASE_REPOSITORY}/releases/download/${tag}/client.json`,
      },
      {
        name: IPA,
        size: value.assets[0].size,
        browser_download_url: `${RELEASE_REPOSITORY}/releases/download/${tag}/${IPA}`,
      },
    ],
  };
}

function fetchFor(channel: 'dev' | 'stable' = 'stable') {
  const data = release(channel);
  return async (url: string) => ({
    status: 200,
    body: url.includes('api.github.com')
      ? JSON.stringify(data)
      : JSON.stringify(metadata(channel)),
  });
}

function current(patch: Partial<ClientIdentity> = {}): ClientIdentity {
  return {
    package_version: '0.0.2',
    version: '0.0.2',
    build_number: 2,
    channel: 'stable',
    git_commit: '1234567',
    display_version: '0.0.2 (2)',
    ...patch,
  };
}

describe('client release metadata', () => {
  test('接受与 release tag 一致的 stable/dev 元数据', () => {
    expect(
      parseClientRelease(metadata('stable'), 'stable', 'v0.0.3'),
    ).toMatchObject({
      channel: 'stable',
      version: '0.0.3',
      display_version: '0.0.3',
    });
    expect(parseClientRelease(metadata('dev'), 'dev', 'dev')).toMatchObject({
      channel: 'dev',
      display_version: 'dev-0.0.3',
      build_tag: 'dev-v0.0.3-abcdef0',
    });
  });

  test('拒绝通道、tag、展示版本和资产摘要不一致', () => {
    for (const change of [
      { channel: 'dev' },
      { release_tag: 'v0.0.4' },
      { display_version: 'dev-0.0.3' },
      { build_number: 0 },
      { changes: [''] },
      { assets: [{ platform: 'ios', name: IPA, size: 0, sha256: SHA }] },
      { assets: [{ platform: 'ios', name: IPA, size: 1, sha256: 'x' }] },
    ]) {
      expect(() =>
        parseClientRelease(
          { ...metadata('stable'), ...change },
          'stable',
          'v0.0.3',
        ),
      ).toThrow();
    }
  });
});

describe('client release comparison', () => {
  test('stable 先比 semver,再比构建号', () => {
    expect(compareClientRelease(current(), metadata('stable'))).toBe('newer');
    expect(
      compareClientRelease(
        current({
          version: '0.0.3',
          package_version: '0.0.3',
          build_number: 124,
        }),
        metadata('stable'),
      ),
    ).toBe('newer');
    expect(
      compareClientRelease(
        current({
          version: '0.0.3',
          package_version: '0.0.3',
          build_number: 125,
        }),
        metadata('stable'),
      ),
    ).toBe('current');
    expect(
      compareClientRelease(
        current({
          version: '0.0.4',
          package_version: '0.0.4',
          build_number: 1,
        }),
        metadata('stable'),
      ),
    ).toBe('current');
  });

  test('dev 只按构建号判断,跨通道返回 unknown', () => {
    const dev = metadata('dev');
    expect(
      compareClientRelease(current({ channel: 'dev', build_number: 100 }), dev),
    ).toBe('newer');
    expect(
      compareClientRelease(current({ channel: 'dev', build_number: 101 }), dev),
    ).toBe('current');
    expect(
      compareClientRelease(
        current({ channel: 'stable', build_number: 1 }),
        dev,
      ),
    ).toBe('unknown');
  });
});

describe('client download links', () => {
  const assetURL = `${RELEASE_REPOSITORY}/releases/download/v0.0.3/${IPA}`;

  test('开关开启时生成官方直链和国内加速', () => {
    expect(
      buildClientDownloadLinks({
        assetURL,
        proxy: DEFAULT_CLIENT_DOWNLOAD_PROXY,
      }),
    ).toEqual({
      official: assetURL,
      accelerated: `${DEFAULT_CLIENT_DOWNLOAD_PROXY}/${assetURL}`,
      accelerator: DEFAULT_CLIENT_DOWNLOAD_PROXY,
    });
  });

  test('关闭开关不生成加速;非法代理只保留官方下载', () => {
    expect(buildClientDownloadLinks({ assetURL })).toEqual({
      official: assetURL,
      accelerated: null,
      accelerator: null,
    });
    expect(
      buildClientDownloadLinks({
        assetURL,
        proxy: 'https://proxy.example',
      }).accelerated,
    ).toBe(`https://proxy.example/${assetURL}`);
    expect(
      buildClientDownloadLinks({
        assetURL,
        proxy: 'http://user:pass@proxy.example',
      }),
    ).toEqual({
      official: assetURL,
      accelerated: null,
      accelerator: null,
    });
  });
});

describe('client release check', () => {
  test('返回 iOS 资产、变更和两个下载入口', async () => {
    const result = await checkClientRelease({
      current: current(),
      platform: 'ios',
      proxy: DEFAULT_CLIENT_DOWNLOAD_PROXY,
      resolver: new ClientReleaseResolver(fetchFor('stable')),
    });
    expect(result.comparison).toBe('newer');
    expect(result.asset).toMatchObject({ platform: 'ios', name: IPA });
    expect(result.changes).toHaveLength(2);
    expect(result.downloadURL).toBe(
      `${RELEASE_REPOSITORY}/releases/download/v0.0.3/${IPA}`,
    );
    expect(result.acceleratedDownloadURL).toBe(
      `${DEFAULT_CLIENT_DOWNLOAD_PROXY}/${result.downloadURL}`,
    );
    expect(result.releasePage).toBe(`${RELEASE_REPOSITORY}/releases/latest`);
  });

  test('没有当前平台资产时仍返回版本和发布页', async () => {
    const result = await checkClientRelease({
      current: current(),
      platform: 'android',
      resolver: new ClientReleaseResolver(fetchFor('stable')),
    });
    expect(result.asset).toBeNull();
    expect(result.downloadURL).toBeNull();
    expect(result.releasePage).toBe(`${RELEASE_REPOSITORY}/releases/latest`);
  });
});
