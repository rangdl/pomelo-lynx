# 版本、发布与更新

本文记录 pomelo-lynx 的版本语义、分支/tag 流程、Release 资产、changelog 和
客户端更新检查。**Bundle 热更新与 native 客户端更新是两条独立链路**,不要混用
`version.json` 和 `client.json`。

## 1. 版本语义

`package.json` 的 `version` 是唯一规范版本,始终为 `X.Y.Z`。

| 字段 | 示例 | 说明 |
|---|---|---|
| `package_version` | `0.0.3` | `package.json` 版本 |
| `native_version` | `0.0.3` | 宿主原生版本,必须是 semver |
| `build_number` | `125` | CI `GITHUB_RUN_NUMBER`,单调递增 |
| `channel` | `stable` / `dev` | 发布通道 |
| `release_tag` | `v0.0.3` / `dev` | 实际 GitHub Release tag |
| `build_tag` | `dev-v0.0.3-abc1234` | dev 构建 tag,仅用于追踪 |

展示版本由客户端计算:

```text
stable: 0.0.3 (125)
dev:    dev-0.0.3 (125)
```

**不要**把 `dev-` 写进 `package.json`、`native_version`、iOS
`MARKETING_VERSION` 或 Android `versionName`。这些字段和现有 manifest 校验都
按 semver 处理。

iOS `CFBundleVersion` 在 CI 中由 `CURRENT_PROJECT_VERSION=${GITHUB_RUN_NUMBER}`
覆盖;`MARKETING_VERSION` 保持规范版本。`CFBundleShortVersionString` 仍然是
semver,dev 前缀只在 App 的关于页展示。Android 的 `hostBuild/hostChannel`
注入属于待恢复 Android 构建后的计划,当前 Android 先回退到 bundle 身份。

## 2. 分支与 tag

```text
dev 分支:日常开发
master  :只接收 dev 合并和 hotfix
```

| 类型 | 示例 | 要求 |
|---|---|---|
| 正式版 | `v0.0.3` | 必须在 `master`,且等于 `v${package.version}` |
| dev 构建 | `dev-v0.0.3-abc1234` | 必须在 `dev`,版本部分等于 `package.version` |
| 滚动 dev Release | `dev` | 由 CI 自动维护,不手工打 |

典型流程:

```text
v0.0.3 发布后,dev 分支把 package.json bump 到 0.0.4
  ↓
dev 分支打 dev-v0.0.4-<shortsha> 触发 dev 构建
  ↓
dev 合并 master
  ↓
master 打 v0.0.4 触发正式发布
```

dev tag 必须唯一(短 SHA 或 run number 后缀);不要重复使用同一个 dev tag。
CI 只认 `v*` 和 `dev-*` tag,分支 push 不再自动构建。

## 3. Release 资产

正式版和滚动 dev Release 都使用固定文件名:

```text
pomelo-lynx-ios-nosign.ipa
client.json
version.json
version.json.sig
pomelo-lynx-main.lynx.bundle
checksums.txt
```

- `version.json` / `.sig` / `bundle`:Bundle 热更新签名契约,**不要**把
  `client.json` 塞进 `version.json.assets`。
- `client.json`:native 客户端更新元数据,包含 IPA 的 size/sha256 和 changelog。
- `checksums.txt`:包含 IPA、`client.json`、`version.json`、签名和 bundle。

稳定版下载地址:

```text
https://github.com/rangdl/pomelo-lynx/releases/latest/download/pomelo-lynx-ios-nosign.ipa
```

dev 滚动地址:

```text
https://github.com/rangdl/pomelo-lynx/releases/download/dev/pomelo-lynx-ios-nosign.ipa
```

历史正式版仍可通过 tag 路径访问,例如
`/releases/download/v0.0.3/pomelo-lynx-ios-nosign.ipa`。

## 4. `client.json`

```json
{
  "schema": 1,
  "channel": "stable",
  "version": "0.0.3",
  "display_version": "0.0.3",
  "build_number": 125,
  "git_commit": "abcdef0",
  "build_time": "2026-10-30T00:00:00.000Z",
  "release_tag": "v0.0.3",
  "build_tag": "v0.0.3",
  "changes": ["新增：客户端更新检查"],
  "assets": [
    {
      "platform": "ios",
      "name": "pomelo-lynx-ios-nosign.ipa",
      "size": 12345678,
      "sha256": "..."
    }
  ]
}
```

dev 的 `release_tag` 仍然是 `dev`,`display_version` 是 `dev-0.0.3`,
`build_tag` 记录具体 dev tag。

App 通过 GitHub Release API 获取资产,校验通道、tag、资产名、大小、sha256 和
下载 URL 后再展示更新。`client.json` 里的 URL 不作为可信重定向来源。
「加速设置」开启时,Release API 和 `client.json` 请求都会带代理前缀;
代理失败会回退同一地址的直连请求。

## 5. Changelog

`scripts/generate-changelog.mjs` 从 conventional commit 生成:

- GitHub Release 用 `release-notes.md`;
- App 用 `changes.json`,最终写进 `client.json.changes`。

按 `feat/fix/perf/refactor/docs/...` 分组,跳过 merge commit 和
`chore(release)`。App 只显示前 8 条,完整记录通过“打开发布页”查看。

正式版范围是上一个 `v*` tag 到当前 tag;dev 优先从上一次滚动 dev 构建的
target 到现在,找不到时回退到上一个正式 tag。正式合并建议使用 merge commit;
squash 合并会把逐条提交压成一条,changelog 会明显变少。

## 6. 客户端更新 UI

关于页拆成三个分组:

```text
加速设置
  使用代理更新开关
  代理地址输入
  恢复默认地址

客户端更新
  检查客户端更新
  有新版本 / 已是最新 / 无法确定
  更新内容
  打开下载地址
  用 TrollStore 安装
  打开发布页

Bundle 热更新
  通道
  自动检查更新
  检查更新
  下载更新 / 取消 / 待生效 / 恢复内置
```

「加速设置」默认开启,地址默认 `https://gh-proxy.org`,也可以输入自定义
`https://` 代理。开启后 Release API、`version.json`、`version.json.sig`、
`client.json`、Bundle 下载和 IPA 加速统一走该前缀;关闭后全部直连 GitHub。
地址必须是 HTTPS,且不能带凭据或查询串。

iOS 点击下载只会打开系统浏览器,IPA 保存到“文件”,**不能直接安装**;需要
TrollStore 或自行重签。下载地址下方还提供「用 TrollStore 安装」,使用
`apple-magnifier://install?url=...` 交给 TrollStore;设备需安装 TrollStore
并在其设置里启用 URL Scheme。加速下载使用「加速设置」里的代理地址;它只是
第三方传输加速,关闭代理后必须保留 GitHub 原始地址下载。

## 7. 本地命令

```bash
pnpm test                 # 单测 + 脚本契约测试
pnpm run typecheck
pnpm run lint
pnpm run check:ios        # Swift 源码契约
pnpm run build            # JS 双端构建
pnpm run e2e:web          # Web 端 E2E
```

正式版 tag、dev tag 和 Release 上传由 GitHub Actions
`.github/workflows/build-hosts.yml` 完成。iOS 编译只能在 CI/真机验证,
本地 Linux 不能替代。
