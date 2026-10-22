# E2E 测试套件

对 Lynx 页面做自动化验证,包含三类能力:

| 能力 | 入口 | 回答的问题 |
|---|---|---|
| 场景断言 | `pnpm e2e:web` / `pnpm e2e:native` | 功能对不对 |
| 跨端对齐 | `pnpm e2e:collect` + `pnpm e2e:diff` | 两端渲染是否一致 |
| Web 端诊断 | `node e2e/web-check.mjs` | 页面为什么没渲染出来 |

设计参考 [songloft-player-lynx](https://github.com/songloft-org/songloft-player-lynx)
的 `e2e/` 目录:平台差异收敛到 driver 层,scenario 只面向抽象接口。

## 快速开始

```bash
pnpm build        # 先出产物,E2E 跑的是 dist/ 里的真实文件
pnpm e2e:web      # 浏览器端
pnpm e2e:native   # 真机端(需设备已连接,且自建宿主或 LynxExplorer 已打开页面)
```

`e2e:web` 会自动起一个静态服务伺服 `dist/`,不需要另开 `rspeedy preview`。
跑完会写一份 Markdown 报告到 `results/e2e/report.md`。

## 目录

```
e2e/
  driver/
    types.ts           E2EDriver / E2EElement 接口抽象
    index.ts           createDriver():按 E2E_PLATFORM 分发
    web.driver.ts      playwright 驱动(浏览器里的 lynx-view)
    native.driver.ts   agent-lynx CLI 驱动(真机 LynxExplorer)
    browser.mjs        共享的浏览器启动与错误收集(容器 root 沙箱、worker console)
    static-server.ts   E2E 内置静态服务(带 COOP/COEP)
    snapshot-parse.ts  agent-lynx 输出解析纯函数(可单测)
  scenarios/
    *.scenario.ts      场景化用例
  alignment/
    collect.sh         真机采集(snapshot / 样式 / 截图)
    diff.py            两端几何数值比对,输出 PASS/FAIL
  reporter/
    markdown-reporter.ts  输出 results/e2e/report.md
  web-check.mjs        Web 端诊断命令
  __tests__/           纯函数的单元测试
```

## Web 端诊断

页面渲染不出来时先用它,比 E2E 的失败信息更直接:

```bash
pnpm build
npx rspeedy preview                        # http://localhost:3000/index.html
node e2e/web-check.mjs                     # 默认检查 http://localhost:3000/index.html
```

| 选项 | 作用 |
|---|---|
| `--net` | 额外报告被当 `text/html` 伺服的 `.js`(打包器没解析的裸模块说明符) |
| `--deep` | 额外 dump `lynx-view` 的 shadow DOM 状态 |
| `--out=PREFIX` | 截图文件名前缀(默认 `web`) |
| `--wait=MS` | 加载后额外等待毫秒数(默认 3000) |

输出为 JSON:是否渲染出 `lynx-view`、控制台错误列表(含后台 worker)、截图路径。

> 探针页故意指向一个不存在的图片域名(`lynx.cdn.example`)来验证图片降级路径,
> 因此 `ERR_NAME_NOT_RESOLVED` 是预期输出,不是故障。

## driver 抽象

scenario 只依赖 `E2EDriver` 接口,不感知平台:

| 能力 | 说明 |
|---|---|
| `launch()` / `teardown()` | 生命周期 |
| `open(bundle)` | 加载指定 bundle(驱动内部翻译成各平台需要的形式) |
| `query(testId)` / `queryAll(testId)` | 按 `data-testid` 定位节点 |
| `getConsoleErrors()` | 控制台错误(已滤掉预期错误) |
| `waitFor()` / `sleep()` / `screenshot()` | 工具方法 |

元素对象提供 `tap()` / `getText()` / `isVisible()` / `getAttribute()` / `getRect()`。

## 新增一个 scenario

1. 在 `src/probe/Probe.tsx` 里加节点,并带 `data-testid="probe-xxx"`
2. 在 `e2e/scenarios/` 下新建 `<主题>.scenario.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from '@rstest/core';
import { createDriver, type E2EDriver } from '../driver/index.js';

describe('我的主题', () => {
  let driver: E2EDriver;

  beforeAll(async () => {
    driver = await createDriver();
    await driver.launch();
    await driver.open(process.env.E2E_BUNDLE ?? 'probe.web.bundle');
  });

  afterAll(async () => {
    await driver.teardown();
  });

  test('断言', async () => {
    const rect = await driver.query('probe-xxx').then((el) => el.getRect());
    expect(rect.width).toBeCloseTo(100, 1);
  });
});
```

几何断言用 `toBeCloseTo`:flex 分配会带小数舍入。

## 新增一个平台

在 `e2e/driver/` 下实现 `E2EDriver` 接口,然后在 `driver/index.ts` 的
`createDriver()` 里加一个 `case`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `E2E_PLATFORM` | `web` | `web` 或 `native` |
| `E2E_BUNDLE` | `probe.web.bundle` | 要加载的 bundle 文件名 |
| `E2E_BASE_URL` | 自动起静态服务 | 指定已运行的 Web 服务地址 |
| `E2E_DIST_ROOT` | `dist` | 静态服务伺服目录 |
| `E2E_CLIENT_ID` | 自动发现 | native 端指定的 DevTool client id |
| `CHROME_PATH` | `/opt/google/chrome/chrome` | web 端 Chrome 路径 |

## 当前限制

- `native.driver.ts` 尚未在真机上验证过(当前开发环境没有连设备),
  接入设备后需核对 `agent-lynx snapshot --json` 的信封结构与
  `list-clients` 的字段名。信封与样式的解析已抽出为纯函数
  (`driver/snapshot-parse.ts`)并有单测覆盖,CLI 输出形状变化时先改那里。
- native 端没有独立的 `get attribute` 命令(`agent-lynx get` 只有 `text`
  与 `style`),属性值从 snapshot 节点里读,读不到时返回 `null`。
- 场景默认跑在 `probe` 页;`main` 页没有 `data-testid`,要断言它需先补标记。

## 跨端对齐

比对**两个端**的几何渲染(Android 真机 vs macOS 桌面),与场景断言互补。
详见 [alignment/README.md](alignment/README.md)。
