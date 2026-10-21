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

- `pnpm dev` - 启动开发服务器

- `pnpm build` - 构建生产版本

- `pnpm preview` - 本地预览生产构建

- `pnpm test` - 使用 Rstest 运行测试

- `pnpm add <pkg>` / `pnpm add -D <pkg>` - 安装依赖

## 相关文档

- Rsbuild: <https://rsbuild.rs/llms.txt>

- Rspack: <https://rspack.rs/llms.txt>

## 工具

### Biome

- 运行 `pnpm run check` 进行代码检查
- 运行 `pnpm run format` 格式化代码
