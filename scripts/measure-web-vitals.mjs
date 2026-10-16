// scripts/measure-web-vitals.mjs —— 量測首頁冷啟動的 LCP 與 CLS（NFR-03：LCP ≤ 2.5 s、CLS ≤ 0.1）
//
// 做法：把已建置的 dist 以內建的靜態伺服器提供（gzip），用 Playwright 的 Chromium 在模擬的行動網路與 CPU 下
// 冷啟動載入首頁，以 PerformanceObserver 讀取 LCP 與 layout-shift，每種視窗重複多次取中位數。
// 不使用 Lighthouse（不需下載額外工具）；數字與 Lighthouse 行動版的節流設定（慢 4G、4× CPU）同級，但不是同一套評分。
//
// 用法（瀏覽器執行檔以 PW_CHROMIUM_PATH 指定，本腳本不會下載瀏覽器）：
//   VITE_DATA_SOURCE=mock VITE_DEMO_MODE=false npx vite build --outDir dist/vitals --emptyOutDir
//   PW_CHROMIUM_PATH=/path/to/chrome node scripts/measure-web-vitals.mjs --dist dist/vitals
// 選項：
//   --dist <dir>        建置輸出目錄（預設 dist）
//   --runs <n>          每種視窗重複次數（預設 3，取中位數）
//   --latency <ms>      Mock 的每個請求延遲（預設 0：只看程式與網路；Demo 預設是 300）
//   --clock <iso>       Demo 時鐘（預設營業中的 2026-10-14T12:00:00+08:00；Mock 建置才有作用）
//   --max-lcp <ms>      任一視窗的 LCP 中位數超過時以非 0 結束（預設不檢查）
//   --max-cls <value>   任一視窗的 CLS 中位數超過時以非 0 結束（預設不檢查）
//   --json              改輸出 JSON
/* global window */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, devices } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const distDir = resolve(opt('dist', 'dist'));
const runs = Math.max(1, Number(opt('runs', '3')));
const latencyMs = Number(opt('latency', '0'));
const clock = opt('clock', '2026-10-14T12:00:00+08:00');
const maxLcp = Number(opt('max-lcp', '0'));
const maxCls = Number(opt('max-cls', '0'));
const asJson = args.includes('--json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function serve(root) {
  return new Promise((resolveServer) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const rel = decodeURIComponent(url.pathname);
        let target = normalize(join(root, rel));
        if (target !== root && !target.startsWith(root + sep)) throw new Error('forbidden');
        let info = await stat(target).catch(() => null);
        if (info === null || info.isDirectory()) {
          target = join(root, 'index.html'); // SPA fallback
          info = await stat(target);
        }
        const body = await readFile(target);
        const headers = {
          'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
          'Cache-Control': 'no-cache',
        };
        if (/\.(js|css|html|svg|json|txt)$/.test(target) && String(req.headers['accept-encoding'] ?? '').includes('gzip')) {
          res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
          res.end(gzipSync(body));
        } else {
          res.writeHead(200, headers);
          res.end(body);
        }
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const VIEWPORTS = [
  { name: '手機（Pixel 7）', context: devices['Pixel 7'] },
  { name: '平板 768', context: { viewport: { width: 768, height: 1024 } } },
  { name: '桌機 1440', context: { viewport: { width: 1440, height: 900 } } },
];

const server = await serve(distDir);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });

const results = [];
for (const viewport of VIEWPORTS) {
  const lcps = [];
  const clss = [];
  for (let i = 0; i < runs; i += 1) {
    const context = await browser.newContext({ ...viewport.context, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
    await context.addInitScript((latency) => {
      try {
        localStorage.setItem('zaiorder:v1:demo', JSON.stringify({ latencyMs: latency }));
      } catch {
        /* 非 Mock 建置不需要 */
      }
    }, latencyMs);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    // 慢 4G：1.6 Mbps 下載、150 ms 往返；4× CPU 節流（與 Lighthouse 行動版同級）
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      window.__vitals = { lcp: 0, cls: 0 };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__vitals.lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__vitals.cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(`${origin}/?demo_clock=${encodeURIComponent(clock)}`, { waitUntil: 'load' });
    await page.locator('[data-product-card]').first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    const vitals = await page.evaluate(() => window.__vitals);
    lcps.push(vitals.lcp);
    clss.push(vitals.cls);
    await context.close();
  }
  results.push({ viewport: viewport.name, lcpMs: Math.round(median(lcps)), cls: Number(median(clss).toFixed(4)), runs });
}

await browser.close();
server.close();

if (asJson) {
  console.log(JSON.stringify({ latencyMs, results }, null, 2));
} else {
  console.log(`冷啟動（慢 4G、4× CPU、Mock 延遲 ${latencyMs} ms；每種視窗 ${runs} 次取中位數）`);
  for (const r of results) {
    console.log(`  ${r.viewport.padEnd(16)} LCP ${String(r.lcpMs).padStart(5)} ms   CLS ${r.cls}`);
  }
}

let failed = false;
for (const r of results) {
  if (maxLcp > 0 && r.lcpMs > maxLcp) {
    console.error(`✗ ${r.viewport} LCP ${r.lcpMs} ms 超過預算 ${maxLcp} ms`);
    failed = true;
  }
  if (maxCls > 0 && r.cls > maxCls) {
    console.error(`✗ ${r.viewport} CLS ${r.cls} 超過預算 ${maxCls}`);
    failed = true;
  }
}
if (failed) process.exit(1);
