/**
 * Type declarations for `browser.mjs`.
 *
 * The module is plain ESM on purpose: `e2e/web-check.mjs` is executed
 * directly by Node, which cannot import TypeScript. These declarations let
 * the TypeScript side (`driver/web.driver.ts`) share it without duplicating
 * the browser bootstrap.
 */

import type { Browser, Page } from 'playwright-core';

export declare const DEFAULT_URL: string;
export declare const CHROME_PATH: string;

export declare function launchBrowser(options?: {
  viewport?: { width: number; height: number };
}): Promise<{ browser: Browser; page: Page; errors: string[] }>;

export declare function ensureResultsDir(dir?: string): Promise<string>;
