/**
 * 从 git 提交生成发布说明。
 *
 * 输出:
 *   - release-notes.md: GitHub Release 的完整说明
 *   - changes.json: App 客户端更新区显示的短列表
 *
 * 设计上不引入 changelog 依赖,沿用仓库已有的 conventional commit 前缀。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const TYPES = {
  feat: '新增',
  fix: '修复',
  perf: '优化',
  refactor: '重构',
  docs: '文档',
  test: '测试',
  build: '构建',
  ci: 'CI',
  chore: '其他',
  revert: '回退',
};
const ORDER = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
  'other',
];
const CONVENTIONAL =
  /^(feat|fix|perf|refactor|docs|test|build|ci|chore|revert)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i;

export function parseCommit(subject) {
  const match = CONVENTIONAL.exec(subject.trim());
  if (!match) {
    return {
      type: 'other',
      label: '其他',
      scope: '',
      description: subject.trim(),
    };
  }
  const type = match[1].toLowerCase();
  return {
    type,
    label: TYPES[type] ?? '其他',
    scope: match[2]?.trim() ?? '',
    description: match[4].trim(),
  };
}

/** 返回去重后的短列表和按类型分组的 Markdown。 */
export function buildChangelog(commits, { max = 20 } = {}) {
  const limit = Math.max(1, Math.min(50, Number(max) || 20));
  const groups = new Map();
  const changes = [];
  const seen = new Set();

  for (const commit of commits) {
    const subject = String(commit.subject ?? '').trim();
    if (!subject || /^chore\(release\):/i.test(subject)) continue;
    const parsed = parseCommit(subject);
    const change = (
      parsed.type === 'other'
        ? `其他：${parsed.description}`
        : `${parsed.label}${parsed.scope ? `（${parsed.scope}）` : ''}：${parsed.description}`
    ).slice(0, 200);
    if (seen.has(change)) continue;
    seen.add(change);
    if (!groups.has(parsed.type)) groups.set(parsed.type, []);
    groups.get(parsed.type).push({ ...parsed, hash: commit.hash ?? '' });
    if (changes.length < limit) changes.push(change);
  }

  const sections = [];
  for (const type of ORDER) {
    const items = groups.get(type);
    if (!items?.length) continue;
    sections.push(
      `### ${TYPES[type] ?? '其他'}\n\n${items
        .map((item) =>
          item.hash
            ? `- ${item.description} (\`${item.hash}\`)`
            : `- ${item.description}`,
        )
        .join('\n')}`,
    );
  }
  const notes =
    sections.length > 0
      ? `## 变更\n\n${sections.join('\n\n')}\n`
      : '## 变更\n\n无变更记录。\n';
  return { changes, notes, count: seen.size };
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function main() {
  const from = argument('from');
  const to = argument('to', 'HEAD');
  const out = argument('out');
  const json = argument('json');
  const max = Number(argument('max', '20'));
  if (!from) throw new Error('缺少 --from;请传入上一个发布 tag');
  if (!out && !json) throw new Error('至少需要 --out 或 --json');
  const raw = execFileSync(
    'git',
    ['log', '--no-merges', '--pretty=format:%h%x09%s', `${from}..${to}`],
    { encoding: 'utf8' },
  );
  const commits = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, ...subject] = line.split('\t');
      return { hash, subject: subject.join('\t') };
    });
  const result = buildChangelog(commits, { max });
  if (out) writeFileSync(out, result.notes);
  if (json) writeFileSync(json, `${JSON.stringify(result.changes, null, 2)}\n`);
  console.log(
    `[generate-changelog] ${commits.length} commits, ${result.changes.length} changes`,
  );
}

if (process.argv[1]?.endsWith('generate-changelog.mjs')) main();
