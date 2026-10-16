// vite-plugins/deployHeaders.ts —— 部署用的安全標頭與快取規則（07 §11、§12、§14.2；NFR-07、NFR-12）
//
// 單一事實來源：`public/_headers`（Netlify / Cloudflare Pages）、`vercel.json` 與 `vite preview`
// （E2E 在同樣的標頭下執行，CSP 有問題會在測試中暴露）都由這裡產生 / 比對；
// `vite-plugins/__tests__/deployHeaders.test.ts` 確保檔案內容沒有偏離。
// 只使用可被 Node 直接執行的語法（可用 `node --experimental-strip-types` 重新產生檔案，見 README「部署」）。

/**
 * 內容安全政策。
 * - `style-src 'unsafe-inline'`：Radix 的捲動鎖（react-remove-scroll-bar）會注入 <style>。
 * - `connect-src`：Mock / 靜態 Demo 只需要 'self'；串接真實 API（VITE_DATA_SOURCE=http）時，
 *   請在這裡加上 API 網域（例：https://api.example.com），並重新產生設定檔。
 * - `frame-ancestors` 只能由標頭設定（<meta> 無效）。
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'frame-ancestors': ["'self'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'object-src': ["'none'"],
};

export function buildCsp(directives: Record<string, string[]> = CSP_DIRECTIVES): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** 套用在所有路徑的安全標頭 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': buildCsp(),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export interface CacheRule {
  /** 路徑樣式（Netlify `_headers` 與 Vercel `source` 皆可使用 `*`） */
  path: string;
  value: string;
}

/**
 * 快取規則：雜湊檔名的資源可長期快取；入口 HTML 每次重新驗證（才能取得新版）；
 * 檔名不含雜湊的圖片 / 圖示快取一天。
 */
export const CACHE_RULES: CacheRule[] = [
  { path: '/assets/*', value: 'public, max-age=31536000, immutable' },
  { path: '/index.html', value: 'no-cache' },
  { path: '/images/*', value: 'public, max-age=86400' },
  { path: '/favicon.svg', value: 'public, max-age=86400' },
  { path: '/robots.txt', value: 'public, max-age=3600' },
];

/** `public/_headers`（Netlify / Cloudflare Pages 語法） */
export function renderHeadersFile(): string {
  const lines: string[] = [
    '# 由 vite-plugins/deployHeaders.ts 產生（不要手動修改；內容一致性由單元測試檢查）',
    '# Netlify 與 Cloudflare Pages 共用；子路徑部署請在路徑前加上子路徑。',
    '/*',
  ];
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) lines.push(`  ${key}: ${value}`);
  for (const rule of CACHE_RULES) {
    lines.push('', rule.path, `  Cache-Control: ${rule.value}`);
  }
  return `${lines.join('\n')}\n`;
}

export interface VercelHeaderEntry {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

export interface VercelConfig {
  rewrites: Array<{ source: string; destination: string }>;
  headers: VercelHeaderEntry[];
}

/** `vercel.json`：SPA fallback + 同一組標頭 */
export function buildVercelConfig(): VercelConfig {
  return {
    rewrites: [{ source: '/(.*)', destination: '/index.html' }],
    headers: [
      {
        source: '/(.*)',
        headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
      },
      ...CACHE_RULES.map((rule) => ({
        source: rule.path.replace('/*', '/(.*)'),
        headers: [{ key: 'Cache-Control', value: rule.value }],
      })),
    ],
  };
}

export function renderVercelJson(): string {
  return `${JSON.stringify(buildVercelConfig(), null, 2)}\n`;
}

/** Netlify / Cloudflare Pages 的 SPA fallback（`public/_redirects`） */
export function renderRedirectsFile(): string {
  return '# SPA fallback：所有找不到實際檔案的路徑都回 index.html（由前端路由處理）\n/*  /index.html  200\n';
}
