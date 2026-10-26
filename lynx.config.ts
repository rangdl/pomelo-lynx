import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';

// 注入给 JS 侧 updater 的构建身份(与 scripts/gen-native-host.mjs 的
// buildMetadata 语义一致;tag 构建为 stable,其余为 dev)。
const packageVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string;
const gitRef = process.env.GITHUB_REF ?? '';
const releaseTag = gitRef.startsWith('refs/tags/')
  ? gitRef.slice('refs/tags/'.length)
  : '';
let gitCommit = 'unknown';
try {
  gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
} catch {
  // 无 git 环境(如 artifact 构建):占位值使热更新自然失效。
}
const buildMetadata = {
  version: releaseTag ? packageVersion : 'dev',
  package_version: packageVersion,
  native_version: packageVersion.split('-')[0],
  build_number: process.env.GITHUB_RUN_NUMBER
    ? Number(process.env.GITHUB_RUN_NUMBER)
    : Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 1000),
  git_commit: process.env.GITHUB_SHA ?? gitCommit,
  build_time: new Date().toISOString(),
  channel: releaseTag ? 'stable' : 'dev',
  release_tag: releaseTag || 'dev',
};

export default defineConfig({
  // Lynx Web Platform's WASM engine needs `SharedArrayBuffer`, which the
  // browser only exposes to cross-origin-isolated documents. Without these
  // headers the engine silently falls back to a slower path. The setting
  // applies to both the dev server and `rspeedy preview`.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  source: {
    // main: 原有示例应用;probe: 对齐探针页面(专供 agent-lynx 采集)
    entry: {
      main: './src/index.tsx',
      probe: './src/probe/index.tsx',
    },
    alias: {
      // 黑屏二分实验:暂时移除 react$ alias(嫌疑:全项目裸 react 被重定向到
      // shim,与 ReactLynx 内部 react 打架导致渲染异常)。
      // react$: fileURLToPath(new URL('./src/shims/react.ts', import.meta.url)),
    },
    define: {
      __POMELO_BUILD__: JSON.stringify(buildMetadata),
    },
  },
  environments: {
    // 原生端(LynxExplorer 等加载 .lynx.bundle)
    lynx: {
      output: {
        // pluginWebPlatform 全局把 polyfill 改为 usage(注入 core-js);
        // Lynx 引擎自带完整 ES 实现,原生产物必须关掉以保持体积
        polyfill: 'off',
      },
      plugins: [
        pluginReactLynx(),
        pluginQRCode({
          schema(url) {
            // We use `?fullscreen=true` to open the page in LynxExplorer in full screen mode
            return `${url}?fullscreen=true`;
          },
        }),
        pluginTypeCheck(),
      ],
    },
    // Web 端(浏览器 lynx-view 加载 .web.bundle);默认 browserslist 即 es2017 目标
    web: {
      output: {
        target: 'web',
        assetPrefix: '/',
      },
      // 注:rspeedy 全局 htmlPlugin:false;且 DefinesInjection 与 html-plugin
      // 组合在 web 环境有已知冲突(No entry named "main"),故不用 htmlPlugin,
      // 壳页面由顶层 server.publicDir 提供
      //
      // 这里不挂 pluginWebPlatform:它在 `polyfill: false` 时既不改
      // source.include 也不改 output.polyfill,未传 nativeModulesPath /
      // napiModulesPath 时注册的 rule 也是空值,整体是 no-op。等真正需要
      // 把原生模块映射到 Web 实现时再引入,并显式关闭 polyfill ——
      // core-js 打进 Lynx 双线程 bundle 会让后台 worker 崩掉。
      plugins: [pluginReactLynx()],
    },
  },
  output: {
    // web 壳页面(lynx-view 加载器)复制进 dist/
    copy: [
      { from: './src/web-shell/index.html', to: 'index.html' },
      { from: './node_modules/@lynx-js/web-core/dist', to: 'web-core' },
      {
        from: './node_modules/.pnpm/@lynx-js+web-elements@0.12.14_tslib@2.8.1/node_modules/@lynx-js/web-elements/dist',
        to: 'web-core/node_modules/@lynx-js/web-elements/dist',
      },
      {
        from: './node_modules/.pnpm/@lynx-js+web-worker-rpc@0.26.4/node_modules/@lynx-js/web-worker-rpc/dist',
        to: 'web-core/node_modules/@lynx-js/web-worker-rpc/dist',
      },
    ],
  },
});
