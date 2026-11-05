# 音乐源 Provider(Songloft)

本文记录跨平台音乐源适配层的契约、Songloft 实现和当前限制。Provider 只负责
“登录 + 浏览 + 解析资源”，播放器仍然只消费 `MediaTrack`。

## 1. 包结构

```text
packages/provider-sdk/
  src/types.ts       MusicProvider / ProviderTrack / ProviderSession / 分页
  src/errors.ts      ProviderError(code/status/detail)
  src/http.ts        URL 归一化、超时、JSON、错误脱敏、Bearer 注入与 401 重放

packages/provider-songloft/
  src/models.ts      Songloft 响应解析（song/playlist/token/lyric）
  src/provider.ts    SongloftProvider 实现

src/core/providers/
  index.ts           宿主单例、secure 会话存储、Track -> MediaTrack

src/features/settings/SourcePage.tsx
  /settings/sources  连接、歌单、搜索、播放/入队
```

Provider 包是纯 TypeScript，不依赖 Lynx 或原生模块；宿主通过
`ProviderRuntime` 注入 `fetch` 与 secure 存储，因此 Web、iOS 可共用同一实现。

## 2. 契约

`MusicProvider` 的最小能力：

```ts
login(input): Promise<ProviderSession>
restore(): Promise<ProviderSession | null>
logout(): Promise<void>
ping(): Promise<void>
search(query, { limit, offset, sort, order, type })
getTrack(id)                 // 队列恢复/刷新后重新取曲目
playlists({ limit, offset })
playlistTracks(playlistId, { limit, offset })
playlistArtwork(playlist, size?) // 歌单封面
albums?({ limit, offset })               // 可选能力
albumTracks?(albumId, { limit, offset }) // ID 语义由各 provider 定义
albumArtwork?(album, size?)               // 可选能力
stream(track): Promise<{ url, headers? }>
lyrics(track): Promise<{ lrc?, translated?, romaji?, wordByWord? } | null>
artwork(track, size?): Promise<string | null>
```

`ProviderTrack` 只暴露展示字段和可选的 `resource`（stream/artwork/lyrics
定位符）。服务端专有字段不进入播放页。

## 2.1 Subsonic / Navidrome

两者共用 `@pomelo/provider-subsonic` 一套实现——Navidrome 官方声明兼容
Subsonic REST API v1.16.1,所以同一个类即可,差别只在显示名和是否支持 API Key。

**只走 `/rest`,不用 Navidrome 原生 `/api`。** 原生接口没有官方文档(第三方
文档是抓包整理的),且 0.55 版本重构过;`/rest` 才是跨 Subsonic 生态的稳定契约。

| 能力 | 端点 | 说明 |
| --- | --- | --- |
| 连通/登录校验 | `ping` | 最轻的探针 |
| 搜索 | `search3` | 只取 `songCount`,专辑/艺人走各自列表 |
| 专辑列表 | `getAlbumList2` | **唯一支持 `size`/`offset` 的专辑端点** |
| 专辑曲目 | `getAlbum` | 一次返回全部,本地分页 |
| 歌单 | `getPlaylists` / `getPlaylist` | 不传 `username`(Navidrome 未实现) |
| 单曲 | `getSong` | 队列恢复用 |
| 播放 | `stream` | 认证在查询串 |
| 封面 | `getCoverArt` | 认证在查询串(图片加载器不能设 header) |
| 歌词 | `getLyricsBySongId` → `getLyrics` | 前者是 OpenSubsonic 扩展,带时间轴 |

### 认证(官方规范)

```
u=用户名  s=随机盐(≥6位)  t=md5(password + salt)  v=1.16.1  c=Pomelo  f=json
```

- **盐必须每条请求重新生成**,不能会话级缓存
- 官方测试向量:`md5("sesame" + "c19b2d") = 26719a1196d2a940705a59634eb18eab`,
  已写成单测
- `apiKey=` 是 Navidrome 扩展,不在 Subsonic 官方文档里,按可选能力处理
- 错误是信封内的**数字码**(40=密码错、50=无权限、70=找不到),HTTP 常为 200,
  必须解信封判断

### 两家不可忽略的差异

| | Subsonic | Navidrome |
| --- | --- | --- |
| `getArtists` 分页 | ❌ 只接受 `musicFolderId` | ❌ 同左 |
| 按目录浏览 | ✅ `getIndexes`/`getMusicDirectory` | ⚠️ 仅模拟树,无真实目录 |
| 视频 | ✅ `getVideos`/`hls` | ❌ 明确不实现 |
| 艺人/专辑简介 | ✅ | ⚠️ 依赖 Last.fm 集成 |
| 搜索语法 | Lucene 风格 | ⚠️ 仅简单自动补全 |
| ID | 字符串 schema,部分实现用数字 | **始终字符串**(MD5/UUID) |
| 播放计数 | `stream` 即计 | 必须 `scrobble?submission=true` |

因为差异,`capabilities.video` 统一为 `false`——不能因为 Subsonic 官方支持就
在两端开出行为不一致的入口。

## 3. Songloft API 映射

基础路径 `/api/v1`，无统一响应信封：

| 能力 | 请求 | 响应 |
| --- | --- | --- |
| 登录 | `POST /auth/login` `{username,password}` | `{access_token,refresh_token,expires_in,token_type}` |
| 刷新 | `POST /auth/refresh` `{refresh_token}` | 同上 |
| 搜索/列表 | `GET /songs?keyword&limit&offset&sort&order&type` | `{songs,total}` |
| 单曲 | `GET /songs/{id}` | `Song` |
| 歌单 | `GET /playlists?limit&offset` | `{playlists,total}` |
| 歌单歌曲 | `GET /playlists/{id}/songs?limit&offset` | `{songs,total}` |
| 分面（专辑/歌手/流派/年代…） | `GET /songs/facets?field=album&keyword&limit&offset` | `{facets,total}` |
| 分面下歌曲 | `GET /songs?album=<专辑名>&limit&offset` | `{songs,total}` |
| 分面封面 | facet 的 `cover_url`（列表已直接返回） | 图片 |
| 播放 | `song.url`（通常是 `/songs/{id}/play`） | 音频流 |
| 封面 | `song.cover_url`（通常是 `/songs/{id}/cover`） | 图片 |
| 歌词 | `song.lyric_url`（通常是 `/songs/{id}/lyric`） | `{lyric,tlyric,rlyric,lxlyric}` |

分面条目字段：`value/count/cover_url`(三者之外后端不返回任何字段)。

**在 Songloft 里,专辑不是资源,是分面维度**——这是最容易踩错的一点。后端
**没有** `/albums` 端点(参考实现 `songloft-player-lynx` 全仓无此路径);专辑的
列表来自 `/songs/facets?field=album`,详情用 `/songs?album=<专辑名>` 筛选。

**但这属于本 provider 的内部适配,不是 SDK 契约。** `ProviderAlbum.id` 必须保留:
多数曲库后端(Subsonic/Jellyfin/Plex)的专辑是真实资源、有 ID,不能因为 Songloft
没有,就让整个 SDK 收窄。分层是:

| 层 | 职责 |
| --- | --- |
| `provider-sdk` | 只定义通用形状:`id/name/artist?/year?/trackCount?/artwork?` |
| `provider-songloft` | 内部把分面的 `value` 填进 `id`,并在 `albumTracks()` 里反查 |

具体到 Songloft 实现:

- `albums()` 用专辑名同时填 `id` 与 `name`(自然键适配,仅限本 provider);
- 后端不返回 `artist`/`year`,这两个字段留空即可,不要伪造;
- 不要拼 `/albums/{id}/cover` 之类的路径,封面用列表返回的 `cover_url`;
- 同一套 `/songs/facets` 可支撑 artist/genre/year/decade/language/style
  六个维度,新增维度只是换 `field`。

**专辑是可选能力**：`capabilities.albums` + `albums()` 同时存在才展示。服务端没有
该接口时首页静默隐藏专辑架(不报错、不做客户端聚合——按 `track.album` 去重只能
覆盖已加载范围,得到的"专辑"不完整)。`scripts/__tests__/ui-contract.node-test.mjs`
有守护断言,禁止 provider 再请求 `/albums*`。

Songloft 的 `Song` 关键字段：`id/title/artist/album/duration/cover_url/
lyric_url/url/is_video/is_live/type/format`。

- 访问 token 放在播放请求头 `Authorization: Bearer ...`，避免 token 出现在
  播放页展示的 URL 中；Bearer 只发给与服务器同源的地址，外链歌词等第三方
  URL 不带鉴权头。
- 封面交给系统图片加载器，不能设置请求头，因此使用
  `?access_token=...&w=512`。
- `lyric` 是 LRC，上层用 `parseLrc()` 转成原生时序行；翻译/罗马音/逐字歌词
  当前只透传，不渲染。

## 4. 会话与安全

- `access_token` 约 7 天，`refresh_token` 约 30 天。
- 登录成功后会话 JSON 写入 `PomeloStorage.secure`：
  `pomelo.provider.songloft.session.v1`。
- **密码不落盘**；只用于登录换取 token。
- 401 时单飞刷新一次并重放原请求；刷新失败会清除本地会话。
- 网络/超时不销毁 refresh token，下次请求仍可重试。
- `redactProviderText()` 统一脱敏 `access_token`、`refresh_token`、
  `Bearer ...`、`sl_pat_*` 与 JWT；错误提示和日志不得输出原始 token。
- 服务器地址必须是 `http(s)://`，拒绝带凭据的 URL；支持反向代理路径，
  会自动去掉误粘贴的 `/api/v1`。

## 5. 播放接入

```text
ProviderTrack
  -> provider.stream()      URL + Authorization headers
  -> provider.artwork()     ?access_token= 封面
  -> MediaTrack
  -> playMediaTrack() / appendMediaTracks()
```

- 单曲点击：解析流/封面 -> 开播 -> 异步拉歌词；歌词失败不影响播放。
- 歌单「播放全部」：首曲开播，其余追加。
- 原生每次切歌发 `track` 事件，JS 只对当前曲目懒加载歌词；旧请求用序号丢弃，
  不会覆盖新曲目。
- 原生队列保留每项的 `headers`，因此 Songloft 的 Bearer 可以随队列项切换。
- `ProviderTrack -> MediaTrack` 会附带 `resolve()` 闭包：原生播放中遇到
  401/403 时发 `refresh_required`，JS 先 `provider.refresh()` 强制换 token，
  再 `provider.stream()` / `provider.artwork()` 取新 URL、headers 和封面；
  原生从原位置重载，不需要重新入队。

## 6. 页面

首页是音乐库；「设置 → 媒体 → 播放设置」控制队列上限(20–500,默认 200)
和每页歌曲数(10–200,默认 50)。首页/音乐源页的最近添加、歌单和搜索结果
都按每页歌曲数分页。


- 未连接时引导到 `/settings/sources`；
- 已连接时显示问候、搜索、最近添加/歌单横向封面卡片架、歌曲列表；
- 最近添加用 `sort=added_at&order=desc`；歌单封面走 `playlistArtwork`；
- 歌曲/歌单都支持「加载更多」；
- 点歌曲播放，行尾「加入」只入队。

设置页「媒体 → 音乐源」仍保留连接/浏览/诊断入口：服务器地址、用户名、密码、
歌单、搜索，以及「播放全部」「全部加入队列」。两处页面都使用
`SettingsSubPage` / `SettingsGroup` / `ListRow` / `TextField` / `Button` /
`Hint`，没有新增自定义控件样式。

## 7. 当前限制

- 已接入 Songloft、Navidrome、Subsonic（后两者共用一套 Subsonic REST 实现）。
- 音乐源在「设置 → 音乐源」选择，选择持久化在 prefs 的 `active_provider`。
- 首页/音乐源页使用「加载更多」分页，不做滚动触底自动加载。
- 队列恢复依赖 Provider `getTrack`；非 Provider 裸 URL 恢复后没有刷新闭包。
- 持久化队列存放在 secure，原样保存 URL、headers、artwork；冷启动恢复后
  通常可以直接播放，token 失效时仍走 401 刷新重新取流。
- 视频歌曲只按音频流处理（`video:false`），视频 Surface/MPV 仍在计划中。
- Provider 曲目在播放中遇到 401/403 会自动回问 JS 刷新 token；非 Provider
  的裸 URL 没有 `resolve` 闭包，仍会直接报错。
- 原生只在 HTTP 错误日志明确给出 401/403 时触发刷新；若服务器用 200 返回
  错误页或重定向到登录页，需要后续补充内容类型/重定向检测。
- Web 端受浏览器 CORS 限制；Songloft 需要允许应用来源，原生端不受此限制。
- External Bundle 动态加载 Provider 尚未接入，当前 Provider 随主 bundle 打包。

## 8. 验证

```bash
pnpm exec rstest run src/core/providers/__tests__/songloft.test.ts
pnpm typecheck
pnpm test
pnpm build
```

单测覆盖：URL 归一化、分页映射、Bearer 注入、401 刷新重放、secure 会话恢复/
登出、错误脱敏。真机播放与锁屏仍以 iOS CI/设备验证为准。
