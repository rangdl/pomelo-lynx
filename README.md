# pomelo-lynx

基于 [ReactLynx](https://lynxjs.org/react/) 的跨端项目,同一套代码构建
**原生端**(Android / iOS / HarmonyOS)与 **Web 端**(浏览器 `lynx-view`)。

- 构建工具:[Rspeedy](https://rspeedy.rs)(Rspack / Rsbuild)
- 框架:ReactLynx + TypeScript
- 代码检查:[Biome](https://biomejs.dev)

## 环境要求

- Node `^20.19 || >=22.12`
- pnpm

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发服务器:终端打印 QR 码供 LynxExplorer 扫码;Web 预览在 `/__web_preview?casename=probe.web.bundle` |
| `pnpm build` | 生产构建(原生 + Web 双环境),并校验产物完整性 |
| `pnpm build:lynx` | 只构建原生端 `*.lynx.bundle` |
| `pnpm build:web` | 只构建 Web 端 `*.web.bundle` + 壳页面 |
| `pnpm web:dev` | 预览生产产物:http://localhost:3000/index.html |
| `pnpm preview` | Rspeedy 内置预览 |
| `pnpm test` | 单元测试(Rstest) |
| `pnpm e2e:web` | Web 端场景化 E2E(自动起静态服务) |
| `pnpm e2e:native` | 真机端场景化 E2E |
| `pnpm verify:web` | 一键回归:`build` + `e2e:web` |
| `pnpm typecheck` | `tsc -b` 全量类型检查 |
| `pnpm run check` | Biome 检查并自动修复 |
| `pnpm run format` | Biome 格式化 |

## 目录结构

```
src/
  index.tsx          入口(main 环境)
  App.tsx            示例应用
  App.css
  lib/flappy.ts      与框架无关的小游戏物理引擎
  useFlappy.ts       对应的 React Hook
  probe/             跨端对齐探针页(节点带 data-testid)
  web-shell/         Web 端壳页面(import map + bundle 切换)
e2e/                场景化 E2E、跨端对齐与 Web 端诊断
scripts/            构建期脚本(assert-bundle-fresh:校验产物完整性)
docs/web-debug.md   Web 端调试:症状 → 根因 → 解法
```

## 两个 entry

| entry | 源文件 | 用途 |
|---|---|---|
| `main` | `src/index.tsx` | 示例应用 |
| `probe` | `src/probe/index.tsx` | 跨端对齐探针,专供 E2E 与真机采集 |

## 进一步阅读

- [Web 端调试](docs/web-debug.md)—— 常见故障与工具链约束
- [E2E 测试套件](e2e/README.md)—— driver 抽象与场景编写
- [跨端对齐](e2e/alignment/README.md)—— 真机采集与几何比对

---

本项目最初由 `@lynx-js/create-lynx` 引导创建。
