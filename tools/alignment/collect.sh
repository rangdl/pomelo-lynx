#!/usr/bin/env bash
# 对齐探针采集脚本:在已连接的设备上采集 probe 页面的结构化数据
#
# 前置条件:
#   1. 手机上已打开 Lynx Explorer 并加载 probe.lynx.bundle(扫码或本地加载)
#   2. adb 已连接(USB 或无线),或 ADB_SERVER_HOST 指向宿主机 adb server
#
# 用法:
#   ./collect.sh <label>          # label 如 android-nova7 / macos / web
#   ADB_SERVER_HOST=192.168.1.10 ./collect.sh android-nova7
#
# 产物:results/<label>/ 目录,含 snapshot、样式、截图
set -euo pipefail

LABEL="${1:?用法: collect.sh <label>}"
OUT="results/${LABEL}"
mkdir -p "$OUT"

echo "== [${LABEL}] 列出客户端 =="
agent-lynx clients --json | tee "$OUT/clients.json"

echo "== [${LABEL}] 元素树快照 =="
agent-lynx snapshot --json | tee "$OUT/snapshot.json"

echo "== [${LABEL}] 关键节点样式 =="
# 与 Probe.tsx 的 data-testid 对应;snapshot 输出中的 ref 需要人工/脚本映射
for NODE in probe-row probe-col-b probe-text probe-pos-abs probe-border probe-count; do
  echo "-- ${NODE} --" >> "$OUT/styles.txt"
  agent-lynx snapshot --json | python3 -c "
import json, sys
data = json.load(sys.stdin)
def walk(n):
    if isinstance(n, dict):
        if str(n.get('testid', '')).startswith('${NODE}'):
            print(n.get('ref'))
        for v in n.values():
            walk(v)
    elif isinstance(n, list):
        for i in n: walk(i)
walk(data)
" | while read -r ref; do
    [ -n "$ref" ] && agent-lynx get style "$ref" --property width,height,left,top,color,font-size,background-color
  done >> "$OUT/styles.txt" || true
done

echo "== [${LABEL}] 截图 =="
agent-lynx screenshot --annotate -o "$OUT/screen.jpeg" || true

echo "采集完成: $OUT/"
