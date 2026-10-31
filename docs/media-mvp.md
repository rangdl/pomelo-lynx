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
- 队列末尾追加、插到当前曲目之后、移出队列
- 后台播放与锁屏控制
- 原生同步队列、上一首/下一首、结束自动下一首(含锁屏/后台)
- 队列项元数据(标题/歌手/专辑/封面),锁屏显示
- 5sing 测试歌单入口(第三方接口,仅用于联调)
- 最小播放 UI

不包含:

- 视频
- 队列持久化/缓存/歌词
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
setQueue(requestJSON)         { items, index }
next()
previous()
```

`setQueue` 只接受一份 `items`,每项自带 `url`,不再有顶层 `urls`:

```json
{
  "index": 0,
  "items": [
    {
      "url": "https://.../a.mp3",
      "title": "标题",
      "artist": "歌手",
      "album": "专辑",
      "artwork": "https://.../cover.jpg"
    }
  ]
}
```

- 队列最多 50 项;`url` / `artwork` 只接受 http(s)
- `url` 必填;`title` 可空,空标题由原生回退到 URL 文件名
- 每项可以带 `headers`,用于 Navidrome 等需要认证的音频源
- JS 入队时也会用 URL 文件名兜底标题
- 标题/歌手/专辑截断到 200 字符
- 封面最大 8 MiB,加载失败不影响播放
- 开发期不做旧协议兼容,不允许再发送 `urls`

状态事件 payload:

```json
{
  "state": "idle|loading|playing|paused|ended|error",
  "url": "https://...",
  "position": 0,
  "duration": 0,
  "error": "",
  "queueIndex": 0
}
```

## JS 约定

- `src/native/player.ts` 只做桥接与字段校验
- `src/core/media/player.ts` 负责状态、hydrate、订阅和动作;队列项是
  `MediaTrack`(`url/title/artist/album/artwork`)
- 队列操作:
  - `enqueueMedia(url, meta?, 'end' | 'next')`:默认追加到末尾,
    `next` 插到当前曲目之后;已在队列中的曲目用 `next` 会移动到下一首位置
  - `removeMediaAt(index)`:移出当前曲目时按原播放状态切到下一首,
    没有下一首则停止并保留前面的队列
- `PlayerPage` 只组合 `PageLargeTitle`、`SettingsGroup`、`ListRow`、
  `TextField`、`Button`、`Hint`、`PageTail`
- 不新增自定义按钮/开关/输入框 CSS

## 测试音频

默认示例(1 MB,约 60 秒,支持 Range;播放页有「加载示例」按钮):

```text
https://cdn.truefilesize.com/mp3/sample-1mb.mp3
```

短冒烟可用 `https://cdn.truefilesize.com/mp3/sample-100kb.mp3`。

## 5sing 测试歌单

播放页「5sing 测试」分组可以从第三方 5sing 接口拉取 8 首真实歌曲:

- 歌单歌曲:`http://service.5sing.kugou.com/song/getPlayListSong`
- 播放地址:`https://5sservice.kugou.com/song/getsongurl`
- 播放地址需要插件脚本里的 MD5 时间签名,每次加载重新获取
- 标题、歌手来自歌单,专辑固定为「5sing 古风测试歌单」,封面用歌手头像
- 只用于队列/锁屏联调,不是正式媒体来源;接口可能限流或失效
- 请求保持在 JS:`lynx.fetch` 或浏览器 `fetch`,不引入原生 5sing 模块
- iOS 宿主必须在 `host/ios/pods.rb` 安装 `LynxService/Http`;缺少时所有
  `fetch` 都会报 `Lynx Http Service not registered`
- 播放页「运行诊断」会测试 HTTPS/HTTP 基线、5sing 最小头/完整头、
  `text` 与 `response.json()` 两条解析路径,并把原始错误写入日志
- Web 预览可能被跨域拦截;诊断结果同样会显示在页面上
- 单首解析失败会跳过,全部失败时页面显示错误;未知错误会带错误码

## 验证

- `pnpm typecheck`
- `pnpm test`
- `pnpm run check:ios`
- `pnpm run build`
- `pnpm run e2e:web`
- iOS 真机:播放/暂停/seek/停止、切 tab 后继续播放、后台播放、锁屏控制、
  锁屏标题/歌手/专辑/封面、队列切歌元数据同步
- iOS 真机:「加载 5sing 歌单」能拉取 8 首、加入队列并正常播放
- iOS 真机:锁屏歌词 `title/artist` 模式、切歌清空歌词
- iOS 真机:带 headers 的音频源、rate/volume、capabilities
