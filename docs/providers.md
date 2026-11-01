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
search(query, { limit, offset })
playlists({ limit, offset })
playlistTracks(playlistId, { limit, offset })
stream(track): Promise<{ url, headers? }>
lyrics(track): Promise<{ lrc?, translated?, romaji?, wordByWord? } | null>
artwork(track, size?): Promise<string | null>
```

`ProviderTrack` 只暴露展示字段和可选的 `resource`（stream/artwork/lyrics
定位符）。服务端专有字段不进入播放页。

## 3. Songloft API 映射

基础路径 `/api/v1`，无统一响应信封：

| 能力 | 请求 | 响应 |
| --- | --- | --- |
| 登录 | `POST /auth/login` `{username,password}` | `{access_token,refresh_token,expires_in,token_type}` |
| 刷新 | `POST /auth/refresh` `{refresh_token}` | 同上 |
| 搜索/列表 | `GET /songs?keyword&limit&offset` | `{songs,total}` |
| 歌单 | `GET /playlists?limit&offset` | `{playlists,total}` |
| 歌单歌曲 | `GET /playlists/{id}/songs?limit&offset` | `{songs,total}` |
| 播放 | `song.url`（通常是 `/songs/{id}/play`） | 音频流 |
| 封面 | `song.cover_url`（通常是 `/songs/{id}/cover`） | 图片 |
| 歌词 | `song.lyric_url`（通常是 `/songs/{id}/lyric`） | `{lyric,tlyric,rlyric,lxlyric}` |

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
- 歌单「播放全部」：首曲开播，其余追加；只为首曲拉歌词，避免一次发几百个
  歌词请求。
- 歌词响应晚于切歌时，仅当前 URL 仍匹配才写入，避免覆盖新曲目。
- 原生队列保留每项的 `headers`，因此 Songloft 的 Bearer 可以随队列项切换。
- `ProviderTrack -> MediaTrack` 会附带 `resolve()` 闭包：原生播放中遇到
  401/403 时发 `refresh_required`，JS 先 `provider.refresh()` 强制换 token，
  再 `provider.stream()` 取新 URL/headers；原生从原位置重载，不需要重新入队。

## 6. 页面

设置页「媒体 → 音乐源」进入 `/settings/sources`：

- 服务器地址、用户名、密码；连接后自动加载前 50 个歌单。
- 点歌单加载前 200 首；点歌曲播放，行尾「加入」只入队。
- 「播放全部」「全部加入队列」。
- 搜索关键词返回前 50 首。
- 使用 `SettingsSubPage` / `SettingsGroup` / `ListRow` / `TextField` /
  `Button` / `Hint`，没有新增自定义控件样式。

## 7. 当前限制

- 只实现 Songloft；Navidrome/Subsonic 尚未接入。
- 歌单/搜索没有无限滚动，固定取第一页。
- 批量播放只为第一首拉歌词；后续切歌不会自动加载对应歌词。
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
