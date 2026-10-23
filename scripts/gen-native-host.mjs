/**
 * Generate `native-host.json` — the host-side update contract snapshot.
 *
 * The file is embedded into both platform hosts (Android assets / iOS
 * resources) and records who built the app, which engine versions it embeds and
 * which update signing keys it trusts. The hot-update pipeline reads it at
 * launch to verify a downloaded update manifest is compatible with the
 * running host (signature + channel + engine + bridge/schema + capabilities).
 *
 * Field semantics mirror songloft-player-lynx's `createBuildMetadata` +
 * `createNativeHostMetadata` (scripts/update-release-lib.mjs), trimmed to the
 * two platforms this repo ships (android/ios).
 *
 * Engine versions are parsed from the host projects themselves (Gradle
 * dependency line / Podfile.lock / pods.rb) — a single source of truth instead
 * of a hand-maintained contract file that drifts from the real dependencies.
 * `updates/native-contract.json` carries the protocol/bridge/schema/capability
 * contract.
 *
 * Usage: `node scripts/gen-native-host.mjs` (run after `pnpm build`, before the
 * copy-bundle scripts). Output: `.build/native-host.json`.
 */
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
);
const contract = JSON.parse(
  readFileSync(join(root, 'updates/native-contract.json'), 'utf8'),
);

// ---- version / build metadata (mirrors songloft createBuildMetadata) ------

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    // Shallow download / no git (e.g. artifact build): fall back to a
    // deterministic placeholder. The update pipeline refuses manifests whose
    // git_commit does not match, so a fake value simply disables updates.
    return '0000000000000000000000000000000000000000';
  }
}

function buildNumber(now) {
  // CI: GitHub Actions run number; local: seconds since a fixed epoch so it
  // increases monotonically. songloft uses (now - BUILD_EPOCH)/1000; we keep
  // the same scale by anchoring at 2026-01-01.
  const fromCi = process.env.GITHUB_RUN_NUMBER;
  if (fromCi && /^\d+$/.test(fromCi)) return Number(fromCi);
  return Math.floor((now.getTime() - Date.UTC(2026, 0, 1)) / 1000);
}

/**
 * version/channel/release_tag: a tag build (`GITHUB_REF=refs/tags/vX.Y.Z`) is
 * the stable channel; anything else is dev. `POMELO_UPDATE_CHANNEL` may force
 * the channel for local experiments but never changes version semantics.
 */
function buildMetadata() {
  const now = new Date();
  const ref = process.env.GITHUB_REF ?? '';
  const tag = ref.startsWith('refs/tags/')
    ? ref.slice('refs/tags/'.length)
    : '';
  const packageVersion = packageJson.version;
  if (tag && tag !== `v${packageVersion}`) {
    throw new Error(`Tag ${tag} 与 package.json v${packageVersion} 不一致`);
  }
  return {
    version: tag ? packageVersion : 'dev',
    package_version: packageVersion,
    native_version: packageVersion.split('-')[0],
    build_number: buildNumber(now),
    git_commit: process.env.GITHUB_SHA ?? gitCommit(),
    build_time: now.toISOString(),
    channel: process.env.POMELO_UPDATE_CHANNEL || (tag ? 'stable' : 'dev'),
    release_tag: tag || 'dev',
  };
}

// ---- engine versions (parsed from the host projects) ----------------------

function androidEngine() {
  const gradle = readFileSync(
    join(root, 'host/android/app/build.gradle.kts'),
    'utf8',
  );
  const version = gradle.match(
    /implementation\("org\.lynxsdk\.lynx:lynx:([^"\n]+)"\)/,
  )?.[1];
  if (!version)
    throw new Error('无法从 host/android/app/build.gradle.kts 解析 lynx 版本');
  return version;
}

function iosEngine() {
  // Podfile.lock only exists after `pod install` (CI or a Mac). Prefer the CI
  // release lockfile, then the dev one; fall back to the version pinned in
  // pods.rb so local Linux runs still produce a file.
  for (const rel of [
    'host/ios/release/Podfile.lock',
    'host/ios/Podfile.lock',
  ]) {
    try {
      const lock = readFileSync(join(root, rel), 'utf8');
      const version = lock.match(/^ {2}- Lynx \(([^)]+)\):/m)?.[1];
      if (version) return version;
    } catch {
      // no lockfile yet
    }
  }
  const pods = readFileSync(join(root, 'host/ios/pods.rb'), 'utf8');
  const version = pods.match(/pod 'Lynx', '([^']+)'/)?.[1];
  if (!version) throw new Error('无法从 host/ios/pods.rb 解析 Lynx 版本');
  return version;
}

// The contract file declares the engines the update manifests are checked
// against; refuse to produce a snapshot that disagrees with the real deps.
function contractEngines() {
  const actual = { android: androidEngine(), ios: iosEngine() };
  for (const platform of ['android', 'ios']) {
    if (contract.engines?.[platform] !== actual[platform]) {
      throw new Error(
        `updates/native-contract.json 的 engines.${platform} (${contract.engines?.[platform]}) 与宿主依赖 (${actual[platform]}) 不一致`,
      );
    }
  }
  return actual;
}

// ---- trusted signing keys ---------------------------------------------------

/**
 * `POMELO_UPDATE_PUBLIC_KEY` (SPKI PEM) is provided by CI when the update
 * signing key is configured. Empty locally → empty trusted_keys, which the
 * host updater treats as "no signed updates accepted".
 */
function trustedKeys() {
  const pem = process.env.POMELO_UPDATE_PUBLIC_KEY?.trim();
  if (!pem) return [];
  const key = createPublicKey(pem);
  if (
    key.asymmetricKeyType !== 'rsa' ||
    ![2048, 3072, 4096].includes(key.asymmetricKeyDetails.modulusLength)
  ) {
    throw new Error(
      'POMELO_UPDATE_PUBLIC_KEY 必须是 2048/3072/4096 位 RSA 公钥',
    );
  }
  const spki = key.export({ type: 'spki', format: 'der' });
  return [
    {
      // 16 hex chars of the SPKI digest — the id a signed manifest refers to.
      key_id: createHash('sha256').update(spki).digest('hex').slice(0, 16),
      key_bits: key.asymmetricKeyDetails.modulusLength,
      algorithm: 'rsa-pkcs1v15-sha256',
      spki_base64: spki.toString('base64'),
      // iOS SecKey consumes PKCS#1; Android/Java consumes SPKI. Same key.
      pkcs1_base64: key
        .export({ type: 'pkcs1', format: 'der' })
        .toString('base64'),
    },
  ];
}

// ---- assemble --------------------------------------------------------------

const host = {
  ...buildMetadata(),
  update_protocol: contract.protocol,
  bridge_version: contract.bridge_version,
  local_schema: contract.local_schema,
  capabilities: [...contract.required_capabilities],
  engines: contractEngines(),
  trusted_keys: trustedKeys(),
};

mkdirSync(join(root, '.build'), { recursive: true });
const out = join(root, '.build/native-host.json');
writeFileSync(out, `${JSON.stringify(host, null, 2)}\n`);
console.log(`[gen-native-host] ${out}`);
console.log(JSON.stringify(host, null, 2));
