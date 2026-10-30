import { readLynxGlobal } from '../../native/native-modules.js';
import { isWebPlatform } from '../../native/web-platform.js';
import type { BuildIdentity } from '../updater/update-contract.js';
import { clientBuild } from './constants.js';

/**
 * 当前安装包的身份。bundle 的 BuildIdentity 会随热更新变化,而客户端更新
 * 必须看不可变的宿主(IPA/APK)版本,所以这里优先读宿主注入的 globalProps。
 */
export interface ClientIdentity {
  package_version: string;
  version: string;
  build_number: number | null;
  channel: BuildIdentity['channel'];
  git_commit: string;
  display_version: string;
}

const CHANNELS: readonly BuildIdentity['channel'][] = [
  'dev',
  'stable',
  'preview',
];
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** 统一展示版本:stable 为 X.Y.Z,dev 为 dev-X.Y.Z,构建号加括号。 */
export function formatDisplayVersion(input: {
  channel: BuildIdentity['channel'];
  version: string;
  build_number?: number | null;
}): string {
  const base =
    input.channel === 'dev'
      ? `dev-${input.version}`
      : input.channel === 'preview'
        ? `preview-${input.version}`
        : input.version;
  return typeof input.build_number === 'number' &&
    Number.isSafeInteger(input.build_number) &&
    input.build_number > 0
    ? `${base} (${input.build_number})`
    : base;
}

function canonicalVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(?:dev-|preview-)?(\d+\.\d+\.\d+)$/.exec(value.trim());
  return match && STABLE_VERSION.test(match[1]) ? match[1] : null;
}

function buildNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function channel(value: unknown): BuildIdentity['channel'] | null {
  return typeof value === 'string' &&
    CHANNELS.includes(value as BuildIdentity['channel'])
    ? (value as BuildIdentity['channel'])
    : null;
}

/** 读取宿主版本;旧宿主缺少字段时回退到 bundle 构建身份。 */
export function readClientIdentity(): ClientIdentity {
  const props = readLynxGlobal()?.__globalProps ?? {};
  const packageVersion =
    canonicalVersion(props.hostVersion) ??
    canonicalVersion(clientBuild.package_version) ??
    '0.0.0';
  const clientChannel = channel(props.hostChannel) ?? clientBuild.channel;
  const clientBuildNumber = isWebPlatform()
    ? null
    : (buildNumber(props.hostBuild) ?? buildNumber(clientBuild.build_number));
  return {
    package_version: packageVersion,
    version: packageVersion,
    build_number: clientBuildNumber,
    channel: clientChannel,
    git_commit: clientBuild.git_commit,
    display_version: formatDisplayVersion({
      channel: clientChannel,
      version: packageVersion,
      build_number: clientBuildNumber,
    }),
  };
}

/** Bundle 的展示版本;契约字段 version 在 dev 下仍是字面量 dev。 */
export function readBundleDisplayVersion(): string {
  return formatDisplayVersion({
    channel: clientBuild.channel,
    version: clientBuild.package_version,
    build_number: isWebPlatform() ? null : clientBuild.build_number,
  });
}
