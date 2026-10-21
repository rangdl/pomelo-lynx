#!/usr/bin/env python3
"""对齐 diff:比较两台设备(端)采集的 snapshot 几何与样式。

用法:
  python3 diff.py results/android-nova7 results/macos [--tolerance 2]

输入:各目录下的 snapshot.json(agent-lynx snapshot --json 的输出)
输出:逐节点的几何差异报告,超出容差的项标记 FAIL。
"""
import argparse
import json
import sys
from pathlib import Path

# 需要比对的节点(data-testid 前缀)与对应数值字段
TARGETS = [
    "probe-row", "probe-row-a", "probe-row-b", "probe-row-c",
    "probe-column", "probe-col-a", "probe-col-b",
    "probe-text", "probe-position", "probe-pos-abs", "probe-pos-rel",
    "probe-border", "probe-count", "probe-toggle-box",
]
FIELDS = ["width", "height", "left", "top"]


def flatten(node, out):
    """递归收集 snapshot 中带 data-testid 的节点。"""
    if isinstance(node, dict):
        testid = node.get("testid") or node.get("data-testid")
        if testid:
            out.setdefault(testid, []).append(node)
        for v in node.values():
            flatten(v, out)
    elif isinstance(node, list):
        for i in node:
            flatten(i, out)
    return out


def geometry(node):
    """从节点中提取数值几何信息,字段名以实际 snapshot 输出为准。"""
    layout = node.get("layout") or node.get("bounds") or node
    return {f: layout.get(f) for f in FIELDS if layout.get(f) is not None}


def load(path: Path):
    data = json.loads(path.read_text())
    nodes = {}
    flatten(data, nodes)
    return {t: geometry(v[0]) for t, v in nodes.items() if t in TARGETS and v}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base_dir")
    ap.add_argument("compare_dir")
    ap.add_argument("--tolerance", type=float, default=2.0, help="像素容差")
    args = ap.parse_args()

    a = load(Path(args.base_dir) / "snapshot.json")
    b = load(Path(args.compare_dir) / "snapshot.json")

    fails = 0
    for tid in TARGETS:
        ga, gb = a.get(tid), b.get(tid)
        if ga is None or gb is None:
            print(f"SKIP  {tid:<22} 缺失于 {args.base_dir if ga is None else args.compare_dir}")
            continue
        diffs = []
        for f in FIELDS:
            va, vb = ga.get(f), gb.get(f)
            if va is None or vb is None:
                continue
            d = abs(va - vb)
            if d > args.tolerance:
                diffs.append(f"{f}: {va} vs {vb} (Δ{d:.0f})")
        if diffs:
            fails += 1
            print(f"FAIL  {tid:<22} {'; '.join(diffs)}")
        else:
            print(f"PASS  {tid:<22}")

    print(f"\n结果: {len(TARGETS) - fails} PASS / {fails} FAIL (容差 {args.tolerance}px)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
