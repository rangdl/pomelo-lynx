/**
 * Freshness guard for an arbitrary list of bundle paths.
 *
 * Reusable core of `assert-bundle-fresh.mjs` (the postbuild full-dist check).
 * The copy-bundle-* host scripts use it to make sure the bundles they package
 * come from the *current* build — `existsSync` cannot catch "file exists but is
 * a leftover from an earlier build", the mtime check can.
 */

import { statSync } from 'node:fs';

/** Artifacts older than this are considered leftovers from an earlier build. */
export const FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

/**
 * @param {string[]} paths  Absolute paths that must exist, be non-empty and fresh.
 * @param {string} caller   Script name for error messages.
 */
export function assertBundlesFresh(paths, caller) {
  const problems = [];
  for (const path of paths) {
    const relative = path.startsWith('/') ? path : path;
    try {
      const stats = statSync(path);
      if (!stats.isFile()) {
        problems.push(`${relative}: 不是文件`);
        continue;
      }
      if (stats.size === 0) {
        problems.push(`${relative}: 文件为空`);
        continue;
      }
      const age = Date.now() - stats.mtimeMs;
      if (age > FRESHNESS_WINDOW_MS) {
        problems.push(
          `${relative}: 产物已过期（${Math.round(age / 1000)}s 前生成）`,
        );
      }
    } catch {
      problems.push(`${relative}: 缺失`);
    }
  }
  if (problems.length > 0) {
    console.error(`[${caller}] 产物不完整或已过期:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(`[${caller}] 请先运行 \`pnpm build\` 重新生成产物。`);
    process.exit(1);
  }
}
