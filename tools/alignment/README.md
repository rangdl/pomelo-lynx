# 对齐验证工具(tools/alignment)

跨端(Explorer)对齐验证的探针页面与采集脚本。

## 组成

| 文件 | 作用 |
|---|---|
| `../../src/probe/` | 探针页面:覆盖线性布局、文本、定位、边框、交互/状态的固定尺寸用例,节点带 `data-testid` |
| `collect.sh` | 在已连接设备上用 `agent-lynx` 采集 snapshot / 样式 / 截图 |
| `diff.py` | 对比两端 snapshot 的几何数值,输出 PASS/FAIL 报告 |

## 流程

1. 构建:`npx rspeedy build`(产物 `dist/probe.lynx.bundle`)
2. 手机 Explorer 加载 probe bundle(扫码或本地)
3. 采集(每端各跑一次,不同 label):
   ```bash
   ./collect.sh android-nova7
   ./collect.sh macos
   ```
4. 对比:
   ```bash
   python3 diff.py results/android-nova7 results/macos --tolerance 2
   ```

## 前置条件

- adb 可用;容器内远程 adb:`ADB_SERVER_HOST=<宿主机IP> collect.sh ...`
- `agent-lynx` 已安装(npm devDependency),手机已打开 Explorer 并加载页面

## 已知注意

- `diff.py` 的 snapshot 字段名(`layout`/`bounds`)以 agent-lynx 实际输出为准,
  第一次接到真机后先用 `agent-lynx snapshot --json` 核对字段再跑 diff。
- 华为 nova 7(HarmonyOS 4.2,底座 Android 10)不支持无线配对,需 USB 执行
  一次 `adb tcpip 5555` 后改为无线连接;手机重启后失效需重插 USB。
