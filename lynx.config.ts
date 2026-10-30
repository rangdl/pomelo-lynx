import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig, rspack } from '@lynx-js/rspeedy';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';

/*
 * === Lynx 真机运行时 bootstrap banner(移植自 songloft-player-lynx)===
 *
 * 必须是每个 chunk 的**第一条语句**,先于 Rspack runtime 和一切模块评估:
 * minifier 会把全局 `self` 捕获成模块级别名(并把 router-core 的
 * `isServer` guard 优化成无条件写)——运行时补丁(ensureRouterEnv)晚于
 * 别名捕获,来不及。三段各司其职:
 */
// TanStack RouterCore 构造里写 `self.__TSR_ROUTER__ = this`,Lynx background
// realm 无 `self` → 无条件写直接抛 `undefined is not an object`(黑屏根因,
// 真机诊断屏停在 ⑦ createRouter 构造中)。不定义 `document`,保持 router
// 走非 DOM 分支。
const GLOBAL_SELF_BANNER =
  'typeof globalThis.self==="undefined"&&(globalThis.self=globalThis);';

// Lynx 引擎无 AbortController/AbortSignal(WHATWG API 非 ECMAScript);
// TanStack 的 loadClientRoute 等路径无条件 `new AbortController()`。
// 与 JS 模块级 polyfill 互为冗余,banner 版保证每个 chunk(main-thread 也含)先在。
const GLOBAL_ABORT_POLYFILL =
  '(function(g){if(typeof g.AbortController!=="undefined")return;' +
  'function S(){this.aborted=false;this.reason=undefined;this._l=[];}' +
  'S.prototype.addEventListener=function(t,c){if(t==="abort")this._l.push(c);};' +
  'S.prototype.removeEventListener=function(t,c){if(t==="abort")this._l=this._l.filter(function(f){return f!==c;});};' +
  'S.prototype.dispatchEvent=function(e){var l=this._l.slice();for(var i=0;i<l.length;i++){try{l[i].call(this,e);}catch(_){}}' +
  'if(typeof this.onabort==="function"){try{this.onabort(e);}catch(_){}}return true;};' +
  'S.prototype.throwIfAborted=function(){if(this.aborted)throw this.reason;};' +
  'function C(){this.signal=new S();}' +
  'C.prototype.abort=function(r){var s=this.signal;if(s.aborted)return;s.aborted=true;' +
  's.reason=r!==undefined?r:new Error("Aborted");s.dispatchEvent({type:"abort"});};' +
  'g.AbortController=C;g.AbortSignal=S;})(globalThis);';

// Lynx 4.0.0 宿主的 `lynx.queueMicrotask` 真机上抛
// `TypeError: cannot read property 'getNativeLynx' of undefined`,而它正是
// ReactLynx 选中的 Preact effect scheduler——抛错时 useEffect 被静默丢弃。
// 保持属性存在(其它读取方仍拿到可用调度器),把实现替换成 ReactLynx 自带的
// resolved-Promise 回退。`lynx` 是 bare host global,必须裸标识符+typeof 读取。
const GLOBAL_QUEUE_MICROTASK_FIX =
  '(function(){try{if(typeof lynx==="undefined"||!lynx)return;' +
  'if(typeof lynx.queueMicrotask!=="function")return;' +
  'var P=globalThis.Promise;if(typeof P!=="function")return;var r=P.resolve();' +
  'lynx.queueMicrotask=function(fn){r.then(fn).catch(function(e){' +
  'setTimeout(function(){throw e;},0);});};}catch(_){}})();';

const GLOBAL_BOOTSTRAP_BANNER =
  GLOBAL_SELF_BANNER + GLOBAL_ABORT_POLYFILL + GLOBAL_QUEUE_MICROTASK_FIX;

// 注入给 JS 侧 updater 的构建身份(与 scripts/gen-native-host.mjs 的
// buildMetadata 语义一致;tag 构建为 stable,其余为 dev)。
const packageVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string;
const gitRef = process.env.GITHUB_REF ?? '';
const releaseTag = gitRef.startsWith('refs/tags/')
  ? gitRef.slice('refs/tags/'.length)
  : '';
function releaseMetadata(tag: string): {
  version: string;
  channel: 'dev' | 'stable' | 'preview';
  release_tag: string;
} {
  if (!tag) return { version: 'dev', channel: 'dev', release_tag: 'dev' };
  if (tag === `v${packageVersion}`) {
    return {
      version: packageVersion,
      channel: packageVersion.includes('-') ? 'preview' : 'stable',
      release_tag: tag,
    };
  }
  const dev = /^dev-v?(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.]+)?$/.exec(tag);
  if (dev && dev[1] === packageVersion) {
    return { version: 'dev', channel: 'dev', release_tag: 'dev' };
  }
  throw new Error(
    `Tag ${tag} does not match package.json v${packageVersion} or dev-v${packageVersion}-<id>`,
  );
}
const release = releaseMetadata(releaseTag);
let gitCommit = 'unknown';
try {
  gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
} catch {
  // 无 git 环境(如 artifact 构建):占位值使热更新自然失效。
}
const buildMetadata = {
  version: release.version,
  package_version: packageVersion,
  native_version: packageVersion.split('-')[0],
  build_number: process.env.GITHUB_RUN_NUMBER
    ? Number(process.env.GITHUB_RUN_NUMBER)
    : Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 1000),
  git_commit: process.env.GITHUB_SHA ?? gitCommit,
  build_time: new Date().toISOString(),
  channel: release.channel,
  release_tag: release.release_tag,
};

export default defineConfig({
  // 函数形式 + appendPlugins:只**追加** BannerPlugin,不覆盖 Rspeedy 默认
  // Rspack 配置(传普通对象会把 SWC minimizer 等默认项整个顶掉)。
  tools: {
    rspack: (_config, { appendPlugins }) => {
      appendPlugins(
        new rspack.BannerPlugin({
          banner: GLOBAL_BOOTSTRAP_BANNER,
          raw: true,
          // 只注入 JS chunks(raw banner 进 CSS 会弄坏 minifier)
          test: /\.(?:js|mjs|cjs)$/,
          // 每个 chunk(含 vendor/async)都要,router-core 常在 vendor chunk
          entryOnly: false,
        }),
      );
    },
  },
  // Lynx Web Platform's WASM engine needs `SharedArrayBuffer`, which the
  // browser only exposes to cross-origin-isolated documents. Without these
  // headers the engine silently falls back to a slower path. The setting
  // applies to both the dev server and `rspeedy preview`.
  server: {
    // 本机开发服务固定 3090:宿主机只映射了这个端口,换端口后手机访问不到。
    // host 0.0.0.0 让局域网/中继侧可以直接访问。
    port: 3090,
    host: '0.0.0.0',
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
