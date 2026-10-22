/**
 * Unit tests for the native driver's output parsing.
 *
 * The native driver itself needs a device, but its parsing rules do not —
 * and they are the part that breaks when the CLI's output shape changes.
 */

import { describe, expect, test } from '@rstest/core';

import {
  collectNodes,
  normalizeSnapshot,
  parseStyle,
  testIdOf,
} from '../driver/snapshot-parse';

describe('snapshot 解析', () => {
  test('裸节点树原样返回', () => {
    const tree = { ref: '@e1', testid: 'probe-btn-inc', children: [] };
    expect(normalizeSnapshot(tree)).toBe(tree);
  });

  test('剥离命令结果信封', () => {
    const tree = { ref: '@e1', testid: 'probe-btn-inc', children: [] };
    expect(normalizeSnapshot({ ok: true, data: tree })).toBe(tree);
    expect(normalizeSnapshot({ result: { data: tree } })).toBe(tree);
  });

  test('信封里是数组时包成 children', () => {
    const node = { ref: '@e1', testid: 'a' };
    expect(normalizeSnapshot([node])).toEqual({ children: [node] });
  });

  test('空输入返回空对象', () => {
    expect(normalizeSnapshot(undefined)).toEqual({});
  });

  test('testid 字段名兼容', () => {
    expect(testIdOf({ testid: 'a' })).toBe('a');
    expect(testIdOf({ testId: 'b' })).toBe('b');
    expect(testIdOf({ 'data-testid': 'c' })).toBe('c');
    expect(testIdOf({})).toBeUndefined();
  });

  test('按 testid 收集嵌套节点', () => {
    const tree = {
      children: [
        { ref: '@e1', testid: 'a' },
        {
          ref: '@e2',
          testid: 'b',
          children: [{ ref: '@e3', testid: 'probe-target' }],
        },
        { ref: '@e4', testid: 'probe-target' },
      ],
    };

    const found = collectNodes(tree, 'probe-target');
    expect(found.map((node) => node.ref)).toEqual(['@e3', '@e4']);
  });
});

describe('样式解析', () => {
  test('JSON 对象', () => {
    expect(parseStyle({ width: 100, height: '60', left: '20' })).toEqual({
      width: 100,
      height: 60,
      left: 20,
    });
  });

  test('文本 blob', () => {
    expect(parseStyle('width: 100px; height: 60px; left: 20px')).toEqual({
      width: 100,
      height: 60,
      left: 20,
    });
  });

  test('无法识别时返回空', () => {
    expect(parseStyle('not a style')).toEqual({});
    expect(parseStyle(undefined)).toEqual({});
  });
});
