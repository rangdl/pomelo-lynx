// 诊断:列出所有被当作 HTML 伺服的 .js 请求(裸模块解析失败处)
// 用法: node tools/alignment/netcheck.mjs <url>
import { chromium } from 'playwright-core';

const url =
  process.argv[2] ??
  'http://localhost:3000/__web_preview?casename=probe.web.bundle';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome',
  chromiumSandbox: false,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const bad = [];
page.on('response', (r) => {
  if (
    r.headers()['content-type']?.includes('text/html') &&
    r.url().endsWith('.js')
  ) {
    bad.push(r.url());
  }
});
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);
console.log(JSON.stringify(bad, null, 1));
await browser.close();
