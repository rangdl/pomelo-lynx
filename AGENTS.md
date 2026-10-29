# AGENTS.md

你是 TypeScript、Rspeedy 和 Lynx 应用开发专家,编写可维护、高性能、可访问的代码。

## 预读文档

提前阅读以下文档,以理解本项目依赖的库和框架。

- Lynx: [llms.txt](https://lynxjs.org/next/llms.txt),**必读**。
  处理 Lynx 相关任务时,agent **必须**阅读此文档,它是所有 Lynx 相关文档的入口。

## 项目技能

本项目在 `.agents/skills/` 目录下安装了社区技能(见 `skills-lock.json`)。这些技能**不会**被大多数 agent 工具自动发现——做 Lynx 相关工作前,务必检查该目录并阅读相关的 `SKILL.md`。重点技能:

- `lynx-api-docs` — 编写或修改任何 Lynx 代码前**必须**先查阅(元素、CSS、布局);比上面的 llms.txt 更具体。
- `reactlynx-best-practices` — 双线程最佳实践(`background only`、`useLayoutEffect` 等);编写 ReactLynx 组件时适用。
- `lynx-check-css-support` — 按渲染后端/版本查证 CSS 属性支持情况;切勿凭浏览器经验推断。
- `lynx-devtool` — 通过 `agent-lynx` CLI 调试真机上的应用。
- `rspeedy-bundle-size` — 分析和减小包体积。

## 命令

本项目使用 **pnpm** 管理依赖(锁文件为 `pnpm-lock.yaml`,勿提交 npm 的 `package-lock.json`)。

- `pnpm dev` - 启动开发服务器(终端出 QR 供 LynxExplorer 扫码;Web 预览在 `/__web_preview?casename=probe.web.bundle`)

- `pnpm build` - 构建生产版本(原生 + Web 双环境,并校验产物完整性)

- `pnpm build:host` - 构建 JS 产物并拷入宿主 app(`host/android` assets 与 `host/ios/PomeloLynx`),同时生成 `.build/native-host.json`

- `pnpm build:lynx` / `pnpm build:web` - 只构建单个环境

- `pnpm web:dev` - 预览生产产物(`http://localhost:3000/index.html`)

- `pnpm test` - 使用 Rstest 运行单元测试

- `pnpm e2e:web` - 场景化 E2E(浏览器端,自动起静态服务伺服 `dist/`)

- `pnpm e2e:native` - 场景化 E2E(真机端,需设备已连接且 Explorer 已打开页面)

- `pnpm verify:web` - 一键回归:`build` + `e2e:web`

- `pnpm typecheck` - `tsc -b` 全量类型检查

- `pnpm add <pkg>` / `pnpm add -D <pkg>` - 安装依赖

## 相关文档

- Rsbuild: <https://rsbuild.rs/llms.txt>

- Rspack: <https://rspack.rs/llms.txt>

- 项目内: [Web 端调试](docs/web-debug.md)(症状 → 根因 → 解法) · [E2E 套件](e2e/README.md) · [跨端对齐](e2e/alignment/README.md)

## 工具

### Agent 行为约束(2026-10 复盘,违反过一次,最高优先级)

- **不得过滤/隐藏构建日志、错误输出、命令输出**。想让输出变"干净"只能通过修复根因实现;
  第三方依赖的告警噪音,通过其自身的构建配置(如 pod 的 `-w`)抑制,而不是 grep 掉日志行。
- **遇到规则冲突、需求歧义、无法本地验证的情况,必须停下来向用户明说并询问**,不得静默裁决。
  典型场景:两条指令打架、本地无法验证的平台(iOS/真机)、交付方式存在多种合理选择。
- **未经验证不得称"完成"/"就位"**。本地验证不了的(iOS 构建、真机链路),必须声明"仅在 CI 验证过/
  待真机验证";没有测试覆盖的代码,不写"就位"。
- **失败先查明再动手**。CI 失败时先拿到确切的错误输出(必要时加大错误摘要产物),禁止凭猜测重跑;
  禁止用 rerun 碰运气。
- **长任务保持进度可见**。超过 1 分钟的等待/轮询,说明在等什么、预期多久,不得静默 sleep 阻塞。
- **注释语言**:新增或修改的注释一律用中文;移植自其它仓库的注释保持原文语言,不做翻译。

### iOS 原生改动(Linux 本地无法编译)

- 提交前跑 `pnpm run check:ios`;它也会随 `pnpm test` 自动执行,在 CI 的 prepare job
  就失败,不必等 macOS runner。
- 已知 Swift/ObjC 桥接陷阱:
  - `LynxViewLifecycle` 的可选回调必须与协议签名一致,并显式写 `@objc(selector)`;
    `didRecieveError` 的参数是 `Error`,写成 `NSError` 只会得到 nearly-matches 告警,
    回调根本不会执行。
  - `(Any) -> Void` 回调成功时传 `NSNull()`,不能传 `nil`。
  - 运行期会重新赋值(如回退)的启动状态用 `var`,不能用 `let`。
  - `@escaping` 与 IUO `!` 不能叠加;部署目标 iOS 15,使用新 API 前核对可用性。
  - 新增模块必须同步 `ViewController.buildConfig`、`project.pbxproj`
    (PBXFileReference / PBXBuildFile / Sources) 与 TS facade。
- 本地只能验证 JS;iOS 编译与行为以 CI 的 `iOS IPA` job 为准,通过前不得称"完成"。

### Biome

- 运行 `pnpm run check` 进行代码检查
- 运行 `pnpm run lint` 做只读检查(CI 同款,告警也会失败)
- 运行 `pnpm run format` 格式化代码
- `biome.json` 已排除 `.agents/`(第三方技能文件,不可格式化)

### 浏览器自动化

- 交互式排查用 **Playwright MCP**(容器内已配好 `--no-sandbox`)
- 回归与 CI 用 `e2e/web-check.mjs` 与 `e2e/`(自带
  `chromiumSandbox: false`,不依赖 MCP)
