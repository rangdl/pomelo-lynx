import { fileURLToPath } from 'node:url';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';

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
      // 第三方库(如 TanStack Router)从裸 `react` 导入。路由到本地 shim:
      // 转寄 ReactLynx compat 入口(补 startTransition/useTransition)并加
      // `use` stub,让 React-19 专有 API 的 ESM 链接通过。
      react$: fileURLToPath(new URL('./src/shims/react.ts', import.meta.url)),
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
