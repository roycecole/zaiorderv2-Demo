// src/services/api/mock/ids.ts —— Mock 的識別碼、訂單編號與權杖產生（BR-14、BR-27）
import { dateOfMs } from '@/domain/taipeiTime';

/** Crockford Base32（無 I、L、O、U） */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomInts(n: number, max: number): number[] {
  const out: number[] = [];
  const cryptoObj = globalThis.crypto;
  if (cryptoObj !== undefined && typeof cryptoObj.getRandomValues === 'function') {
    const buf = new Uint32Array(n);
    cryptoObj.getRandomValues(buf);
    for (const v of buf) out.push(v % max);
    return out;
  }
  for (let i = 0; i < n; i++) out.push(Math.floor(Math.random() * max));
  return out;
}

function randomCrockford(length: number): string {
  return randomInts(length, 32)
    .map((i) => CROCKFORD.charAt(i))
    .join('');
}

/** 26 碼 ULID（10 碼時間 + 16 碼隨機）；前端視為不透明字串 */
export function newUlid(nowMs: number): string {
  let t = Math.max(0, Math.floor(nowMs));
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  return time + randomCrockford(16);
}

/** BR-14：ZO + yyMMdd（店家時區）+ 6 碼 Crockford Base32 隨機碼 */
export function newOrderNo(nowMs: number): string {
  const date = dateOfMs(nowMs); // YYYY-MM-DD
  return `ZO${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}${randomCrockford(6)}`;
}

function randomHex(bytes: number): string {
  return randomInts(bytes, 256)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}

/** 訪客追蹤權杖：明文只在簽發當次的回應回傳，db 僅存雜湊（05 §5.4） */
export function newTrackingToken(): string {
  return `trk_${randomHex(8)}`;
}

export function newAccessToken(): string {
  return `mock_at_${randomHex(12)}`;
}

export function newRefreshToken(): string {
  return `mock_rt_${randomHex(16)}`;
}

/** 同步雜湊（cyrb53，16 碼 hex）：只用於 Mock 比對權杖，不具密碼學強度 */
export function hashToken(token: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < token.length; i++) {
    const ch = token.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = (h2 >>> 0).toString(16).padStart(8, '0');
  const lo = (h1 >>> 0).toString(16).padStart(8, '0');
  return hi + lo;
}

/** 模擬電子發票號碼（兩碼英文 + 8 碼數字） */
export function newInvoiceNo(): string {
  const letters = randomInts(2, 26)
    .map((i) => String.fromCharCode(65 + i))
    .join('');
  const digits = randomInts(8, 10).join('');
  return `${letters}${digits}`;
}

/** 讓 handler 以固定前綴建立可讀 ID（種子、他人訂單等） */
export function newPrefixedId(prefix: string): string {
  return `${prefix}_${randomHex(6)}`;
}
