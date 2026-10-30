import { platformName } from '../../native/web-platform.js';
import {
  type ClientIdentity,
  readClientIdentity,
} from '../config/client-identity.js';
import {
  type MetadataFetch,
  RELEASE_REPOSITORY,
  releasePage,
  type VersionComparison,
  withGithubProxy,
} from './release-resolver.js';
import { compareStableVersions } from './update-contract.js';
import { fetchUpdateMetadata } from './update-metadata.js';

const RELEASE_API = 'https://api.github.com/repos/rangdl/pomelo-lynx/releases';
const MAX_RELEASE_BYTES = 512 * 1024;
const MAX_CLIENT_METADATA_BYTES = 64 * 1024;
const CACHE_MS = 5 * 60 * 1000;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SAFE_ASSET = /^[A-Za-z0-9._-]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CLIENT_ASSET_NAMES: Record<ClientPlatform, string> = {
  ios: 'pomelo-lynx-ios-nosign.ipa',
  android: 'pomelo-lynx-android-release.apk',
  harmony: 'pomelo-lynx-harmony-release.hap',
};

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31)
    )
      return true;
  }
  return false;
}

export const CLIENT_RELEASE_ASSET = 'client.json';
/**
 * 国内加速默认前缀。只用于 IPA/APK 下载,不作为元数据或安全校验的来源;
 * 用户配置了 update_proxy 时优先使用自定义地址。
 */
export const DEFAULT_CLIENT_DOWNLOAD_PROXY = 'https://gh-proxy.org';

export type ClientPlatform = 'ios' | 'android' | 'harmony';

export interface ClientAsset {
  platform: ClientPlatform;
  name: string;
  size: number;
  sha256: string;
}

export interface ClientReleaseMetadata {
  schema: 1;
  channel: 'dev' | 'stable';
  version: string;
  display_version: string;
  build_number: number;
  git_commit: string;
  build_time: string;
  release_tag: string;
  build_tag?: string;
  changes: string[];
  assets: ClientAsset[];
}

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string;
}
interface GithubRelease {
  tag: string;
  assets: GithubAsset[];
}
interface ClientReleaseCandidate {
  metadata: ClientReleaseMetadata;
  release: GithubRelease;
  proxy: string;
}

export interface ClientReleaseCheck {
  comparison: VersionComparison;
  current: ClientIdentity;
  candidate: ClientReleaseMetadata;
  changes: string[];
  releasePage: string;
  asset: ClientAsset | null;
  downloadURL: string | null;
  acceleratedDownloadURL: string | null;
  accelerator: string | null;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_release');
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 1024): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum)
    throw new Error('invalid_release');
  return value;
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  )
    throw new Error('invalid_release');
  return value;
}
function channel(value: unknown): 'dev' | 'stable' {
  if (value !== 'dev' && value !== 'stable') throw new Error('invalid_release');
  return value;
}
function platform(value: unknown): ClientPlatform {
  if (value !== 'ios' && value !== 'android' && value !== 'harmony')
    throw new Error('invalid_release');
  return value;
}
function stableVersion(value: unknown): string {
  if (typeof value !== 'string' || !STABLE_VERSION.test(value))
    throw new Error('invalid_release');
  return value;
}

export function parseClientRelease(
  raw: unknown,
  expectedChannel: 'dev' | 'stable',
  releaseTag: string,
): ClientReleaseMetadata {
  const data = record(raw);
  const parsedChannel = channel(data.channel);
  if (data.schema !== 1 || parsedChannel !== expectedChannel)
    throw new Error('invalid_release');
  const version = stableVersion(data.version);
  if (data.release_tag !== releaseTag) throw new Error('invalid_release');
  const expectedDisplay = parsedChannel === 'dev' ? `dev-${version}` : version;
  if (data.display_version !== expectedDisplay)
    throw new Error('invalid_release');
  const buildNumber = integer(data.build_number, 2_100_000_000);
  const gitCommit = text(data.git_commit, 64);
  if (gitCommit !== 'unknown' && !/^[0-9a-f]{7,40}$/i.test(gitCommit))
    throw new Error('invalid_release');
  const buildTime = text(data.build_time, 64);
  const buildTag = data.build_tag == null ? null : text(data.build_tag, 96);
  if (buildTag && !/^[A-Za-z0-9._-]+$/.test(buildTag))
    throw new Error('invalid_release');
  if (!Array.isArray(data.changes) || data.changes.length > 20)
    throw new Error('invalid_release');
  const changes = data.changes.map((value) => {
    const change = text(value, 200).trim();
    if (!change || hasControlCharacters(change))
      throw new Error('invalid_release');
    return change;
  });
  if (
    !Array.isArray(data.assets) ||
    data.assets.length === 0 ||
    data.assets.length > 3
  )
    throw new Error('invalid_release');
  const assets = data.assets.map((value) => {
    const asset = record(value);
    const assetPlatform = platform(asset.platform);
    const name = text(asset.name, 128);
    if (
      !SAFE_ASSET.test(name) ||
      name === '.' ||
      name === '..' ||
      name !== CLIENT_ASSET_NAMES[assetPlatform]
    )
      throw new Error('invalid_release');
    return {
      platform: assetPlatform,
      name,
      size: integer(asset.size, 2_147_483_647),
      sha256: text(asset.sha256, 64),
    };
  });
  if (assets.some((asset) => !SHA256.test(asset.sha256)))
    throw new Error('invalid_release');
  if (new Set(assets.map((asset) => asset.platform)).size !== assets.length)
    throw new Error('invalid_release');
  return {
    schema: 1,
    channel: parsedChannel,
    version,
    display_version: expectedDisplay,
    build_number: buildNumber,
    git_commit: gitCommit,
    build_time: buildTime,
    release_tag: releaseTag,
    ...(buildTag ? { build_tag: buildTag } : {}),
    changes,
    assets,
  };
}

function parseRelease(
  raw: string,
  expectedChannel: 'dev' | 'stable',
): GithubRelease {
  let data: Record<string, unknown>;
  try {
    data = record(JSON.parse(raw));
  } catch {
    throw new Error('invalid_release');
  }
  const tag = data.tag_name;
  if (
    data.draft !== false ||
    typeof tag !== 'string' ||
    (expectedChannel === 'dev'
      ? tag !== 'dev' || data.prerelease !== true
      : data.prerelease !== false ||
        !/^v\d+\.\d+\.\d+$/.test(tag) ||
        compareStableVersions(tag.slice(1), tag.slice(1)) == null) ||
    !Array.isArray(data.assets) ||
    data.assets.length > 32
  )
    throw new Error('invalid_release');
  const assets = data.assets.map((value) => {
    const asset = record(value);
    const name = text(asset.name, 128);
    if (
      !SAFE_ASSET.test(name) ||
      name === '.' ||
      name === '..' ||
      asset.browser_download_url !==
        `${RELEASE_REPOSITORY}/releases/download/${tag}/${name}` ||
      (asset.digest != null &&
        (typeof asset.digest !== 'string' ||
          !/^sha256:[a-f0-9]{64}$/.test(asset.digest)))
    )
      throw new Error('invalid_release');
    return {
      name,
      size: integer(asset.size, 2_147_483_647),
      browser_download_url: asset.browser_download_url as string,
      ...(asset.digest ? { digest: asset.digest as string } : {}),
    };
  });
  if (new Set(assets.map((asset) => asset.name)).size !== assets.length)
    throw new Error('invalid_release');
  return { tag, assets };
}

function failStatus(status: number): void {
  if (status === 403 || status === 429) throw new Error('release_rate_limited');
  if (status === 404) throw new Error('release_unpublished');
  if (status < 200 || status >= 300) throw new Error('metadata_failed');
}

/** 客户端更新元数据解析;与 Bundle 的签名 manifest 完全独立。 */
export class ClientReleaseResolver {
  private readonly cache = new Map<
    string,
    { value: ClientReleaseCandidate; until: number }
  >();
  private readonly inflight = new Map<
    string,
    Promise<ClientReleaseCandidate>
  >();

  constructor(
    private readonly fetchMetadata: MetadataFetch,
    private readonly now: () => number = Date.now,
  ) {}

  resolve(input: {
    channel: 'dev' | 'stable';
    proxy?: string;
    force?: boolean;
  }): Promise<ClientReleaseCandidate> {
    const proxy = input.proxy ?? '';
    const key = `${input.channel}|${proxy}`;
    const cached = this.cache.get(key);
    if (!input.force && cached && cached.until > this.now())
      return Promise.resolve(cached.value);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const task = this.read(input.channel, proxy)
      .then((value) => {
        this.cache.set(key, { value, until: this.now() + CACHE_MS });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, task);
    return task;
  }

  private async get(
    address: string,
    maximum: number,
    proxy: string,
  ): Promise<string> {
    const proxied = withGithubProxy(address, proxy);
    let response: { status: number; body: string };
    try {
      response = await this.fetchMetadata(proxied, maximum);
      failStatus(response.status);
    } catch (error) {
      if (proxied === address) throw error;
      // 与 Bundle 更新一致:代理失败只回退同一个直连地址。
      response = await this.fetchMetadata(address, maximum);
      failStatus(response.status);
    }
    if (response.body.length > maximum) throw new Error('metadata_too_large');
    return response.body;
  }

  private async read(
    expectedChannel: 'dev' | 'stable',
    proxy: string,
  ): Promise<ClientReleaseCandidate> {
    const api = `${RELEASE_API}/${expectedChannel === 'dev' ? 'tags/dev' : 'latest'}?_cb=${this.now()}`;
    const release = parseRelease(
      await this.get(api, MAX_RELEASE_BYTES, proxy),
      expectedChannel,
    );
    const metadataAsset = release.assets.find(
      (asset) => asset.name === CLIENT_RELEASE_ASSET,
    );
    if (!metadataAsset) throw new Error('client_metadata_missing');
    if (metadataAsset.size > MAX_CLIENT_METADATA_BYTES)
      throw new Error('client_metadata_missing');
    const raw = await this.get(
      `${metadataAsset.browser_download_url}?_cb=${this.now()}`,
      MAX_CLIENT_METADATA_BYTES,
      proxy,
    );
    let metadata: ClientReleaseMetadata;
    try {
      metadata = parseClientRelease(
        JSON.parse(raw),
        expectedChannel,
        release.tag,
      );
    } catch {
      throw new Error('invalid_release');
    }
    for (const asset of metadata.assets) {
      const remote = release.assets.find((value) => value.name === asset.name);
      if (
        !remote ||
        remote.size !== asset.size ||
        (remote.digest && remote.digest !== `sha256:${asset.sha256}`)
      )
        throw new Error('invalid_release');
    }
    return { metadata, release, proxy };
  }
}

export const clientReleaseResolver = new ClientReleaseResolver(
  fetchUpdateMetadata,
);

export function compareClientRelease(
  current: ClientIdentity,
  candidate: ClientReleaseMetadata,
): VersionComparison {
  if (current.channel === 'preview') return 'unknown';
  if (current.channel !== candidate.channel) return 'unknown';
  if (current.channel === 'dev') {
    if (current.build_number == null) return 'unknown';
    return candidate.build_number > current.build_number ? 'newer' : 'current';
  }
  const version = compareStableVersions(candidate.version, current.version);
  if (version == null) return 'unknown';
  if (version !== 0) return version > 0 ? 'newer' : 'current';
  return current.build_number == null
    ? 'unknown'
    : candidate.build_number > current.build_number
      ? 'newer'
      : 'current';
}

export function buildClientDownloadLinks(input: {
  assetURL: string;
  proxy?: string;
}): {
  official: string;
  accelerated: string | null;
  accelerator: string | null;
} {
  const prefixes = [input.proxy?.trim(), DEFAULT_CLIENT_DOWNLOAD_PROXY].filter(
    (value): value is string => !!value,
  );
  for (const prefix of prefixes) {
    try {
      return {
        official: input.assetURL,
        accelerated: withGithubProxy(input.assetURL, prefix),
        accelerator: prefix,
      };
    } catch {
      // 非法自定义代理不能阻断官方下载;继续尝试默认加速。
    }
  }
  return {
    official: input.assetURL,
    accelerated: null,
    accelerator: null,
  };
}

function currentPlatform(): ClientPlatform | null {
  const name = platformName();
  return name === 'ios' || name === 'android' || name === 'harmony'
    ? name
    : null;
}

export async function checkClientRelease(
  input: {
    proxy?: string;
    force?: boolean;
    current?: ClientIdentity;
    platform?: ClientPlatform | null;
    resolver?: ClientReleaseResolver;
  } = {},
): Promise<ClientReleaseCheck> {
  const current = input.current ?? readClientIdentity();
  if (current.channel !== 'dev' && current.channel !== 'stable')
    throw new Error('update_channel_unsupported');
  const candidate = await (input.resolver ?? clientReleaseResolver).resolve({
    channel: current.channel,
    proxy: input.proxy ?? '',
    force: input.force,
  });
  const targetPlatform =
    input.platform === undefined ? currentPlatform() : input.platform;
  const metadataAsset = targetPlatform
    ? (candidate.metadata.assets.find(
        (asset) => asset.platform === targetPlatform,
      ) ?? null)
    : null;
  const remoteAsset = metadataAsset
    ? candidate.release.assets.find(
        (asset) =>
          asset.name === metadataAsset.name &&
          asset.size === metadataAsset.size &&
          (!asset.digest || asset.digest === `sha256:${metadataAsset.sha256}`),
      )
    : null;
  if (metadataAsset && !remoteAsset) throw new Error('invalid_release');
  const links = remoteAsset
    ? buildClientDownloadLinks({
        assetURL: remoteAsset.browser_download_url,
        proxy: input.proxy,
      })
    : null;
  return {
    comparison: compareClientRelease(current, candidate.metadata),
    current,
    candidate: candidate.metadata,
    changes: candidate.metadata.changes,
    releasePage: releasePage(current.channel) ?? RELEASE_REPOSITORY,
    asset: metadataAsset,
    downloadURL: links?.official ?? null,
    acceleratedDownloadURL: links?.accelerated ?? null,
    accelerator: links?.accelerator ?? null,
  };
}
