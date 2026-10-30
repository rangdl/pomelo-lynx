# 连接开发服务器(实时开发)

宿主 app 像 Lynx Explorer 一样加载 `pnpm dev`(rspeedy dev server)实时编译的
`.lynx.bundle`:改代码 → 增量编译 → app 重新拉取,无需重新构建宿主。

## iOS(已实现)

### 构建与分发

- dev 通道(dev tag / workflow_dispatch)CI 用顶层
  `host/ios/Podfile`(devtools: true)+ **Debug configuration** 构建:
  自带 LynxService/Devtool(Inspector),bundle id `org.pomelo.lynx.debug`。
- tag 正式发版仍用 `host/ios/release/Podfile`(devtools: false)+
  Release configuration:体积小、无 Inspector,bundle id `org.pomelo.lynx`。
- 两套 Podfile 共用同一 Pods 沙盒(见 `host/ios/pods.rb`),一次构建只装一套。

### 页面操作流程

1. 设置页 →「开发者」→ 开发者子页(仅 `channel === 'dev'` 且 iOS 显示):
   粘贴 dev server URL(电脑跑 `pnpm dev`,终端打印带 IP 的 bundle URL,
   手机与电脑同网段),点「连接并重载」。
2. 原生先完整下载并校验 bundle(`HostTemplateProvider.fetchRemoteData`,
   15s 超时 + Lynx bundle 头部校验),**成功后**才写入 prefs
   (`pomelo_prefs` suite,key `dev_server_url`)并重建 LynxView。
   下载失败时当前页面不动,不会把坏 URL 写进去;无需冷启动。
3. 「刷新」重新下载当前 dev URL 并重建 LynxView;「断开」清配置并立即
   回到内嵌 bundle,也不需冷启动。
4. 开发者页每 3 秒对当前 URL 发一次 `HEAD` 健康探测。服务器重启后从
   离线变在线时,页面会自动重新下载并重载,不再需要手动冷启动。
5. 冷启动时如果服务器暂时不可达,`ViewController` 会回退内嵌 bundle,
   但**保留** `dev_server_url`;开发者页仍显示该配置,服务器恢复后自动
   重试或由「刷新」手动重试。
6. 日常循环:改代码 → rspeedy 增量编译 → 开发者页「刷新」;Inspector 由
   Devtool lazy-register 自动就绪,`agent-lynx` 直接连。

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

## 本地开发服务端口

`pnpm dev` 固定监听 **3090**(外网映射端口)。不要依赖自动 fallback 的端口,
其他端口没有映射时手机访问不到。容器内 3000 被占用时旧行为会退到未映射端口。

## dev server 回退的常见原因

- **首屏后出现 399/301**:日志里是 `fatal=false` 的 sourcemap/devtool 错误,
  dev bundle 实际已经渲染。宿主只在 fatal,或还没出首屏(下载/解码失败)时
  回退内嵌 bundle;`dev_server_url` 保留,开发者页可以重试。
- **服务没起来/端口不对**:先 `curl http://localhost:3090/main.lynx.bundle`
  确认 200,再在开发者页点「刷新」(或重新连接),不需要冷启动。
- **dev bundle 已下载但加载失败**:日志里应有 `fetched ...B → callback`,
  随后才是 Lynx 错误;区分下载失败和解码/首屏错误。
