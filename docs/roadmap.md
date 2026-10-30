# 原生能力路线图

按批次推进;Android CI job 目前处于暂停状态,Android 原生实现**先写入本计划,
不在恢复编译验证前提交代码**。iOS 改动以 CI 的 `iOS IPA` job 编译通过为准。

## 批次 1:平台包收尾

- [x] JS `pickAndUploadFile` facade(能力探测、参数校验、回调 Promise 化)
- [x] iOS `pickAndUploadFile`(`UIDocumentPicker` + multipart/form-data 上传)
- [ ] **Android `pickAndUploadFile`(计划,待恢复 Android 构建)**
  - 新增 `FilePickerActivity`(或 `ActivityResultLauncher`),通过
    `ACTION_OPEN_DOCUMENT` 选择文件,结果经单例回调交回 `PomeloPlatformModule`
  - 读取 `content://` URI 时使用现有 `FileProvider`/ContentResolver,限制 32 MiB
  - 用 OkHttp 构造 multipart `POST`;复用宿主 TLS 策略
  - 验证:`cd host/android && ./gradlew --no-daemon assembleDebug` + 真机选择/上传/取消
- [x] 原生日志分享:现有 `PomeloLog.shareRecent` 已覆盖文本日志分享;
  原生日志 zip 快路径暂不做(pomelo 没有后端日志,收益不足)

## 批次 1b:版本、发布与客户端更新

- [x] 规范版本与展示版本分离:`0.0.3` / `dev-0.0.3 (125)`
- [x] iOS 注入 `hostVersion`、`hostBuild`、`hostChannel`;iOS 增加
      `PomeloChannel` build setting
- [ ] **Android 注入 `hostBuild`/`hostChannel`(计划,待恢复 Android 构建)**
  - `MainActivity` 的初始/`onNewIntent` globalProps 增加字段
  - channel 由 `BuildConfig.DEBUG` 或构建字段决定;恢复 Android CI 后再提交
- [x] 关于页拆成「加速设置」「客户端更新」与「Bundle 热更新」
- [x] 新增 `client.json` 固定资产:客户端版本、构建号、IPA size/sha256、changelog
- [x] iOS 下载合并为「打开下载地址」:代理开启走加速地址,否则走 GitHub
      原始地址;不自动安装
- [x] 加速设置:默认 `https://gh-proxy.org`、默认开启、自定义 HTTPS 地址、
      开关同时作用于 Release API / version.json / client.json / Bundle 下载
- [x] Release 资产固定文件名;正式版不再上传带版本号 IPA
- [x] CI 支持 `v*` 正式 tag 与 `dev-v*` dev tag;master/dev 分支 push 不自动构建
- [x] changelog 从 conventional commit 生成,同时用于 GitHub Release 和 App
- [x] 移除 Release 上传里的 `|| true`,失败不再被吞
- [ ] **Android APK 客户端更新(计划,待恢复 Android 构建)**
  - `client.json.assets` 增加 android 资产;下载后走 PackageInstaller
  - 需要 APK 签名/摘要校验后再提示安装
- [ ] **iOS 真机验证**:关于页加速设置、单一下载入口、changelog 展示
  - 本地 Linux 无法编译 iOS;iOS 编译与行为以 CI `iOS IPA` job 为准

## 批次 1c:UI 框架收敛

- [x] 共享原语:`Switch`/`SwitchRow`、`TextField`、`Button`、`Hint`、
      `IconBadge`、`PaletteSwatches`
- [x] 页面骨架 `SettingsSubPage` / `SettingsLargeTitle` / `PageTail`
- [x] 设置/关于/开发者/主题色/日志页迁移到共享设置行与控件
- [x] 非颜色设计 token(`layout-tokens.css`)
- [x] 主题色卡片与 swatch 复用
- [x] `docs/ui-kit.md` + UI 契约测试,禁止 feature 内重新手写
- [ ] iOS 真机视觉回归:开发者页、日志设置、主题色卡片
  - 本地 Linux 无法验证;iOS 以 CI IPA / dev server 为准

## 批次 2:系统外观 / 安全区 / 深色模式

- [x] JS 主题 token(`src/shared/theme/tokens.css`)与深色模式
- [x] `SystemAppearance` facade:初值走 `lynx.__globalProps`,变更走全局事件
- [x] 安全区统一注入(`--safe-*`),ShellLayout 用宿主上报的 px 值覆盖
- [x] iOS:`ViewController` 注入 `colorScheme`/安全区,监听 trait 与安全区变化
- [x] 应用外观(跟随系统/浅色/深色)同步到 UIKit;首页背景改用主题 token
- [ ] **Android(计划)**
  - `SystemAppearance.kt`:读取 `uiMode`、字体缩放、`ANIMATOR_DURATION_SCALE`
  - `MainActivity` 监听 `onConfigurationChanged`,通过 `sendGlobalEvent` 推送
  - 首帧初值写入 `LynxLoadMeta` 的 globalProps
  - 验证:`assembleDebug` + 深色/字体缩放/减少动效真机检查

## 批次 3:Android 返回键 + 通用 UI 原语

- [ ] **Android 返回键(计划,待恢复 Android 构建)**
  - `MainActivity` 拦截 `onBackPressedDispatcher` / `KEYCODE_BACK`
  - 新增 `PomeloNavigation` 模块或在 `MainActivity` 直接 `sendGlobalEvent`
  - 顺序:覆盖层 LIFO → 子页父级 → tab 根退出;是否可返回由 JS 状态决定
  - 无覆盖层且已在 tab 根时调用 `finish()`;iOS 无返回键,不实现
  - 验证:`assembleDebug` + 真机返回手势/按键
- [x] iOS 左边缘跟手返回:宿主上报 swipe 位移,JS 主线程平移页面后 pop/回弹;按 tab 保留页面栈
- [x] 输入框键盘避让:`avoid-keyboard` + 12px spacing(待真机验证)
- [x] 外观设置改为单条目 + 右侧锚定浮层;底栏指示器固定高度居中
- [x] 页面 push/pop/fade 挂载动画(Lynx 无原生导航栈)
- [x] Flutter ColorScheme 风格 token 与 default/violet 完整变体
- [x] 主题色设置子页(default/violet/sunset/teal 预览卡片)
- [x] JS `ListRow` 原语(设置/关于页复用,统一 leading/content/trailing)
- [x] i18n 基础设施:`lynx.__globalProps.language` + 中英文核心文案
  - 首版覆盖导航、设置、关于、日志标题;开发者区/更新区文案暂留中文
- [ ] **Android i18n 注入(计划)**:`MainActivity` 把 `Locale.getDefault()` 写入
  `LynxLoadMeta.globalProps.language`

## 媒体 MVP(0.1.0)

- [x] iOS `PomeloPlayer` 原生模块(load/play/pause/seek/stop/getState)
- [x] JS native facade + 单例播放器 store
- [x] 第三个「播放」tab + 最小播放页
- [ ] iOS 真机播放/seek/切 tab 后继续播放验证
- [ ] 后台播放/锁屏控制(后续)
- [ ] Android ExoPlayer(后续)
- [ ] 视频/播放队列/缓存(后续)

## 开发者页与 dev server 热切换

- [x] 设置页拆出独立子页 `/settings/developer`(Dev Server + 调试通道)
- [x] iOS 连接/刷新先下载并校验 bundle,成功后才重建 LynxView,无需冷启动
- [x] 冷启动失败回退内嵌 bundle 时保留 `dev_server_url`,开发者页可重试
- [x] 开发者页每 3 秒 `HEAD` 探测;服务器恢复后自动重新下载并重载
- [ ] **Android(计划,待恢复 Android 构建)**:对应 `PomeloPlatform`
      热切换方法 + `HostTemplateProvider` http(s) 分支;复用同一套 JS 页面

## 依赖与验证边界

- Android 原生:CI 的 `android` job 已注释;恢复步骤见 `docs/dev-server.md`。
  在此之前只维护本计划,不提交无法编译的 Kotlin。
- iOS 原生:本地 Linux 无 Xcode;每次改动运行 `pnpm run check:ios`,再以 CI
  的 `iOS IPA` job 为准。
- 媒体 0.1.0 只做 iOS 音频 MVP;视频/缓存/歌词/Live Activity/EQ 等需要后续
  单独确认,不混入当前批次。

## 底栏材质与动画

- [x] 主线程 spring/jelly 指示器(`TabIndicator`:350ms spring、travel + jelly)
- [x] iOS 真背景模糊:`<blur-view>` + `XElement/BlurView`(`blur-radius=24px`,
      `blur-effect=extra-light/dark`),tint 在其上着色(真机已验证)
- [x] 无 blur-view 平台兜底:半透明渐变 + 内高光 + 外阴影
- [x] Web:web-core 将 `blur-view` 映射为 `x-blur-view`;ShellLayout 在 Web
      渲染 `<blur-view>`。已验证 `backdrop-filter: blur(24px)` 生效
      (web-shell 的别名保留,web-core 以后不映射时兜底)
- [ ] **Android(计划,待恢复 Android 构建)**
  - `host/android/app/build.gradle.kts` 增加
    `implementation("org.lynxsdk.lynx:xelement-blur-view:4.0.0")`
  - ShellLayout 在 Android 也渲染 `<blur-view>`,并用
    `android-capture-target` 指定底栏背景源
  - 验证:`assembleDebug` + 真机滚动页面上方的模糊/性能
- [ ] **可选:折射透镜(对齐 songloft 的液态玻璃)**
  - iOS 26(计划):`SongloftTabGlassUI` 的 `UIGlassEffect` 路径;需要 iOS 26 设备/SDK 验收
  - Android:`TabGlassRefraction` 的 `RenderNode` + `RuntimeShader`(AGSL)
  - 需要原生能力位与真机验收;未实现前保持 blur-view + tint
