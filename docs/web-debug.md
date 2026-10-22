# Web 端调试

本文记录 pomelo-lynx 在 Web 端(Lynx Web Platform)调试时踩过的坑与对应解法。
每条都标注了症状,便于按现象检索。

## 快速开始

```bash
pnpm dev              # 开发服务器:终端出 QR(LynxExplorer)+ /__web_preview?casename=probe.web.bundle
pnpm build            # 生产产物(dist/ 下 4 个 bundle + web-shell + web-core)
pnpm web:dev          # 预览生产产物:http://localhost:3000/index.html
pnpm verify:web       # 一键回归:build + 浏览器端 E2E
```

产物与目录:

| 文件 | 用途 |
|---|---|
| `dist/main.lynx.bundle` / `dist/probe.lynx.bundle` | 原生端(LynxExplorer / 真机) |
| `dist/main.web.bundle` / `dist/probe.web.bundle` | Web 端(`<lynx-view>` 加载) |
| `dist/index.html` | Web 壳页面(来自 `src/web-shell/index.html`) |
| `dist/web-core/` | `@lynx-js/web-core` 静态产物 |

壳页面支持 `?bundle=<文件名>` 直接指定要加载的 bundle。

## 常见故障

### 1. Web 端白屏,worker 报 `n is not a function`

**症状**:`lynx-view` 出现但内容空白;console 里是压缩后的
`n is not a function`;dev 模式错误栈里能看到 `core-js/modules/...`。

**根因**:`@lynx-js/web-platform-rsbuild-plugin` 会把
`output.polyfill` 改成 `'usage'` 并把 `node_modules/@lynx-js` 纳入
`source.include`,于是 **core-js 被打进 Lynx 的双线程 bundle**。Lynx 的后台
worker 运行时与 core-js 的注入方式不兼容,直接崩。

**解法**:两个环境都关掉 polyfill。Lynx 引擎自带完整 ES 实现,不需要 core-js。

```ts
environments: {
  lynx: { output: { polyfill: 'off' } },
  web: { /* 不挂 pluginWebPlatform，或显式 polyfill: false */ },
}
```

验证:`grep -c 'core-js/modules' dist/*.bundle` 应全为 0。

### 2. `No entry named "main"`

**症状**:Web 环境构建失败,报 `No entry named "main"`。

**根因**:Rspeedy 全局关掉了 `htmlPlugin`,而 `DefinesInjection` 与
html-plugin 在 Web 环境组合有已知冲突。

**解法**:不用 htmlPlugin。壳页面走 `output.copy` 复制到 `dist/`,并用
`<script type="importmap">` 指向 `@lynx-js/web-core` 的静态产物
(`client_prod/static/js/client.js`)。

> 壳页面必须指向 `client_prod`(生产版),不要指向 `client`(开发版):
> 两者文件结构相同但入口文件名不同,指错会让「本地能跑、部署黑屏」。

### 3. 测试报 `React is not defined` / `expect is not defined`

**症状**:单测或多环境下的测试编译目标不对。

**根因**:`withLynxConfig()` / `toRstestConfig()` **不处理主配置里的
`environments`**,多环境配置会让测试拿到错误的目标转换。

**解法**:给测试单独一份顶层单环境的配置。

```ts
// lynx.rstest.config.ts
export default defineConfig({
  source: { entry: { main: './src/index.tsx' } },
  plugins: [pluginReactLynx(), pluginTypeCheck()],
});
```

```ts
// rstest.config.ts
export default defineConfig({
  extends: withLynxConfig({ configPath: './lynx.rstest.config.ts' }),
});
```

### 4. Chrome 起不来:`Running as root without --no-sandbox is not supported`

**症状**:容器里跑 Chrome 直接退出,报沙箱错误。

**根因**:容器以 root 运行,Chrome 的 setuid 沙箱不可用。

**解法**:

- 脚本:用 `playwright-core` 自己启动并显式关沙箱
  ```js
  chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome',
    chromiumSandbox: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  ```
- Playwright MCP:需要用 `--no-sandbox` 启动参数,否则 MCP 侧会报同样的错
  (本环境的 MCP 已按此配置;换机器时需在 MCP 的 args 里补上)。

### 5. 切 bundle 后读到上一个 bundle 的内容

**症状**:`view.setAttribute('url', ...)` 之后立刻断言,拿到的是旧内容。

**根因**:`lynx-view` 重新加载时,旧 bundle 的 DOM 仍存活一段时间。

**解法**:自动化场景里**每个 bundle 用一次全新页面**,靠 URL 参数指定 bundle:

```
http://localhost:3000/index.html?bundle=probe.web.bundle
```

壳页面据此设置初始 `url`(HTML 里不再硬编码 `url` 属性,避免先加载默认
bundle 再切换)。

### 6. 判断「bundle 是否渲染完成」

`lynx-view` 把 Lynx 元素树渲染成自定义元素(`x-view` / `x-text` / `x-image`)
放在自己的 shadow root 里。所以判据是:

```js
const shadow = document.getElementById('view')?.shadowRoot;
return shadow?.querySelector('x-view') !== null;
```

注意 `shadowRoot.children.length > 0` 太早——里面已经有 iframe、link 等
结构元素,不代表 bundle 已求值。

Playwright 的选择器引擎会穿透 open shadow root,因此
`page.getByTestId('probe-btn-inc')` 可以直接命中 Lynx 节点。

### 7. `SharedArrayBuffer` 不可用

**症状**:Web 端引擎走了降级路径,性能异常。

**根因**:`SharedArrayBuffer` 只在跨源隔离的文档里可用。

**解法**:dev server 与 preview 都要带 COOP/COEP 响应头。
Rspeedy 的 `server.headers` 对两者同时生效:

```ts
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
},
```

## 工具链约束

### Rstest 0.12 的两处不同

1. **配置是顶层平铺的**,没有 Vitest 的 `test: {}` 包装:

   ```ts
   export default defineConfig({
     include: ['e2e/scenarios/**/*.scenario.ts'],
     testTimeout: 30_000,
     pool: { maxWorkers: 1 },
   });
   ```

   写错成 `test: { ... }` 会被静默忽略,表现为「配置没生效」。
   `fileParallelism` / `sequence` 在 Rstest 0.12 里不存在,串行用
   `pool: { maxWorkers: 1 }`。

2. **自定义 reporter 只能传实例**,传路径字符串会报
   `Reporter ... not found`:

   ```ts
   import { MarkdownReporter } from './e2e/reporter/markdown-reporter';
   export default defineConfig({ reporters: ['default', new MarkdownReporter()] });
   ```

### Biome 会误伤第三方目录

`biome check --write` 默认会格式化仓库内的一切,包括 `.agents/skills/` 下
的第三方技能文件(一次会改掉几百个文件)。在 `biome.json` 里排除:

```json
{
  "files": { "includes": ["**", "!.agents/**"] }
}
```

### pnpm 默认不跑 pre/post scripts

`postbuild` 之类的钩子需要 `enable-pre-post-scripts=true` 才会执行。
更省事的做法是直接串在命令里:

```json
"build": "rspeedy build && node scripts/assert-bundle-fresh.mjs"
```

## 相关文件

| 位置 | 内容 |
|---|---|
| `src/web-shell/index.html` | Web 壳页面(import map、bundle 切换、`?bundle=` 参数) |
| `lynx.config.ts` | 双环境构建、COOP/COEP、polyfill 策略 |
| `e2e/web-check.mjs` | Web 端诊断命令(抓控制台错误、截图) |
| `e2e/alignment/` | 跨端对齐:真机采集与几何比对,见其 README |
| `e2e/` | 场景化 E2E 套件,见 `e2e/README.md` |
