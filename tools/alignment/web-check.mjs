// Web 预览验证:加载 probe.web.bundle,截图 + 抓 console 错误
// 用法: node tools/alignment/web-check.mjs <url> [outPrefix]
import { chromium } from 'playwright-core';

const url =
  process.argv[2] ??
  'http://localhost:3000/__web_preview?casename=probe.web.bundle';
const prefix = process.argv[3] ?? 'web';

const exe = process.env.CHROME_PATH ?? '/opt/google/chrome/chrome';
const browser = await chromium.launch({
  executablePath: exe,
  chromiumSandbox: false,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000); // 等 lynx-view 渲染
await page.screenshot({ path: `results/${prefix}-probe.png` });
const lynxView = await page.$('lynx-view');
console.log(
  JSON.stringify(
    {
      url,
      lynxViewPresent: !!lynxView,
      errors: errors.slice(0, 10),
    },
    null,
    1,
  ),
);
await browser.close();
