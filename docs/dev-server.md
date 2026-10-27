# 连接开发服务器(实时开发)

宿主 app 像 Lynx Explorer 一样加载 `pnpm dev`(rspeedy dev server)实时编译的
`.lynx.bundle`:改代码 → 增量编译 → app 重新拉取,无需重新构建宿主。

## iOS(已实现)

### 构建与分发

- dev 通道(master push / workflow_dispatch)CI 用顶层
  `host/ios/Podfile`(devtools: true)+ **Debug configuration** 构建:
  自带 LynxService/Devtool(Inspector),bundle id `org.pomelo.lynx.debug`。
- tag 正式发版仍用 `host/ios/release/Podfile`(devtools: false)+
  Release configuration:体积小、无 Inspector,bundle id `org.pomelo.lynx`。
- 两套 Podfile 共用同一 Pods 沙盒(见 `host/ios/pods.rb`),一次构建只装一套。

### 页面操作流程

1. 设置页 →「开发者」区(仅 `channel === 'dev'` 显示):
   粘贴 dev server URL(电脑跑 `pnpm dev`,终端打印带 IP 的 bundle URL,
   手机与电脑同网段),点「连接并重启生效」。
2. URL 写入 prefs(`pomelo_prefs` suite,key `dev_server_url`),
   **重启 app 生效**——宿主启动时 `ViewController` 读取该 key 交给
   `HostTemplateProvider`。
3. `HostTemplateProvider.loadTemplate` 识别 http(s) 前缀走 URLSession 拉取
   (15s 超时);**加载失败自动清除该 key 并回退内嵌 bundle**,坏 URL 不会
   把 app 钉死在黑屏。
4. 「断开连接」清除 key,回退内嵌 bundle。
5. 日常循环:改代码 → rspeedy 增量编译 → 重启 app(或冷启动)拉新 bundle;
   Inspector 由 Devtool lazy-register 自动就绪,`agent-lynx` 直接连。

### 本地开发

模拟器/真机 `xcodebuild -configuration Debug`(或 Xcode Run)即带 Devtool;
`POMELO_DEBUG=1` 环境变量照旧控制 `isDebug` globalProp。

## Android(未实现,恢复安卓构建时按此实施)

Android 侧 devtool 依赖已就位(`lynx-service-devtool`,build.gradle.kts),
缺以下三件事:

1. **Devtool 门控放开**:Android 注册由 `BuildConfig.DEBUG` 门控
   (build.gradle.kts buildTypes 注释)。改为
   `BuildConfig.DEBUG || channel == "dev"`,channel 读 assets 的
   `native-host.json`(dev 构建 `channel: "dev"`,tag 构建 `"stable"`,
   由 lynx.config.ts 的 buildMetadata 决定)。
2. **`HostTemplateProvider.kt` 加 http(s) 分支**:与 iOS 同构——uri 以
   http(s) 开头时 `HttpURLConnection` 拉取字节流,失败回落 assets;
   仅 `BuildConfig.DEBUG || channel=="dev"` 启用。
3. **dev URL 注入**:CI dev 包没有设置页可配的话,可复用 intent extra
   `--es dev_url <url>`(MainActivity 读后传给 provider);页面操作逻辑
   与 iOS 设置页「开发者」区一致(URL 存 prefs,key 同为
   `dev_server_url`,storage 走 SharedPreferences)。

### 网络连通性

- 模拟器:`http://10.0.2.2:3000/...`(10.0.2.2 = 宿主机回环)。
- 真机:`adb reverse tcp:3000 tcp:3000` 后用
  `http://127.0.0.1:3000/main.lynx.bundle`,或同网段用电脑 IP。
- iOS 真机:与电脑同网段,直接用 `pnpm dev` 打印的 IP URL。

## 恢复安卓 CI

`.github/workflows/build-hosts.yml` 中 `android` job 已整体注释保留,
恢复时:取消注释、把 `release`/`prerelease` job 的 `needs: [ios]` 改回
`needs: [android, ios]`,并确认 `assembleRelease` 的 devtool 门控按上面
第 1 条实施。
