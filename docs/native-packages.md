# 原生包结构

本文记录 iOS/Android 原生能力的分包方式、Autolink 接入边界和目录范围。
目标不是让原生代码热更新，而是把能力按用途隔离，减少重复构建和互相影响。

## 1. 包边界

```text
packages/
  lynx-storage/      prefs / secure / 基础路径
  lynx-filesystem/   目录管理 + 文件读写
  lynx-platform/     openURL / 剪贴板 / 分享 / 文件选择上传
  lynx-media/        播放器、队列、歌词、未来视频/MPV
```

继续留在宿主 App target 的能力:

- `PomeloUpdate`:启动选择、签名、下载、试运行、回滚
- `PomeloLog`:宿主日志基础设施
- dev server 控制:依赖 `ViewController` 与 LynxView 生命周期
- DebugRouter / DevTool 反向隧道

## 2. Autolink 与手动注册

iOS 使用 `cocoapods-lynx-library` 发现 `node_modules` 里的 `lynx.lib.json`，
自动把包 pod 链接进宿主，并生成 `LynxLibraryRegistry`。

但 4.2.0 的 registry 扫描器只识别 ObjC 注解
(`@LynxNativeModule` / `@LynxElement` / `@LynxService`)，不识别 Swift
`LynxModule` 类。因此当前采用混合模式:

- Autolink 负责 pod 发现、依赖解析和链接
- Swift 模块仍由 `ViewController.buildConfig` 手动 `config.register`
- 包内类用 `@objc(ClassName)` 暴露稳定 ObjC 名称
- 等 Autolink 支持 Swift 或稳定版提供 Swift 扫描后，再移除手动注册

CI 安装:

```ruby
plugin 'cocoapods-lynx-library'
target 'PomeloLynx' do
  use_lynx_library!
end
```

```bash
gem install cocoapods-lynx-library -v 4.2.0 --no-document
```

## 3. 目录范围

| Area | iOS | Android | 用户可见 | 可清理 | 备份 |
|---|---|---|---|---|---|
| `appData` | Application Support | `filesDir` | 否 | 否 | 是 |
| `cache` | Caches | `cacheDir` | 否 | 是 | 否 |
| `temp` | `tmp` | cache 子目录 | 否 | 是 | 否 |
| `documents` | Documents | `getExternalFilesDir(null)` | 是* | 否 | 是 |
| `noBackup` | Application Support/NoBackup | `noBackupFilesDir` | 否 | 否 | 否 |
| `external` | 不支持 | `getExternalFilesDirs()` | 否 | 否 | 视情况 |
| `externalCache` | 不支持 | `getExternalCacheDir()` | 否 | 是 | 否 |

\* iOS 的 Documents 在 `Info.plist` 已启用 `UIFileSharingEnabled` 和
`LSSupportsOpeningDocumentsInPlace`，可通过“文件”App 访问。

不要暴露任意绝对路径或 `/sdcard`。Android 共享媒体走 MediaStore/SAF，
iOS 导出走系统分享面板或文件选择器。

## 4. 文件 API

`PomeloFileSystem` 只接受 `area + relativePath`，拒绝绝对路径、`..`、
反斜杠和符号链接逃逸。

```text
getPath / list / stat / exists
readText / writeText / appendText
readBase64 / writeBase64
mkdir / remove(recursive) / move / copy
```

限制:

- 文本单文件 8 MiB，base64 单文件 16 MiB
- list 最多 1000 项
- 写入使用原子替换
- 回调统一为 JSON `{ ok, ... }` 或 `{ ok:false, error }`

## 5. 媒体包规划

```text
PomeloLynxMedia
  Core    后端协议、状态、队列、Now Playing
  Audio   音频、后台、锁屏、歌词
  Video   视频 Surface / AVPlayerLayer
  MPV     未来后端
```

- 音频和视频通过 subspec 分开引入；只装 Audio 不包含视频 View
- `PomeloMediaBackend` 抽象 AVPlayer，未来 MPV 实现同一协议
- `load` 接受 `headers`，支持 Navidrome 等需要认证的音频源
- `getCapabilities` 返回当前后端支持的能力
- 歌词时序放在原生：JS 传 LRC 行，原生时间观察者更新 Now Playing
  `title`/`artist`，锁屏和后台可用
- 默认歌词模式 `title`，可切换 `artist`/`album`，切歌自动清空

## 6. 媒体 API

```ts
load(url, { headers })
setQueue(items[{ url, headers, title, artist, album, artwork }])
setLyrics(lines[{ time, text }], mode: 'title' | 'artist' | 'album')
clearLyrics()
setNowPlayingOverride({ title, artist, album, lyrics })
clearNowPlayingOverride()
setRate(0.1..4.0)
setVolume(0..1)
getCapabilities()
setEngine('system' | 'avplayer')
```

- 歌词时序在原生 `tick` 中计算,后台/锁屏也能更新
- JS `parseLrc()` 负责把 LRC 转为时间行
- `headers` 支持 Navidrome 等需要认证的音频源
- `getCapabilities()` 当前返回 `video:false`;视频和 MPV 后续扩展

### 视频与 MPV

```text
PomeloLynxMedia/Audio  当前实现,默认引入
PomeloLynxMedia/Video  未来: pomelo-video-view + AVPlayerLayer
PomeloLynxMedia/MPV    未来: MPVKit/libmpv 后端
```

- 音频包不包含视频 Surface;视频 View 只能显式引入 Video subspec
- `PomeloMediaBackend` 是后端协议,AVPlayer 先实现,MPV 后续替换
- `setEngine('system' | 'mpv')` 已预留;当前只接受 `system/avplayer`
- 视频 Surface 需要独立的原生自定义元件,不复用 Now Playing/歌词
- Android 端对应 Media3/ExoPlayer + 独立 Surface;等待 Android CI 恢复

## 7. 冷启动与 dev bundle

冷启动不再同步等待 dev server:

1. 有 dev bundle 缓存:直接加载缓存,立即出首屏
2. 没有缓存:先加载内置 bundle,后台下载 dev bundle
3. 下载成功:暂存并重建 LynxView;失败保留内置版本
4. LynxView 上方有原生 loading overlay,首屏后移除
5. dev bundle 缓存在 Application Support/DevBundles,按 URL hash 命名,
   32 MiB 上限,校验 Lynx bundle 头,排除 iCloud 备份
6. 清除/切换 dev server 时删除对应缓存
7. 更新 bundle 与 dev bundle 仍保持两套策略;只共享“下载/校验”概念,
   不共享签名、试用和回滚状态

## 8. 当前进度

- [x] pnpm workspace
- [x] `lynx-storage` 原生包
- [x] `lynx-filesystem` 原生包
- [x] `lynx-platform` 原生包 + 宿主 `PomeloHost`
- [x] `lynx-media` 原生包 + 音频/队列/headers/歌词
- [x] Autolink pod 发现、CI gem、iOS job pnpm 安装
- [x] dev bundle 冷启动缓存 + 原生 loading overlay
- [ ] 视频 Surface
- [ ] MPV 后端
- [ ] Android 原生包（等待 Android CI 恢复）
