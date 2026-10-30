# 媒体 MVP 交接摘要

## 当前基线

- 正式版:`v0.0.3`(stable,latest)
- 开发分支:`dev`,`package.json` 0.1.0
- UI 约束见 `docs/ui-kit.md`;新控件必须复用共享原语
- 已有 iOS 音频 MVP(iOS 原生模块 + 播放页);Android CI 暂停,先只做 iOS

## 0.1.0 范围

只做 **iOS 音频 MVP**,入口是第三个底部 tab「播放」。

包含:

- 远程 HTTPS 音频 URL
- load / play / pause / seek / stop
- 播放状态、位置、时长
- 页面切换后播放器状态保持
- 后台播放与锁屏控制
- 最小播放 UI

不包含:

- 视频
- 播放队列/缓存/歌词
- Android 实现

## 架构

```text
host/ios/PomeloLynx/PomeloPlayerModule.swift
  NativeModules.PomeloPlayer
  PomeloPlayer.state 全局事件

src/native/player.ts
  原生模块 facade + 状态事件解析

src/core/media/player.ts
  单例播放器 store / actions

src/features/player/PlayerPage.tsx
  第三个 tab 页面
```

## 原生接口

```text
load(requestJSON, callback)   { url, autoplay }
play()
pause()
seek(seconds)
stop()
getState(callback)
```

状态事件 payload:

```json
{
  "state": "idle|loading|playing|paused|ended|error",
  "url": "https://...",
  "position": 0,
  "duration": 0,
  "error": ""
}
```

## JS 约定

- `src/native/player.ts` 只做桥接与字段校验
- `src/core/media/player.ts` 负责状态、hydrate、订阅和动作
- `PlayerPage` 只组合 `PageLargeTitle`、`SettingsGroup`、`ListRow`、
  `TextField`、`Button`、`Hint`、`PageTail`
- 不新增自定义按钮/开关/输入框 CSS

## 测试音频

默认示例(1 MB,约 60 秒,支持 Range;播放页有「加载示例」按钮):

```text
https://cdn.truefilesize.com/mp3/sample-1mb.mp3
```

短冒烟可用 `https://cdn.truefilesize.com/mp3/sample-100kb.mp3`。

## 验证

- `pnpm typecheck`
- `pnpm test`
- `pnpm run check:ios`
- `pnpm run build`
- `pnpm run e2e:web`
- iOS 真机:播放/暂停/seek/停止、切 tab 后继续播放、后台播放、锁屏控制
