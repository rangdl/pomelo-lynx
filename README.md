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
- **热更新**:完整链路已实现(移植自 songloft-player-lynx):
  - **原生**(`host/*/updater/`):`BundleUpdateStore` 含 RSA PKCS#1 v1.5+SHA-256
    验签、兼容契约校验(channel/engine/bridge/schema/能力)、独立系统 TLS 流式
    下载(32 MiB 上限、剩余空间检查、原子提交 pending)、trial/confirm/rollback
    状态机(每进程一次 beginLaunch、bundleId+120s 确认窗口、host 变更检测);
    原生模块 `PomeloUpdate`(九方法)与 `PomeloStorage`(持久偏好,自动更新开关)
    已注册。
  - **JS**(`src/core/updater/`):检查(GitHub Releases,dev=tags/dev、正式=latest)、
    下载会话(taskId 进度隔离/取消)、自动更新策略(默认关;开启立即检查、
    冷启动异步检查、10 分钟最小间隔、6 小时周期、30m/2h/6h 退避、恢复内置自动
    关开关);`UpdateStartup` 在路由挂载 1.5s 后按 bundleId 确认启动,渲染边界
    错误上报回滚。
  - **UI**:底部导航(首页/设置),设置 → 关于 → 客户端更新区(检查/下载/取消/
    待生效提示/恢复内置二次确认);Web 端只提示"随部署更新"。
  - **发布**(`scripts/update-release-lib.mjs`):CI Release job 组装
    version.json+签名+bundle;配 `POMELO_UPDATE_PRIVATE_KEY`(secrets)与
    `POMELO_UPDATE_PUBLIC_KEY`(vars)后附带签名热更新资产,未配钥只出完整包。
    契约在 `updates/native-contract.json`;`updates/fixtures/signature-v1.json`
    为三端共用验签向量(临时私钥已丢弃)。
  - **验证状态**:JS 侧测试/构建/e2e:web 与 node 签名回归本地全绿;Android/iOS
    编译与 `testDebugUnitTest`/`verify-ios-updater` 走 CI;Android/iOS 真机
    端到端(下载→冷启动生效→回退)尚未实测。

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
