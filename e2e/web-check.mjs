#!/usr/bin/env node
/**
 * Web preview check.
 *
 * Loads a Lynx bundle in a browser, collects every console error (page *and*
 * background worker), and writes a screenshot. This is the single entry point
 * that the former `web-check.mjs` / `netcheck.mjs` / `inspect.mjs` /
 * `worker-err.mjs` scripts were split across.
 *
 * Usage:
 *   node e2e/web-check.mjs [url] [options]
 *
 * Options:
 *   --net        also report .js requests that were served as text/html
 *                (a bare module specifier the bundler did not resolve)
 *   --deep       also dump the `lynx-view` shadow DOM state
 *   --out=PREFIX screenshot file prefix (default: "web")
 *   --wait=MS    extra settle time after load (default: 3000)
 */

import { join } from 'node:path';

import {
  DEFAULT_URL,
  ensureResultsDir,
  launchBrowser,
} from './driver/browser.mjs';

const args = process.argv.slice(2);
const flags = {
  net: args.includes('--net'),
  deep: args.includes('--deep'),
  out: flagValue('--out') ?? 'web',
  wait: Number(flagValue('--wait') ?? 3000),
};
const url =
  args.find((arg) => !arg.startsWith('--') && !arg.includes('=')) ??
  DEFAULT_URL;

/**
 * @param {string} name
 * @returns {string | undefined}
 */
function flagValue(name) {
  const found = args.find((arg) => arg.startsWith(`${name}=`));
  return found?.slice(name.length + 1);
}

const resultsDir = await ensureResultsDir();
const { browser, page, errors } = await launchBrowser();

/** @type {string[]} */
const htmlServedJs = [];
page.on('response', (response) => {
  const contentType = response.headers()['content-type'] ?? '';
  if (contentType.includes('text/html') && response.url().endsWith('.js')) {
    htmlServedJs.push(response.url());
  }
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(flags.wait);

const lynxView = await page.$('lynx-view');

/** @type {Record<string, unknown>} */
const report = {
  url,
  lynxViewPresent: Boolean(lynxView),
  errors: errors.slice(0, 10),
};

if (flags.deep) {
  report.shadow = await page.evaluate(() => {
    const view = document.getElementById('view');
    const shadow = view?.shadowRoot;
    if (!shadow) {
      return { present: false };
    }
    return {
      present: true,
      children: shadow.children.length,
      lynxElements: shadow.querySelectorAll('x-view, x-text, x-image').length,
      html: shadow.innerHTML.slice(0, 300),
    };
  });
}

if (flags.net) {
  report.jsServedAsHtml = htmlServedJs;
}

const screenshot = join(resultsDir, `${flags.out}-probe.png`);
await page.screenshot({ path: screenshot });
report.screenshot = screenshot;

console.log(JSON.stringify(report, null, 1));

await browser.close();
