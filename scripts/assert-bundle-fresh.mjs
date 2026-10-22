/**
 * Guard against shipping a stale bundle.
 *
 * The two build environments write into the same `dist/` directory, so a
 * build that silently skips one of them leaves the previous run's artifact
 * behind — and a native package built from it ships old code. This check
 * fails the build instead.
 *
 * Run automatically as `postbuild`.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'dist');

/** Every artifact a complete build must produce. */
const REQUIRED = [
  'main.lynx.bundle',
  'probe.lynx.bundle',
  'main.web.bundle',
  'probe.web.bundle',
  'index.html',
  join('web-core', 'client_prod', 'static', 'js', 'client.js'),
];

/**
 * Artifacts older than this are considered leftovers from an earlier build.
 * The threshold only has to exceed the build duration, with room to spare.
 */
const FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

const problems = [];

for (const relative of REQUIRED) {
  const path = join(distDir, relative);
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
  console.error('[assert-bundle-fresh] 构建产物不完整:');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    '[assert-bundle-fresh] 检查 lynx.config.ts 的 environments 声明：' +
      '漏掉一个 environment 会让 rspeedy 跳过该环境的构建。',
  );
  process.exit(1);
}

console.log(`[assert-bundle-fresh] ${REQUIRED.length} 个产物校验通过`);
