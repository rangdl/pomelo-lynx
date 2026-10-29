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

## 批次 2:系统外观 / 安全区 / 深色模式

- [x] JS 主题 token(`src/shared/theme/tokens.css`)与深色模式
- [x] `SystemAppearance` facade:初值走 `lynx.__globalProps`,变更走全局事件
- [x] 安全区统一注入(`--safe-*`),ShellLayout 用宿主上报的 px 值覆盖
- [x] iOS:`ViewController` 注入 `colorScheme`/安全区,监听 trait 与安全区变化
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
- [x] JS `ListRow` 原语(设置/关于页复用,统一 leading/content/trailing)
- [x] i18n 基础设施:`lynx.__globalProps.language` + 中英文核心文案
  - 首版覆盖导航、设置、关于、日志标题;开发者区/更新区文案暂留中文
- [ ] **Android i18n 注入(计划)**:`MainActivity` 把 `Locale.getDefault()` 写入
  `LynxLoadMeta.globalProps.language`

## 依赖与验证边界

- Android 原生:CI 的 `android` job 已注释;恢复步骤见 `docs/dev-server.md`。
  在此之前只维护本计划,不提交无法编译的 Kotlin。
- iOS 原生:本地 Linux 无 Xcode;每次改动运行 `pnpm run check:ios`,再以 CI
  的 `iOS IPA` job 为准。
- 媒体(音频/视频/缓存/DLNA/歌词/Live Activity/EQ)不在本路线图,待单独确认
  播放源、平台顺序、后台播放与 UI 位置。

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
