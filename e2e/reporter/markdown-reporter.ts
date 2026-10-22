/**
 * Markdown reporter for the E2E run.
 *
 * Writes a human-readable report to `results/e2e/report.md` so a run can be
 * reviewed (or attached to a PR) without digging through raw test output.
 * The platform and bundle under test are recorded in the header, because the
 * same scenario file runs against different targets.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Minimal shape of a single test case, as reported by rstest. */
interface CaseResult {
  name: string;
  status: 'skip' | 'pass' | 'fail' | 'todo';
  testPath: string;
  parentNames?: string[];
  duration?: number;
  errors?: Array<{ message?: string; stack?: string }>;
}

/** Minimal shape of the `onTestRunEnd` payload. */
interface RunPayload {
  testResults: CaseResult[];
  summary: {
    tests: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      todo: number;
    };
  };
  duration: { totalTime: number; buildTime: number; testTime: number };
  unhandledErrors?: Array<{ message?: string; stack?: string }>;
}

const STATUS_ICON: Record<CaseResult['status'], string> = {
  pass: '✅',
  fail: '❌',
  skip: '⏭️',
  todo: '📝',
};

function formatDuration(ms: number | undefined): string {
  if (ms == null) {
    return '-';
  }
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatError(error: { message?: string; stack?: string }): string {
  const parts: string[] = [];
  if (error.message) {
    parts.push(error.message);
  }
  if (error.stack) {
    parts.push(error.stack);
  }
  return parts.join('\n\n') || '(no error details)';
}

function caseTitle(testCase: CaseResult): string {
  const parents = testCase.parentNames?.length
    ? `${testCase.parentNames.join(' › ')} › `
    : '';
  return `${parents}${testCase.name}`;
}

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

export class MarkdownReporter {
  readonly #outputFile: string;

  constructor(options: { outputFile?: string } = {}) {
    this.#outputFile =
      options.outputFile ?? join(process.cwd(), 'results', 'e2e', 'report.md');
  }

  async onTestRunEnd(payload: unknown): Promise<void> {
    const run = payload as RunPayload;
    const cases = run.testResults ?? [];
    const failed = cases.filter((testCase) => testCase.status === 'fail');

    const lines: string[] = [];
    lines.push('# E2E 报告');
    lines.push('');
    lines.push(`- 平台: \`${process.env.E2E_PLATFORM ?? 'web'}\``);
    lines.push(`- Bundle: \`${process.env.E2E_BUNDLE ?? 'probe.web.bundle'}\``);
    lines.push(`- 时间: ${new Date().toISOString()}`);
    lines.push(
      `- 用例: ${run.summary.tests.passed} 通过 / ${run.summary.tests.failed} 失败 / ` +
        `${run.summary.tests.skipped} 跳过（共 ${run.summary.tests.total}）`,
    );
    lines.push(`- 耗时: ${formatDuration(run.duration?.totalTime)}`);
    lines.push('');

    lines.push('## 用例明细');
    lines.push('');
    lines.push('| 状态 | 用例 | 文件 | 耗时 |');
    lines.push('| --- | --- | --- | --- |');
    for (const testCase of cases) {
      lines.push(
        `| ${STATUS_ICON[testCase.status]} | ${caseTitle(testCase)} | ` +
          `${basename(testCase.testPath)} | ${formatDuration(testCase.duration)} |`,
      );
    }
    lines.push('');

    if (failed.length > 0) {
      lines.push('## 失败详情');
      lines.push('');
      for (const testCase of failed) {
        lines.push(`### ${caseTitle(testCase)}`);
        lines.push('');
        lines.push('```');
        for (const error of testCase.errors ?? []) {
          lines.push(formatError(error));
        }
        lines.push('```');
        lines.push('');
      }
    }

    const unhandled = run.unhandledErrors ?? [];
    if (unhandled.length > 0) {
      lines.push('## 未捕获错误');
      lines.push('');
      for (const error of unhandled) {
        lines.push('```');
        lines.push(formatError(error));
        lines.push('```');
        lines.push('');
      }
    }

    await mkdir(dirname(this.#outputFile), { recursive: true });
    await writeFile(this.#outputFile, `${lines.join('\n')}\n`, 'utf8');

    // A one-line pointer in the terminal, so the report path is discoverable
    // without hunting through the results directory.
    console.log(`\nE2E 报告已写入: ${this.#outputFile}`);
  }
}
