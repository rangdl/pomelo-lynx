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

- [ ] **Android 返回键(计划)**
  - 新增 `PomeloNavigationModule` 或复用 `MainActivity.onBackPressed`
  - 覆盖层 LIFO → 子页父级 → tab 根退出,状态由 JS 提供
  - 验证:`assembleDebug` + 真机返回手势/按键
- [ ] JS `ListRow` 原语(设置/关于页复用,统一 leading/content/trailing)
- [ ] i18n(当前中文硬编码;先抽 key,再决定是否接宿主语言)

## 依赖与验证边界

- Android 原生:CI 的 `android` job 已注释;恢复步骤见 `docs/dev-server.md`。
  在此之前只维护本计划,不提交无法编译的 Kotlin。
- iOS 原生:本地 Linux 无 Xcode;每次改动运行 `pnpm run check:ios`,再以 CI
  的 `iOS IPA` job 为准。
- 媒体(音频/视频/缓存/DLNA/歌词/Live Activity/EQ)不在本路线图,待单独确认
  播放源、平台顺序、后台播放与 UI 位置。
