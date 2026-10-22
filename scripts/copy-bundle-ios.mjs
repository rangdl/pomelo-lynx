/**
 * Copy the built Lynx bundles into the iOS host's resources so the .app can
 * load them offline (no dev server, no LynxExplorer).
 *
 *   dist/main.lynx.bundle   →  host/ios/PomeloLynx/main.lynx.bundle
 *   dist/probe.lynx.bundle  →  host/ios/PomeloLynx/probe.lynx.bundle
 *   .build/native-host.json →  host/ios/PomeloLynx/native-host.json
 *
 * The bundle files are referenced by the Xcode target's Resources build phase
 * (file-system-synchronized groups in the pbxproj), so they end up inside
 * `PomeloLynx.app/` and `HostTemplateProvider` finds them via
 * `Bundle.main.path(forResource:ofType:"bundle")`.
 *
 * Run AFTER `pnpm build` (and after `gen-native-host.mjs`). The destination is
 * gitignored. Mirrors songloft-player-lynx's scripts/copy-bundle-ios.mjs.
 *
 * Usage: `node scripts/copy-bundle-ios.mjs`
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertBundlesFresh } from './assert-bundles-fresh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const RESOURCES = resolve(repoRoot, 'host/ios/PomeloLynx');

const bundles = ['main.lynx.bundle', 'probe.lynx.bundle'];
assertBundlesFresh(
  bundles.map((name) => resolve(repoRoot, 'dist', name)),
  'copy-bundle-ios',
);

mkdirSync(RESOURCES, { recursive: true });
for (const name of bundles) {
  copyFileSync(resolve(repoRoot, 'dist', name), resolve(RESOURCES, name));
}
copyFileSync(
  resolve(repoRoot, '.build/native-host.json'),
  resolve(RESOURCES, 'native-host.json'),
);

const sizes = bundles
  .map(
    (name) =>
      `${name} ${(statSync(resolve(RESOURCES, name)).size / 1024).toFixed(1)} kB`,
  )
  .join(', ');
console.log(`[copy-bundle-ios] Copied → ${RESOURCES} (${sizes})`);
