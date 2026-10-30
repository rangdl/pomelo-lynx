import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(
  join(ROOT, '.github/workflows/build-hosts.yml'),
  'utf8',
);

test('CI 只由正式 tag 和 dev tag 触发,不再跟随分支 push', () => {
  assert.match(workflow, /tags: \["v\*", "dev-\*"\]/);
  assert.doesNotMatch(workflow, /branches: \[master\]/);
  assert.match(
    workflow,
    /cancel-in-progress: \$\{\{ !startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/,
  );
});

test('正式 tag 校验 master,dev tag 校验 dev,且都校验 package 版本', () => {
  assert.match(
    workflow,
    /git fetch origin refs\/heads\/master:refs\/remotes\/origin\/master/,
  );
  assert.match(workflow, /正式版 tag 必须打在 master 上/);
  assert.match(
    workflow,
    /git fetch origin refs\/heads\/dev:refs\/remotes\/origin\/dev/,
  );
  assert.match(workflow, /dev tag 必须打在 dev 分支上/);
  assert.match(workflow, /dev tag \$TAG_VERSION 的版本/);
});

test('iOS 构建注入通道和真实构建号', () => {
  assert.match(workflow, /echo "channel=stable"/);
  assert.match(workflow, /echo "channel=dev"/);
  assert.match(
    workflow,
    /POMELO_CHANNEL=\$\{\{ steps\.mode\.outputs\.channel \}\}/,
  );
  assert.match(
    workflow,
    /CURRENT_PROJECT_VERSION=\$\{\{ github\.run_number \}\}/,
  );
});

test('Release 使用固定 IPA/client.json 并生成 changelog', () => {
  assert.match(workflow, /release-files\/pomelo-lynx-ios-nosign\.ipa/);
  assert.match(workflow, /release-files\/client\.json/);
  assert.match(workflow, /generate-changelog\.mjs/);
  assert.match(workflow, /--notes-file release-notes\.md/);
  assert.doesNotMatch(
    workflow,
    /pomelo-lynx-ios-\$\{VERSION\}-nosign\.ipa/,
    '正式版不应再上传带版本号的 IPA',
  );
  assert.doesNotMatch(
    workflow,
    /version\.json release-files\/checksums\.txt \|\| true/,
    'Release 上传失败不能被 || true 吞掉',
  );
});

test('dev 构建滚动更新 dev Release,并保留稳定版隔离', () => {
  assert.match(
    workflow,
    /if: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/dev-'\) \|\| github\.event_name == 'workflow_dispatch' \}\}/,
  );
  assert.match(workflow, /--prerelease --latest=false/);
  assert.match(workflow, /git tag -f dev/);
  assert.match(workflow, /gh release upload dev .*--clobber/s);
});
