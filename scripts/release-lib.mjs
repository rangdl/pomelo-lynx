import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
// 与 scripts/gen-native-host.mjs 的 buildNumber 一致(2026-01-01 锚点)。
const BUILD_EPOCH = Date.parse('2026-01-01T00:00:00Z');

export function validateVersion(version) {
  if (typeof version !== 'string' || !VERSION.test(version))
    throw new Error(`Invalid version: ${version}`);
  const prerelease = version.split('-').slice(1).join('-');
  if (prerelease.split('.').some((part) => /^0\d+$/.test(part)))
    throw new Error(`Invalid prerelease: ${version}`);
  return version;
}

/**
 * 只允许两种发布 tag:
 *   - vX.Y.Z            正式版(必须等于 package.json version)
 *   - dev-vX.Y.Z-<id>   dev 构建(版本部分必须等于 package.json version)
 *
 * dev 构建的 GitHub Release 仍是滚动 `dev`,所以 Bundle manifest 的
 * release_tag/version 继续是 `dev`,不能把 dev tag 写进签名契约。
 */
function releaseTagMetadata(tag, packageVersion) {
  if (!tag) {
    return { channel: 'dev', releaseTag: 'dev', version: 'dev' };
  }
  if (tag === `v${packageVersion}`) {
    return {
      channel: packageVersion.includes('-') ? 'preview' : 'stable',
      releaseTag: tag,
      version: packageVersion,
    };
  }
  const dev = /^dev-v?(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.]+)?$/.exec(tag);
  if (dev && dev[1] === packageVersion) {
    return { channel: 'dev', releaseTag: 'dev', version: 'dev' };
  }
  throw new Error(
    `Tag ${tag} does not match package.json v${packageVersion} or dev-v${packageVersion}-<id>`,
  );
}

/** 构建身份元数据(与 gen-native-host.mjs 的 buildMetadata 语义一致)。 */
export function createBuildMetadata({
  packageVersion,
  ref = '',
  sha = 'unknown',
  now = new Date(),
  buildNumber,
} = {}) {
  validateVersion(packageVersion);
  const tag = ref.startsWith('refs/tags/')
    ? ref.slice('refs/tags/'.length)
    : '';
  const release = releaseTagMetadata(tag, packageVersion);
  if (sha !== 'unknown' && !/^[0-9a-f]{7,40}$/.test(sha))
    throw new Error('Invalid git commit');
  const buildTime = now.toISOString();
  const number =
    buildNumber ?? Math.floor((now.getTime() - BUILD_EPOCH) / 1000);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 2100000000)
    throw new Error('Invalid Android build number');
  return {
    version: release.version,
    package_version: packageVersion,
    native_version: packageVersion.split('-')[0],
    build_number: number,
    git_commit: sha,
    build_time: buildTime,
    channel: release.channel,
    release_tag: release.releaseTag,
  };
}

/** 校验一份已存在的构建元数据是否与 packageVersion 自洽(重放 createBuildMetadata 对拍)。 */
export function validateBuildMetadata(value, packageVersion) {
  const expected = createBuildMetadata({
    packageVersion,
    ref: value?.release_tag === 'dev' ? '' : `refs/tags/${value?.release_tag}`,
    sha: value?.git_commit,
    now: new Date(value?.build_time),
    buildNumber: value?.build_number,
  });
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue)
      throw new Error(`Invalid build metadata field: ${key}`);
  }
  return expected;
}

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function listReleaseAssets(directory) {
  return readdirSync(directory)
    .sort()
    .filter((name) => name !== 'version.json' && name !== 'checksums.txt')
    .map((name) => {
      if (!/^[a-zA-Z0-9._-]+$/.test(name))
        throw new Error(`Unexpected release asset: ${name}`);
      const path = join(directory, name);
      if (!statSync(path).isFile() || statSync(path).size === 0)
        throw new Error(`Empty or invalid asset: ${name}`);
      return { name, size: statSync(path).size, sha256: hashFile(path) };
    });
}
