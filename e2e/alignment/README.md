# 跨端对齐(e2e/alignment)

把**两个端**各采一份快照,逐节点比对几何数值,回答「同一份代码在 Android 与
macOS 上渲染是否一致」。

> 与 `../scenarios/` 的分工:scenario 是**对单个端做断言**(功能对不对),
> 这里是对**两个端做比对**(渲染是否一致)。两者互补,不能互相替代。

## 组成

| 文件 | 作用 |
|---|---|
| `../../src/probe/` | 探针页面:覆盖线性布局、文本、定位、边框、交互/状态的固定尺寸用例,节点带 `data-testid` |
| `collect.sh` | 在已连接设备上用 `agent-lynx` 采集 snapshot / 样式 / 截图 |
| `diff.py` | 对比两端 snapshot 的几何数值,输出 PASS/FAIL 报告 |

## 流程

1. 构建:`pnpm build:lynx`(产物 `dist/probe.lynx.bundle`)
2. 手机上用自建宿主(`--ez bundle_probe true` / `--bundle probe`)或 LynxExplorer 加载 probe bundle
3. 采集(每端各跑一次,不同 label):
   ```bash
   pnpm e2e:collect android-nova7
   pnpm e2e:collect macos
   ```
4. 对比:
   ```bash
   pnpm e2e:diff results/android-nova7 results/macos --tolerance 2
   ```

产物落在 `results/<label>/`,含 `clients.json` / `snapshot.json` / `styles.txt` /
`screen.jpeg`。`results/` 已 git 忽略。

## 前置条件

- adb 可用;容器内远程 adb:`ADB_SERVER_HOST=<宿主机IP> pnpm e2e:collect ...`
- `agent-lynx` 已安装(npm devDependency),手机已打开自建宿主或 Explorer 并加载页面

## 已知注意

- `diff.py` 的 snapshot 字段名(`layout`/`bounds`)以 agent-lynx 实际输出为准,
  第一次接到真机后先用 `agent-lynx snapshot --json` 核对字段再跑 diff。
  注意 `snapshot --json` 返回的是**命令结果信封**,节点树在其内部字段中
  (E2E 侧已按此处理,见 `../driver/snapshot-parse.ts`)。
- 华为 nova 7(HarmonyOS 4.2,底座 Android 10)不支持无线配对,需 USB 执行
  一次 `adb tcpip 5555` 后改为无线连接;手机重启后失效需重插 USB。
