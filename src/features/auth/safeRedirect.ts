// src/features/auth/safeRedirect.ts —— 登入後導向的安全檢查（07 §11：redirect 僅接受站內相對路徑，避免開放式轉址）
import { ROUTES } from '@/app/routes';

/** 控制字元（含 DEL）與反斜線：瀏覽器會把 `\` 當 `/` 處理，`/\evil.com` 會變成 `//evil.com` */
function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f || c === 0x5c) return true;
  }
  return false;
}

const PROBE_ORIGIN = 'http://zaiorder.invalid';

/**
 * 回傳可安全導向的站內路徑；不合格一律回傳 `fallback`。
 * 合格：以單一 `/` 開頭、不是 `//`、不含控制字元或反斜線、解析後仍在同一個 origin，且不是登入頁本身（避免迴圈）。
 */
export function safeRedirect(raw: string | null | undefined, fallback: string = ROUTES.home): string {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (hasUnsafeChar(value)) return fallback;
  try {
    const url = new URL(value, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return fallback;
    if (url.pathname === ROUTES.login) return fallback;
  } catch {
    return fallback;
  }
  return value;
}

/** 組出 `/login?redirect=…`；`redirect` 不合格時不附參數 */
export function buildLoginUrl(redirect?: string | null): string {
  const target = safeRedirect(redirect, '');
  if (target === '' || target === ROUTES.home) return ROUTES.login;
  return `${ROUTES.login}?redirect=${encodeURIComponent(target)}`;
}

/** 需要會員身分的路徑（訪客「以訪客身分繼續」時不應回到這些頁面） */
export function isMemberOnlyPath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0] ?? path;
  return pathname === ROUTES.account || pathname.startsWith(`${ROUTES.account}/`);
}
