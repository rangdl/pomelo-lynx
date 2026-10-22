/**
 * Generate `native-host.json` — the host-side update contract snapshot.
 *
 * The file is embedded into both platform hosts (Android assets / iOS
 * resources) and records who built the app, which engine versions it embeds and
 * which update signing keys it trusts. The hot-update pipeline (stage 4b/4c,
 * not yet implemented) will read it to decide whether a downloaded update
 * manifest is compatible with the running host.
 *
 * Engine versions are parsed from the host projects themselves (Gradle
 * dependency line / Podfile.lock), mirroring songloft-player-lynx's
 * `loadNativeContract` — a single source of truth instead of a hand-maintained
 * contract file that drifts from the real dependencies.
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

// ---- version / build metadata --------------------------------------------

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

function buildNumber() {
  // CI: GitHub Actions run number; local: unix day so it increases over time.
  const fromCi = process.env.GITHUB_RUN_NUMBER;
  if (fromCi && /^\d+$/.test(fromCi)) return Number(fromCi);
  return Math.floor(Date.now() / 86_400_000);
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
  // Podfile.lock only exists after `pod install` (CI or a Mac). Fall back to
  // the version pinned in pods.rb so local Linux runs still produce a file.
  const lockPath = join(root, 'host/ios/Podfile.lock');
  try {
    const lock = readFileSync(lockPath, 'utf8');
    const version = lock.match(/^ {2}- Lynx \(([^)]+)\):/m)?.[1];
    if (version) return version;
  } catch {
    // no lockfile yet
  }
  const pods = readFileSync(join(root, 'host/ios/Podfile'), 'utf8');
  const version = pods.match(/pod 'Lynx', '([^']+)'/)?.[1];
  if (!version) throw new Error('无法从 host/ios/pods.rb 解析 Lynx 版本');
  return version;
}

// ---- trusted signing keys (hot update, stage 4b) ---------------------------

/**
 * `POMELO_UPDATE_PUBLIC_KEY` (SPKI PEM) is provided by CI when the update
 * signing key is configured. Empty locally / before 4b → empty trusted_keys,
 * which the (future) host updater treats as "no signed updates accepted".
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
  channel: process.env.POMELO_UPDATE_CHANNEL || 'dev',
  version: packageJson.version,
  build_number: buildNumber(),
  git_commit: process.env.GITHUB_SHA ?? gitCommit(),
  engines: {
    android: androidEngine(),
    ios: iosEngine(),
  },
  trusted_keys: trustedKeys(),
};

mkdirSync(join(root, '.build'), { recursive: true });
const out = join(root, '.build/native-host.json');
writeFileSync(out, `${JSON.stringify(host, null, 2)}\n`);
console.log(`[gen-native-host] ${out}`);
console.log(JSON.stringify(host, null, 2));
