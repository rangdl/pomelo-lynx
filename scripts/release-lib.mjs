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
  if (tag && tag !== `v${packageVersion}`)
    throw new Error(
      `Tag ${tag} does not match package.json v${packageVersion}`,
    );
  if (sha !== 'unknown' && !/^[0-9a-f]{7,40}$/.test(sha))
    throw new Error('Invalid git commit');
  const buildTime = now.toISOString();
  const number =
    buildNumber ?? Math.floor((now.getTime() - BUILD_EPOCH) / 1000);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 2100000000)
    throw new Error('Invalid Android build number');
  return {
    version: tag ? packageVersion : 'dev',
    package_version: packageVersion,
    native_version: packageVersion.split('-')[0],
    build_number: number,
    git_commit: sha,
    build_time: buildTime,
    channel: tag
      ? packageVersion.includes('-')
        ? 'preview'
        : 'stable'
      : 'dev',
    release_tag: tag || 'dev',
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
