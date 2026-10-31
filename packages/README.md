# Native packages

Lynx 原生能力按用途拆成 npm 包。iOS 由 Autolink 发现 `lynx.lib.json`
并链接 pod;Swift 模块暂由宿主 `ViewController.buildConfig` 手动注册。

```text
lynx-storage     prefs / secure / 基础路径
lynx-filesystem  目录 + 文件 API
lynx-platform    通用平台能力
lynx-media       音频/队列/歌词;视频与 MPV 预留 subspec
```

## Android

Android 侧沿用相同的包边界,计划为每个包增加:

```text
android/
  build.gradle.kts
  src/main/java/org/pomelo/lynx/<area>/
```

接入方式:

- `settings.gradle.kts` 增加 `include(":lynx-storage")` 等本地 module
- 每个 module 依赖 `org.lynxsdk.lynx` 对应版本
- `PomeloStorageModule` 等 Kotlin 类迁入对应 module
- 宿主 `HostApplication` 注册 module
- 共享的路径/文件/媒体错误码与 JS facade 保持一致

**Android CI 当前暂停**,在恢复 `assembleDebug` 前只维护本计划,不提交
无法编译的 Kotlin。

## iOS

- `lynx.lib.json` 指向 podspec
- `cocoapods-lynx-library` 生成 `LynxLibraryRegistry` 并添加 pod
- 因为 registry 扫描器只识别 ObjC 注解,Swift 类仍手动注册
- podspec 不写 `:modular_headers`;在 `host/ios/pods.rb` 的 Lynx 家族声明上启用
