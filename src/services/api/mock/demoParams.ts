// src/services/api/mock/demoParams.ts —— demo_* 啟動參數（僅 VITE_DEMO_MODE=true；07 §6.3、08 §4）
// 開啟網址時套用一次，供 E2E 與展示預先佈置情境；套用後不自網址移除，重新整理與「重置 Demo 資料」後會再次套用。
import type { FailNext, RaceOnNextCreate } from './demoControl';

export interface DemoParams {
  /** 以此時間作為「現在」的起點並繼續走時（等同 clockOverride） */
  clock?: string;
  failNext?: FailNext;
  limitOverrides?: Record<string, number | null>;
  race?: RaceOnNextCreate;
}

const FAIL_TARGETS: ReadonlyArray<FailNext['target']> = [
  'any', 'orders.quote', 'orders.create', 'orders.pay', 'auth.verifyOtp', 'store.getMenu',
];

/**
 * 手動解析查詢字串：URLSearchParams 會把未編碼的「+」當成空白，
 * 而 `?demo_clock=2026-10-14T12:00:00+08:00` 的 +08:00 必須保留，因此自行拆解並只做百分比解碼。
 */
function entries(search: string): Array<[string, string]> {
  const q = search.startsWith('?') ? search.slice(1) : search;
  const out: Array<[string, string]> = [];
  for (const part of q.split('&')) {
    if (part === '') continue;
    const i = part.indexOf('=');
    const rawKey = i < 0 ? part : part.slice(0, i);
    const rawValue = i < 0 ? '' : part.slice(i + 1);
    try {
      out.push([decodeURIComponent(rawKey), decodeURIComponent(rawValue)]);
    } catch {
      out.push([rawKey, rawValue]);
    }
  }
  return out;
}

/** 「2026-10-14T12:00:00 08:00」（+ 被當成空白）還原為 +08:00 */
function normalizeIso(value: string): string {
  return value.trim().replace(/ (\d{2}:\d{2})$/, '+$1');
}

function parseIso(value: string): string | null {
  const v = normalizeIso(value);
  return Number.isFinite(Date.parse(v)) ? v : null;
}

function parseProductCount(value: string): { productId: string; count: number | null } | null {
  const i = value.lastIndexOf(':');
  if (i <= 0) return null;
  const productId = value.slice(0, i);
  const raw = value.slice(i + 1).trim().toLowerCase();
  if (raw === 'null' || raw === 'none' || raw === 'unlimited' || raw === '') return { productId, count: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return { productId, count: n };
}

export function parseDemoParams(search: string): DemoParams {
  const out: DemoParams = {};
  for (const [key, value] of entries(search)) {
    switch (key) {
      case 'demo_clock': {
        const iso = parseIso(value);
        if (iso !== null) out.clock = iso;
        break;
      }
      case 'demo_fail': {
        // <端點>[:<階段>][:<次數>]：階段與次數依內容辨識、順序不拘；省略次數為持續失敗
        const [target, ...rest] = value.split(':');
        if (target === undefined || !FAIL_TARGETS.includes(target as FailNext['target'])) break;
        const fail: FailNext = { target: target as FailNext['target'], remaining: Number.MAX_SAFE_INTEGER };
        for (const seg of rest) {
          if (seg === 'BEFORE' || seg === 'AFTER_COMMIT') fail.phase = seg;
          else if (/^\d+$/.test(seg)) fail.remaining = Number(seg);
        }
        if (fail.remaining > 0) out.failNext = fail;
        break;
      }
      case 'demo_limit': {
        const hit = parseProductCount(value);
        if (hit !== null) (out.limitOverrides ??= {})[hit.productId] = hit.count;
        break;
      }
      case 'demo_race': {
        const hit = parseProductCount(value);
        if (hit !== null && hit.count !== null && hit.count > 0) {
          const race = (out.race ??= {});
          (race.buy ??= []).push({ productId: hit.productId, quantity: hit.count });
        }
        break;
      }
      case 'demo_fullslot': {
        const iso = parseIso(value);
        if (iso !== null) {
          const race = (out.race ??= {});
          (race.fillSlots ??= []).push({ startAt: iso, leave: 0 });
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}
