// 捕获 Lynx background worker 内的完整错误栈
// 用法: node tools/alignment/worker-err.mjs <url>
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:3000/index.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome',
  chromiumSandbox: false,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 600));
});
page.on('worker', (w) => {
  w.on('console', (m) => {
    if (m.type() === 'error') errs.push(`[worker] ${m.text().slice(0, 600)}`);
  });
});
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(4000);
console.log(JSON.stringify(errs, null, 1));
await browser.close();
