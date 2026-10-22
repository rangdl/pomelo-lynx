// 深度检查:lynx-view 内部 shadow DOM 状态 + 全部 console 错误
// 用法: node tools/alignment/inspect.mjs <url>
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:3000/index.html';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome',
  chromiumSandbox: false,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errs.push(`PAGEERR: ${String(e).slice(0, 200)}`));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);
const info = await page.evaluate(() => {
  const v = document.getElementById('view');
  const sr = v?.shadowRoot;
  return {
    shadowChildren: sr?.children?.length ?? -1,
    shadowHtml: sr?.innerHTML?.slice(0, 300) ?? 'no shadow',
    urlAttr: v?.getAttribute('url'),
  };
});
console.log(JSON.stringify({ info, errs: errs.slice(0, 8) }, null, 1));
await page.screenshot({ path: 'results/inspect.png' });
await browser.close();
