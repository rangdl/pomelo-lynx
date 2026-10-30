import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildChangelog, parseCommit } from '../generate-changelog.mjs';

test('解析 conventional commit 并保留 scope', () => {
  assert.deepEqual(parseCommit('feat(settings): 增加客户端更新'), {
    type: 'feat',
    label: '新增',
    scope: 'settings',
    description: '增加客户端更新',
  });
  assert.deepEqual(parseCommit('随手改一下'), {
    type: 'other',
    label: '其他',
    scope: '',
    description: '随手改一下',
  });
});

test('按类型分组、跳过 merge 与版本提交、去重并限制 App 列表', () => {
  const result = buildChangelog(
    [
      { hash: 'aaaaaaa', subject: 'feat(settings): 增加客户端更新' },
      { hash: 'bbbbbbb', subject: 'fix(update): 修复下载链接' },
      { hash: 'ccccccc', subject: 'chore(release): 0.0.3' },
      { hash: 'ddddddd', subject: 'feat(settings): 增加客户端更新' },
      { hash: 'eeeeeee', subject: 'docs: 更新发布文档' },
      { hash: 'fffffff', subject: 'perf: 加速下载' },
    ],
    { max: 2 },
  );
  assert.deepEqual(result.changes, [
    '新增（settings）：增加客户端更新',
    '修复（update）：修复下载链接',
  ]);
  assert.match(result.notes, /### 新增/);
  assert.match(result.notes, /### 修复/);
  assert.match(result.notes, /### 文档/);
  assert.doesNotMatch(result.notes, /chore\(release\)/);
  assert.equal(result.count, 4);
});

test('空提交生成无变更记录', () => {
  const result = buildChangelog([]);
  assert.deepEqual(result.changes, []);
  assert.match(result.notes, /无变更记录/);
});
