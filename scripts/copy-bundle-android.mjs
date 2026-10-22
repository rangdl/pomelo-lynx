/**
 * Copy the built Lynx bundles into the Android host's assets so the APK can
 * load them offline (no dev server, no LynxExplorer).
 *
 *   dist/main.lynx.bundle   →  host/android/app/src/main/assets/main.lynx.bundle
 *   dist/probe.lynx.bundle  →  host/android/app/src/main/assets/probe.lynx.bundle
 *   .build/native-host.json →  host/android/app/src/main/assets/native-host.json
 *
 * Run AFTER `pnpm build` (and after `gen-native-host.mjs`). The destination is
 * gitignored — it is a build artifact produced fresh in CI (and locally) from
 * `dist/`. Mirrors songloft-player-lynx's scripts/copy-bundle-android.mjs.
 *
 * Usage: `node scripts/copy-bundle-android.mjs`
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertBundlesFresh } from './assert-bundles-fresh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const ASSETS = resolve(repoRoot, 'host/android/app/src/main/assets');

const bundles = ['main.lynx.bundle', 'probe.lynx.bundle'];
assertBundlesFresh(
  bundles.map((name) => resolve(repoRoot, 'dist', name)),
  'copy-bundle-android',
);

mkdirSync(ASSETS, { recursive: true });
for (const name of bundles) {
  copyFileSync(resolve(repoRoot, 'dist', name), resolve(ASSETS, name));
}
copyFileSync(
  resolve(repoRoot, '.build/native-host.json'),
  resolve(ASSETS, 'native-host.json'),
);

const sizes = bundles
  .map(
    (name) =>
      `${name} ${(statSync(resolve(ASSETS, name)).size / 1024).toFixed(1)} kB`,
  )
  .join(', ');
console.log(`[copy-bundle-android] Copied → ${ASSETS} (${sizes})`);
