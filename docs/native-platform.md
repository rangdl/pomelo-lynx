# 原生平台能力(PomeloPlatform)

宿主平台基础能力的 JS facade(`src/native/platform.ts`)与两端原生模块契约。
当前覆盖打开 URL、剪贴板、屏幕常亮、分享文件;文件选择上传放在下一批。

## 方法

| JS facade | `NativeModules.PomeloPlatform` | 回调 | Android | iOS |
|---|---|---|---|---|
| `openURL(url): boolean` | `openURL(url)` | 无 | ✅ | ✅ |
| `setClipboard(text): Promise<void>` | `setClipboardWithResult(text, cb)` / `setClipboard(text)` | `error: string \| null` | ✅ | ✅ |
| `setKeepScreenOn(enabled): boolean` | `setKeepScreenOn(enabled)` | 无 | ✅ | ✅ |
| `shareFile({ base64, fileName, mimeType }): Promise<void>` | `shareFile(base64, fileName, mimeType, cb)` | `error: string \| null` | ✅ | ✅ |

原生方法遵循 Lynx 约定:写操作 fire-and-forget,需要确认结果的操作用 Callback,
Promise 化只发生在 TS facade。`readPlatformModule()` 会先探测必需方法
(`openURL` / `setKeepScreenOn`),缺一个就整体视为旧壳并降级。

### 消费点

- 关于页「复制版本信息」→ `setClipboard`
- 关于页「打开发布页」→ `openURL`(仅原生;Web 端隐藏)
- `setKeepScreenOn` / `shareFile` 暂无 UI 消费点,留给媒体播放与日志导出

## 错误码

| 错误码 | 来源 | 含义 |
|---|---|---|
| `clipboard_unavailable` | JS / Android | 没有原生模块,Web realm 也没有 `navigator.clipboard` |
| `clipboard_failed` | Android / iOS | 系统剪贴板写入失败 |
| `platform_timeout` | JS | 5 秒内没有收到原生回调 |
| `platform_failed` | JS | 调用原生方法时同步抛错 |
| `share_invalid_payload` | JS / 原生 | base64 为空或解码失败 |
| `share_payload_too_large` | JS / 原生 | 解码后超过 16 MiB |
| `share_invalid_file_name` | JS / 原生 | 文件名不是 `[A-Za-z0-9._-]{1,128}` |
| `share_invalid_mime_type` | JS / 原生 | MIME 不是 `type/subtype` |
| `share_unavailable` | JS / iOS | 没有 `shareFile` 方法,或找不到可展示的控制器 |
| `share_write_failed` | iOS | 临时文件写入失败 |
| `share_failed` | Android | 分享 Intent 启动失败 |

## 安全约束

- `openURL` 只接受 **http/https**,并校验 host,避免 `javascript:` / `file:` 进入宿主。
- `shareFile` 的文件名与 MIME 在 JS 和原生各校验一次;base64 上限 16 MiB。
- Android 写入 `cacheDir/share/`,每次分享前清空目录,通过 `FileProvider`
  (`${applicationId}.fileprovider`)临时授权;iOS 写入 `temporaryDirectory`,
  分享完成回调后删除。
- 所有 UIKit / Window / Clipboard 操作都 post 到主线程。

## 平台差异与降级

| 场景 | 行为 |
|---|---|
| 原生宿主 | 调用 `NativeModules.PomeloPlatform` |
| 旧壳缺 `setClipboardWithResult` | 退回 `setClipboard`,直接 resolve(无法确认结果) |
| 旧壳缺 `shareFile` | `shareFile` reject `share_unavailable` |
| Web(Worker realm) | `openURL` 返回 false;`setClipboard` 尝试 `navigator.clipboard`;常亮与分享降级 |
| Web(DOM realm) | `openURL` 退回 `window.open` |
| 测试 / 纯 Node | 能力探测为 false,写操作静默,回调型操作 reject |

## 验证状态

- **JS**:`pnpm run lint`、`pnpm run typecheck`、`pnpm test` 已通过;
  `src/native/__tests__/platform.test.ts` 覆盖协议白名单、旧壳降级、回调成功/失败、
  参数校验与缺方法场景。
- **Android**:本地环境没有 JDK / Android SDK,未编译。需要 `assembleDebug`
  或恢复 CI 的 android job 后验证;真机需确认 FileProvider 分享与剪贴板。
- **iOS**:本地是 Linux,没有 Xcode,未编译。CI 的 iOS job 会编译;
  真机需确认 UIActivityViewController、剪贴板与常亮。
- 原生端的错误码与回调形状尚未经过真机端到端验证。

## 未实现

`pickAndUploadFile(uploadUrl, fieldName, mimeType, callback)` 需要宿主 Activity
结果链路(Android `ACTION_OPEN_DOCUMENT` / iOS `UIDocumentPickerViewController`)
和文件上传,单独作为下一批实现。
