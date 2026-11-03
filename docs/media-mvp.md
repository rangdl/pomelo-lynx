# 媒体 MVP 交接摘要

## 当前基线

- 正式版:`v0.0.3`(stable,latest)
- 开发分支:`dev`,`package.json` 0.1.0
- UI 约束见 `docs/ui-kit.md`;新控件必须复用共享原语
- 已有 iOS 音频 MVP(iOS 原生模块 + 播放页);Android CI 暂停,先只做 iOS

## 0.1.0 范围

只做 **iOS 音频 MVP**,入口是首页音乐库 + 第三个底部 tab「播放」。

包含:

- 远程 HTTPS 音频 URL
- load / play / pause / seek / stop
- 播放状态、位置、时长
- 页面切换后播放器状态保持
- 队列末尾追加、插到当前曲目之后、移出队列
- 后台播放与锁屏控制
- 原生同步队列、上一首/下一首、结束自动下一首(含锁屏/后台)
- 队列项元数据(标题/歌手/专辑/封面),锁屏显示
- 5sing 测试歌单入口(第三方接口,仅用于联调;`clientBuild.channel === 'dev'`
  时才渲染,正式版不展示该分组)
- Songloft Provider 入口(`/settings/sources`,见 [音乐源 Provider](providers.md))
- 首页音乐库:最近添加、歌单、搜索、分页加载
- 底栏上方播放胶囊(首页/播放页显示,设置页隐藏)
- 原生 `track` 事件按曲目懒加载歌词
- 队列元信息持久化与 Provider 闭包恢复
- 最小播放 UI

不包含:

- 视频
- 音频缓存
- 歌词全屏滚动页
- Android 实现

## 架构

```text
host/ios/PomeloLynx/PomeloPlayerModule.swift
  NativeModules.PomeloPlayer
  PomeloPlayer.state  0.5s 状态快照
  PomeloPlayer.event  语义事件(loaded/started/error/refresh_*)

src/native/player.ts
  原生模块 facade + 状态/事件解析 + resolveRefresh

src/core/media/player.ts
  单例播放器 store / actions / 队列持久化 / 事件驱动歌词

src/shared/layouts/MiniPlayer.tsx
  底栏上方播放胶囊(首页/播放页显示,设置页隐藏)

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
resolveRefresh(requestJSON)   { requestId, url, headers, error }
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

- 队列上限由「播放设置」控制(20–500,默认 200);原生传输硬上限 500;
  `url` / `artwork` 只接受 http(s)
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
  "queueIndex": 0,
  "refreshing": false
}
```

## 语义事件

`PomeloPlayer.event` 是边沿触发事件,与 0.5s 状态快照互补:

```json
{
  "type": "track|loaded|started|paused|waiting|ended|stopped|error|refresh_required|refresh_applied|refresh_failed",
  "url": "https://...",
  "queueIndex": 0,
  "title": "标题",
  "artist": "歌手",
  "album": "专辑",
  "position": 0,
  "duration": 0,
  "error": "",
  "requestId": "",
  "status": 0
}
```

- `track`: 原生切到某个队列项(load/上一首/下一首/自动下一首)
- `loaded`: AVPlayerItem readyToPlay,时长已可用
- `started`: 实际开始出声(每次从暂停/等待恢复都会发)
- `paused` / `waiting`: 用户暂停 / 缓冲等待
- `ended`: 队列最后一首播完
- `stopped`: 显式停止
- `error`: 非鉴权失败,`status` 带 HTTP 状态(若可获取)
- `refresh_required`: 检测到 401/403,等待 JS 回传新链接
- `refresh_applied` / `refresh_failed`: JS 响应已应用 / 刷新失败

## Token 过期刷新

Lynx 的 `LynxContext.sendGlobalEvent` / `GlobalEventEmitter.emit` 是**单向广播**,
返回 `void`,监听器返回值不会回到原生;公开 API 也没有原生同步调用 JS 函数
并取返回值的通道。因此这里用 `requestId` 做异步 RPC:

- `refresh_required` 是请求事件;
- `resolveRefresh(requestId, ...)` 是回复方法,等价于“事件的返回值”;
- 原生只接受当前 pending `requestId`,超时/过期响应丢弃。

1. 原生从 `AVPlayerItem.errorLog` / `AVPlayerItemNewErrorLogEntry` 检测 401/403
2. 暂停当前 item,状态切到 `loading`,`refreshing=true`
3. 发 `refresh_required`(含 `requestId`、`queueIndex`、`status`)
4. JS 从 `MediaTrack.resolve()` 先强制刷新 Provider token,再取新流地址
5. JS 更新自己的队列,再调用 `resolveRefresh(requestId, ...)`
6. 原生更新自己的队列项 URL/headers,从原位置重载;按 `desiredPlaying` 决定是否续播
7. 12 秒无响应或 JS 返回错误 -> `refresh_failed`,状态 `error`

同一 item 最多连续刷新 3 次;成功开始播放后重置计数。非 Provider 的裸 URL
没有 `resolve` 闭包,会直接回传 `player_refresh_unavailable`。

## JS 约定

- `src/native/player.ts` 只做桥接与字段校验
- `src/core/media/player.ts` 负责状态、hydrate、订阅和动作;队列项是
  `MediaTrack`(`url/title/artist/album/artwork/resolve/lyrics/providerId/
  providerTrackId`);`resolve` 是刷新闭包,`lyrics` 按 `track` 事件懒加载
- 队列操作:
  - `enqueueMedia(url, meta?, 'end' | 'next')`:默认追加到末尾,
    `next` 插到当前曲目之后;已在队列中的曲目用 `next` 会移动到下一首位置
  - `removeMediaAt(index)`:移出当前曲目时按原播放状态切到下一首,
    没有下一首则停止并保留前面的队列
- `PlayerPage` 只组合 `PageLargeTitle`、`SettingsGroup`、`ListRow`、
  `TextField`、`Button`、`Hint`、`PageTail`
- 播放胶囊统一由 `MiniPlayer` 提供;首页/播放页显示,`/settings*` 隐藏;
  Shell 用 `.shell--mini-player` 把尾部留白从 84px 提升到 144px
- 首页是音乐库:最近添加、歌单、搜索、加载更多,点歌曲播放/入队
- 不新增自定义按钮/开关/输入框 CSS

## 队列持久化

- 队列写入 `PomeloStorage.secure` 的 `pomelo.media.queue.v1`,
  上限由「播放设置」控制(20–500,默认 200);URL、headers、artwork
  原样保存。原生传输硬上限 500。
- 每页歌曲数(10–200,默认 50)同时用于首页最近添加、歌单和搜索结果。
- Provider 曲目保存 `providerId/providerTrackId`;恢复时重新挂 `resolve` 和
  `lyrics` 闭包,播放/刷新时再取新流。
- 冷启动恢复队列和当前索引,但不自动播放;用户点歌后才真正加载。
- 位置每 5 秒落盘一次,队列/索引变化立即落盘。
- 断开音乐源时删除持久化队列,避免下次启动把旧服务器曲目当成新服务器曲目。

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
