/**
 * Shared browser bootstrap for the alignment tools.
 *
 * Every script needs the same three things, and getting them subtly different
 * is how "the error only shows up in one script" bugs happen:
 *
 *   1. A Chrome that actually starts. The container runs as root, where
 *      Chrome refuses to use the setuid sandbox, so the sandbox is disabled
 *      explicitly.
 *   2. The console error collector. Lynx evaluates its JavaScript in a
 *      background worker, so engine-level errors surface in the *worker's*
 *      console, not the page's. Both are collected.
 *   3. A results directory that exists before something tries to write into
 *      it (`results/` is git-ignored, so a fresh clone does not have it).
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

export const DEFAULT_URL = 'http://localhost:3000/index.html';
export const CHROME_PATH =
  process.env.CHROME_PATH ?? '/opt/google/chrome/chrome';

/**
 * Launch Chrome and return the page together with a live error collector.
 *
 * @param {{ viewport?: { width: number, height: number } }} [options]
 */
export async function launchBrowser(options = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    chromiumSandbox: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 390, height: 844 },
  });
  const page = await context.newPage();

  /** @type {string[]} */
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    errors.push(String(error));
  });
  // Lynx runs its JavaScript in a background worker; engine-level errors
  // (a broken bundle, a missing runtime API) surface here, not on the page.
  page.on('worker', (worker) => {
    worker.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(`[worker] ${message.text()}`);
      }
    });
  });

  return { browser, page, errors };
}

/**
 * Create the results directory and return its path.
 *
 * @param {string} [dir]
 */
export async function ensureResultsDir(dir = join(process.cwd(), 'results')) {
  await mkdir(dir, { recursive: true });
  return dir;
}
