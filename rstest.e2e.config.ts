/**
 * Rstest configuration for the E2E run.
 *
 * Kept separate from `rstest.config.ts` (unit tests) because the two suites
 * need opposite environments: unit tests render ReactLynx components in a
 * Lynx-like DOM, while E2E drives a real browser or a real device from Node.
 *
 * Note: Rstest 0.12 keeps these options at the top level (no `test: {}`
 * wrapper like Vitest).
 */

import { defineConfig } from '@rstest/core';

import { MarkdownReporter } from './e2e/reporter/markdown-reporter';

export default defineConfig({
  include: ['e2e/scenarios/**/*.scenario.ts'],

  // A scenario launches a browser (or talks to a device), so the default
  // 5s budget is too tight.
  testTimeout: 30_000,
  hookTimeout: 15_000,

  // Keep files serial: two runs in parallel would fight over the same
  // device, the same Chrome profile and the machine's CPU.
  pool: { maxWorkers: 1 },

  // Rstest only accepts built-in reporter names or reporter instances —
  // a path string is rejected — so the instance is passed directly.
  reporters: ['default', new MarkdownReporter()],
});
