/**
 * Keep native version fields in lockstep with `package.json`.
 *
 * `package.json` is the single source of truth for the release version. This
 * script runs from the `version` lifecycle hook, i.e. automatically after
 * `pnpm release:patch|minor|major` (which calls `pnpm version ...`), and writes
 * the new version into the tracked Xcode project:
 *
 *   - MARKETING_VERSION        → CFBundleShortVersionString
 *   - CURRENT_PROJECT_VERSION  → CFBundleVersion (monotonic build number)
 *
 * Android needs no file rewrite: `host/android/app/build.gradle.kts` derives
 * versionName/versionCode from `package.json` at configure time.
 *
 * The lifecycle hook then `git add`s the project file, so npm/pnpm includes it
 * in the version commit and tag.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = join(root, 'package.json');
const projectPath = join(root, 'host/ios/PomeloLynx.xcodeproj/project.pbxproj');

const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
if (!match) {
  throw new Error(`package.json version "${version}" is not semver (X.Y.Z)`);
}
const [, major, minor, patch] = match;
const buildNumber = Number(major) * 10000 + Number(minor) * 100 + Number(patch);

const project = readFileSync(projectPath, 'utf8');
if (
  !/MARKETING_VERSION = [^;]+;/.test(project) ||
  !/CURRENT_PROJECT_VERSION = [^;]+;/.test(project)
) {
  throw new Error('no MARKETING_VERSION / CURRENT_PROJECT_VERSION found in project.pbxproj');
}
const updated = project
  .replace(/(MARKETING_VERSION = )[^;]+;/g, `$1${version};`)
  .replace(/(CURRENT_PROJECT_VERSION = )[^;]+;/g, `$1${buildNumber};`);

if (updated !== project) {
  writeFileSync(projectPath, updated);
}
console.log(
  `synced host/ios project: MARKETING_VERSION=${version} CURRENT_PROJECT_VERSION=${buildNumber}`,
);
