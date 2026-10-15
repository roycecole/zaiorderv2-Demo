// scripts/measure-initial-js.mjs —— 量測首頁（預設 `/`）的「首次載入 JS」gzip 大小（NFR-03：≤ 200 kB gzip）
//
// 做法：把已建置的 dist 以內建的小型靜態伺服器提供（含 SPA fallback），用 Playwright 的 Chromium
// 載入頁面，記錄所有 .js 回應，逐檔以 zlib gzip 計算大小，列出清單與總和。
// 「靜態相依」= index.html 直接引用的入口與 modulepreload；「動態載入」= 執行後由 import() 載入的 chunk。
//
// 用法（瀏覽器執行檔以 PW_CHROMIUM_PATH 指定，本腳本不會下載瀏覽器）：
//   VITE_DATA_SOURCE=http npx vite build --outDir dist/m-http --emptyOutDir
//   PW_CHROMIUM_PATH=/path/to/chrome node scripts/measure-initial-js.mjs --dist dist/m-http
// 選項：
//   --dist <dir>        建置輸出目錄（預設 dist）
//   --path <path>       要載入的路徑（預設 /）；可含查詢字串，例如 /?table=A3
//   --base <path>       部署的子路徑（對應 VITE_APP_BASE_PATH，預設 /）
//   --viewport <WxH>    視窗大小（預設 1280x800；手機可用 390x844）
//   --budget <kB>       超過時以非 0 結束（預設不檢查；kB = 1000 位元組，與 Vite 建置報表相同）
//   --json              改輸出 JSON
// HTTP 建置沒有後端時，/api/v1 的請求以內建的最小資料回應，讓菜單頁照實渲染。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const distDir = resolve(opt('dist', 'dist'));
const pagePath = opt('path', '/');
const basePath = `/${opt('base', '/').replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
const [width, height] = opt('viewport', '1280x800').split('x').map(Number);
const budgetKb = Number(opt('budget', '0'));
const asJson = args.includes('--json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** 內建的靜態伺服器：檔案不存在時回 index.html（SPA fallback） */
function serve(root) {
  return new Promise((resolveServer) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        let rel = decodeURIComponent(url.pathname);
        if (basePath !== '' && rel.startsWith(basePath)) rel = rel.slice(basePath.length) || '/';
        const target = normalize(join(root, rel));
        if (target !== root && !target.startsWith(root + sep)) throw new Error('forbidden');
        let file = target;
        const info = await stat(file).catch(() => null);
        if (info === null || info.isDirectory()) file = join(root, 'index.html');
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

/** HTTP 建置沒有後端時的最小資料（形狀同 src/domain/types.ts；只求菜單頁能照實渲染） */
const STATUS = {
  status: 'OPEN',
  todayHours: [{ open: '00:00', close: '23:59' }],
  serverTime: new Date().toISOString(),
};
const STORE_INFO = {
  id: 'store_1',
  slug: 'demo-snack',
  name: '巷仔內小吃部',
  phone: '02-0000-0000',
  address: { city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 100 號' },
  timezone: 'Asia/Taipei',
  services: { pickup: true, delivery: true, dineIn: true },
  paymentMethods: ['CASH'],
  businessHours: [],
  specialDays: [],
  display: { brandColor: null, menuLayout: 'AUTO' },
  limits: {
    minOrderAmount: 0,
    maxQuantityPerItem: 20,
    maxLines: 30,
    maxAdvanceDays: 7,
    slotIntervalMinutes: 15,
    pickupLeadMinutes: 15,
    deliveryLeadMinutes: 30,
  },
  status: STATUS,
};
const product = (n, name, price, extra = {}) => ({
  id: `prd_${n}`,
  categoryId: n <= 3 ? 'cat_rice' : 'cat_drink',
  name,
  basePrice: price,
  displayPrice: price,
  isPriceFrom: false,
  isSoldOut: false,
  hasRequiredOptions: false,
  tags: [],
  allergens: [],
  sortOrder: n,
  ...extra,
});
const MENU = {
  categories: [
    {
      id: 'cat_rice',
      name: '飯類',
      icon: '🍚',
      sortOrder: 1,
      products: [
        product(1, '招牌滷肉飯', 35, { description: '古早味滷肉燥', tags: ['HOT'] }),
        product(2, '古早味排骨飯', 110),
        product(3, '控肉飯', 85),
      ],
    },
    {
      id: 'cat_drink',
      name: '飲品',
      icon: '🥤',
      sortOrder: 2,
      products: [product(4, '古早味紅茶', 25), product(5, '愛玉檸檬', 45)],
    },
  ],
  generatedAt: new Date().toISOString(),
};

function stubApi(path) {
  if (/\/status$/.test(path)) return STATUS;
  if (/\/menu$/.test(path)) return MENU;
  if (/\/banners$/.test(path)) return { items: [] };
  if (/\/stores\/[^/]+$/.test(path)) return STORE_INFO;
  return null;
}

const gzipSize = (buf) => gzipSync(buf).length;
/** kB = 1000 位元組（與 Vite 的建置報表、Chrome DevTools 相同） */
const kb = (n) => (n / 1000).toFixed(1);

async function main() {
  const executablePath = process.env.PW_CHROMIUM_PATH;
  if (executablePath === undefined || executablePath === '') {
    console.error('請以環境變數 PW_CHROMIUM_PATH 指定 Chromium 執行檔（本腳本不會下載瀏覽器）');
    process.exit(2);
  }
  const html = await readFile(join(distDir, 'index.html'), 'utf8');
  // index.html 直接引用的入口與 modulepreload：靜態相依
  const staticRefs = new Set(
    [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+\.js)"[^>]*>/g)].map((m) => {
      const href = m[1];
      return new URL(href, 'http://localhost/').pathname;
    }),
  );

  const server = await serve(distDir);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath });
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
    });
    const page = await context.newPage();
    await page.route('**/api/v1/**', (route) => {
      const body = stubApi(new URL(route.request().url()).pathname);
      return body === null
        ? route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
          });
    });

    const loaded = new Map();
    const pending = [];
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (!path.endsWith('.js') || !response.url().startsWith(origin)) return;
      pending.push(
        response.body().then(
          (buf) => loaded.set(path, { raw: buf.length, gzip: gzipSize(buf) }),
          () => undefined,
        ),
      );
    });

    await page.goto(`${origin}${basePath}${pagePath}`, { waitUntil: 'networkidle' });
    // 菜單資料到齊後商品卡才會渲染；沒有商品卡（例如錯誤狀態）時不阻擋量測
    await page.waitForSelector('[data-product-card]', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await Promise.all(pending);

    const rows = [...loaded.entries()]
      .map(([path, size]) => ({
        file: path.replace(new RegExp(`^${basePath}/`), ''),
        kind: staticRefs.has(path) ? 'static' : 'dynamic',
        ...size,
      }))
      .sort((a, b) => b.gzip - a.gzip);
    const sum = (list, key) => list.reduce((n, r) => n + r[key], 0);
    const result = {
      dist: distDir,
      path: pagePath,
      viewport: `${width}x${height}`,
      totalGzip: sum(rows, 'gzip'),
      totalRaw: sum(rows, 'raw'),
      staticGzip: sum(
        rows.filter((r) => r.kind === 'static'),
        'gzip',
      ),
      dynamicGzip: sum(
        rows.filter((r) => r.kind === 'dynamic'),
        'gzip',
      ),
      files: rows,
    };

    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`首次載入 JS：${pagePath}（${result.viewport}）  dist=${distDir}`);
      console.log('類型     gzip(kB)  raw(kB)  檔案');
      for (const r of rows) {
        const kind = r.kind === 'static' ? '靜態相依' : '動態載入';
        console.log(`${kind}  ${kb(r.gzip).padStart(8)}  ${kb(r.raw).padStart(7)}  ${r.file}`);
      }
      console.log(`靜態相依合計：${kb(result.staticGzip)} kB gzip`);
      console.log(`動態載入合計：${kb(result.dynamicGzip)} kB gzip`);
      console.log(
        `總計：${kb(result.totalGzip)} kB gzip（${kb(result.totalRaw)} kB raw，${rows.length} 個檔案）`,
      );
    }
    if (budgetKb > 0 && result.totalGzip / 1000 > budgetKb) {
      console.error(`超出預算：${kb(result.totalGzip)} kB > ${budgetKb} kB`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
