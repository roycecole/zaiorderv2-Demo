import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CACHE_RULES,
  CSP_DIRECTIVES,
  SECURITY_HEADERS,
  buildCsp,
  buildVercelConfig,
  renderHeadersFile,
  renderRedirectsFile,
  renderVercelJson,
} from '../deployHeaders';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('部署設定檔與單一事實來源一致', () => {
  it('public/_headers（Netlify / Cloudflare Pages）', () => {
    expect(read('../../public/_headers')).toBe(renderHeadersFile());
  });

  it('public/_redirects（SPA fallback）', () => {
    expect(read('../../public/_redirects')).toBe(renderRedirectsFile());
    expect(renderRedirectsFile()).toContain('/*  /index.html  200');
  });

  it('vercel.json：rewrites 與 headers', () => {
    expect(read('../../vercel.json')).toBe(renderVercelJson());
    expect(JSON.parse(read('../../vercel.json'))).toEqual(buildVercelConfig());
  });
});

describe('內容安全政策（CSP）', () => {
  const csp = buildCsp();

  it('不允許 script 的 unsafe-inline / unsafe-eval，預設來源為 self', () => {
    expect(CSP_DIRECTIVES['script-src']).toEqual(["'self'"]);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('只有 style 允許 unsafe-inline（Radix 捲動鎖會注入 <style>）', () => {
    const withInline = Object.entries(CSP_DIRECTIVES)
      .filter(([, values]) => values.includes("'unsafe-inline'"))
      .map(([name]) => name);
    expect(withInline).toEqual(['style-src']);
  });

  it('標頭集合含 nosniff、Referrer-Policy、Permissions-Policy', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('camera=()');
    expect(SECURITY_HEADERS['Content-Security-Policy']).toBe(csp);
  });
});

describe('快取規則（07 §12）', () => {
  const rule = (path: string) => CACHE_RULES.find((r) => r.path === path)?.value;

  it('雜湊檔名資源長期快取且不可變；入口 HTML 每次重新驗證', () => {
    expect(rule('/assets/*')).toBe('public, max-age=31536000, immutable');
    expect(rule('/index.html')).toBe('no-cache');
  });

  it('沒有雜湊的靜態檔不可標為 immutable', () => {
    for (const r of CACHE_RULES.filter((c) => c.path !== '/assets/*')) {
      expect(r.value).not.toContain('immutable');
    }
  });
});
