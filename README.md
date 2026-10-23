# pomelo-lynx

基于 [ReactLynx](https://lynxjs.org/react/) 的跨端项目,同一套代码构建
**原生端**(Android / iOS / HarmonyOS)与 **Web 端**(浏览器 `lynx-view`)。

- 构建工具:[Rspeedy](https://rspeedy.rs)(Rspack / Rsbuild)
- 框架:ReactLynx + TypeScript
- 代码检查:[Biome](https://biomejs.dev)

## 环境要求

- Node `^20.19 || >=22.12`
- pnpm

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发服务器:终端打印 QR 码供 LynxExplorer 扫码;Web 预览在 `/__web_preview?casename=probe.web.bundle` |
| `pnpm build` | 生产构建(原生 + Web 双环境),并校验产物完整性 |
| `pnpm build:host` | 构建 JS 产物并拷入宿主 app(Android assets / iOS resources),生成 `native-host.json` |
| `pnpm build:lynx` | 只构建原生端 `*.lynx.bundle` |
| `pnpm build:web` | 只构建 Web 端 `*.web.bundle` + 壳页面 |
| `pnpm web:dev` | 预览生产产物:http://localhost:3000/index.html |
| `pnpm preview` | Rspeedy 内置预览 |
| `pnpm test` | 单元测试(Rstest) |
| `pnpm e2e:web` | Web 端场景化 E2E(自动起静态服务) |
| `pnpm e2e:native` | 真机端场景化 E2E |
| `pnpm verify:web` | 一键回归:`build` + `e2e:web` |
| `pnpm typecheck` | `tsc -b` 全量类型检查 |
| `pnpm run check` | Biome 检查并自动修复 |
| `pnpm run format` | Biome 格式化 |

## 目录结构

```
src/
  index.tsx          入口(main 环境)
  App.tsx            示例应用
  App.css
  lib/flappy.ts      与框架无关的小游戏物理引擎
  useFlappy.ts       对应的 React Hook
  probe/             跨端对齐探针页(节点带 data-testid)
  web-shell/         Web 端壳页面(import map + bundle 切换)
host/               自有宿主 app(SDK 集成,参考 songloft-player-lynx)
  android/          Gradle + Kotlin:minSdk 21,内嵌双 bundle,DevTool 服务供 agent-lynx 驱动
  ios/              Xcode + CocoaPods:Lynx 4.0.1 家族,构建需 macOS
e2e/                场景化 E2E、跨端对齐与 Web 端诊断
scripts/            构建期脚本(assert-bundle-fresh:校验产物完整性)
docs/web-debug.md   Web 端调试:症状 → 根因 → 解法
```

## 自有宿主 app

`host/` 是极简 Lynx 宿主壳(不依赖 LynxExplorer):`HostApplication` /
`AppDelegate` 注册 Image/Log/Http 服务;开发版 iOS 额外带 DevTool(Inspector),
`agent-lynx` 与 e2e/对齐工具链因此可以直接驱动它,和驱动 Explorer 一样。

- **双 bundle**:`main.lynx.bundle`(示例)与 `probe.lynx.bundle`(对齐探针)都内嵌进 app。
  Android 本地调试包用
  `adb shell am start -n org.pomelo.lynx.debug/org.pomelo.lynx.MainActivity --ez bundle_probe true` 选 probe;
  iOS 用 `PomeloLynx --bundle probe` 启动参数。
- **iOS 两套依赖图**:`host/ios/Podfile` 是本地开发版(带 `LynxService/Devtool`,
  Debug 配置,bundle id `org.pomelo.lynx.debug`,显示名 `Pomelo Lynx Dev`);
  `host/ios/release/Podfile` 是 CI 发版版(不含 Devtool,Release 配置,
  bundle id `org.pomelo.lynx`,显示名 `Pomelo Lynx`)。两者 bundle id 不同,
  可同时安装;CI 版没有 Inspector,`agent-lynx`/`e2e:native` 用本地开发版。
- **Android 两套构建**:本地 debug 用 `assembleDebug`(applicationId `org.pomelo.lynx.debug`,
  显示名 `Pomelo Lynx Dev`);CI 用 `assembleRelease`(applicationId `org.pomelo.lynx`,
  用 debug keystore 签名以便直接侧载,不能用于应用商店发布)。
- **构建**:`pnpm build:host` 生成 JS 产物并拷入两端宿主;APK 用
  `cd host/android && ./gradlew assembleDebug`(需 JDK 17 + Android SDK);
  iOS 需 macOS:`cd host/ios && pod install && xcodebuild ...`(可走
  `.github/workflows/build-hosts.yml` 的 CI 产物)。
- **发版**:`pnpm release:patch`(或 `release:minor` / `release:major`)用内置的
  `pnpm version` 提升 `package.json` 版本,`version` 钩子同步 Xcode 的
  `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`(Android 的 versionName/versionCode
  在构建时从 `package.json` 推导),并生成 `vX.Y.Z` 提交与本地 tag。
  确认后 `git push --follow-tags`:CI 校验 tag 与 `package.json` 一致,构建两端产物
  并发布到同名 Release;日常 push 不触发构建,临时构建用 `workflow_dispatch`。
- **热更新(原生核心已就位,JS 侧待接入)**:两端 `BundleUpdateStore` 移植自
  songloft-player-lynx,含 RSA PKCS#1 v1.5+SHA-256 验签、兼容契约校验、流式下载、
  trial/confirm/rollback 状态机(每进程一次 beginLaunch、bundleId+120s 确认窗口、
  host 变更检测);原生模块 `PomeloUpdate`(getInfo/getState/fetchMetadata/
  inspectManifest/download/cancel/confirmStartup/reportStartupFailure/restoreBuiltin)
  已注册。JS 侧 `src/core/updater/`、设置/关于页 UI 与发布脚本属后续阶段,未实现。
  `scripts/gen-native-host.mjs` 生成宿主元数据(`.build/native-host.json`,字段与
  `updates/native-contract.json` 契约一致),`POMELO_UPDATE_PUBLIC_KEY` 环境变量配置
  签名公钥(未配置则 `trusted_keys` 为空,拒绝一切热更新);`updates/fixtures/
  signature-v1.json` 为验签测试向量(临时私钥已丢弃)。

## 两个 entry

| entry | 源文件 | 用途 |
|---|---|---|
| `main` | `src/index.tsx` | 示例应用 |
| `probe` | `src/probe/index.tsx` | 跨端对齐探针,专供 E2E 与真机采集 |

## 进一步阅读

- [Web 端调试](docs/web-debug.md)—— 常见故障与工具链约束
- [E2E 测试套件](e2e/README.md)—— driver 抽象与场景编写
- [跨端对齐](e2e/alignment/README.md)—— 真机采集与几何比对
- 宿主端参考实现:[songloft-player-lynx](https://github.com/songloft-org/songloft-player-lynx)

---

本项目最初由 `@lynx-js/create-lynx` 引导创建。
