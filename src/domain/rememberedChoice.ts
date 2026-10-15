// src/domain/rememberedChoice.ts
import type { FrequentItem, ID, ProductDetail } from './types';

/** 某商品「上一次點過」的選項（訂單成立時寫入；僅存於此裝置，會員另可由伺服器同步） */
export interface RememberedChoice {
  productId: ID;
  optionIds: ID[];          // 跨群組的選項 ID
  labels: string[];         // 選項名稱快照，供卡片顯示「上次：大碗・滷蛋」
  note?: string;
  at: number;               // epoch ms（取自 Clock）
}
export type RememberedMap = Record<ID, RememberedChoice>;

export const MAX_REMEMBERED = 100;
export const REMEMBER_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface OrderedLine {
  productId: ID;
  optionIds: ID[];
  labels: string[];
  note?: string;
}

/**
 * 清除過期紀錄；同商品只留最新一筆；超過上限時淘汰最舊者。不改動輸入物件。
 * 載入本機記憶與讀取「常點」前都要先呼叫（過期者不得顯示或再點）。
 */
export function pruneRemembered(map: RememberedMap, nowMs: number): RememberedMap {
  if (!Number.isFinite(nowMs)) return { ...map }; // 時鐘異常時不得清空使用者的記憶
  const alive = Object.values(map)
    .filter((r) => Number.isFinite(r.at) && nowMs - r.at <= REMEMBER_TTL_MS)
    .sort((a, b) => b.at - a.at); // 新 → 舊
  const out: RememberedMap = {};
  let n = 0;
  for (const r of alive) {
    if (Object.hasOwn(out, r.productId)) continue; // 同商品只留最新一筆，不佔名額
    out[r.productId] = r;
    if (++n >= MAX_REMEMBERED) break;
  }
  return out;
}

/** 訂單成立後寫入：同商品覆蓋為最新一次的選擇 */
export function rememberFromOrder(
  map: RememberedMap,
  lines: readonly OrderedLine[],
  nowMs: number,
): RememberedMap {
  const next: RememberedMap = { ...map };
  lines.forEach((l, i) => {
    const entry: RememberedChoice = {
      productId: l.productId,
      optionIds: [...l.optionIds],
      labels: [...l.labels],
      at: nowMs - i, // 同一筆訂單內以行序遞減 1ms，讓「常點」排序穩定（第 1 行最新）
    };
    const note = l.note?.trim();
    if (note) entry.note = note;
    next[l.productId] = entry;
  });
  return pruneRemembered(next, nowMs);
}

/** 最近點過的前 N 項（「常點」區塊）；超過 180 天者不列入 */
export function frequentItems(map: RememberedMap, limit: number, nowMs: number): RememberedChoice[] {
  const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  return Object.values(map)
    .filter((r) => Number.isFinite(r.at) && nowMs - r.at <= REMEMBER_TTL_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, n);
}

/** 會員：合併伺服器常點與本機記憶，較新者優先（BR-35、FLOW-20、FR-AC-11） */
export function mergeRemembered(
  local: RememberedMap,
  server: readonly FrequentItem[],
  nowMs: number,
): RememberedMap {
  const next: RememberedMap = { ...local };
  for (const f of server) {
    const at = Date.parse(f.lastOrderedAt);
    if (!Number.isFinite(at)) continue;
    const cur = next[f.productId];
    if (cur && cur.at >= at) continue; // 本機較新（或同時）：保留本機
    const entry: RememberedChoice = {
      productId: f.productId,
      optionIds: [...f.optionIds],
      labels: [...f.optionLabels],
      at,
    };
    const note = f.note?.trim();
    if (note) entry.note = note;
    next[f.productId] = entry;
  }
  return pruneRemembered(next, nowMs);
}

export type ApplyStatus = 'NONE' | 'FULL' | 'PARTIAL';

export interface AppliedChoice {
  status: ApplyStatus;
  optionIds: ID[];
  labels: string[];
  note?: string;
  /** 記憶中已不可用（下架、售完、群組變更、超出上限）而被丟棄的選項 */
  dropped: ID[];
}

function optionName(detail: ProductDetail, id: ID): string {
  for (const g of detail.optionGroups) {
    const o = g.options.find((x) => x.id === id);
    if (o) return o.name;
  }
  return id;
}

/** 商品目前的預設選項（每個群組 isDefault 且可用者；單選最多 1 個、複選至多 maxSelect 個） */
export function defaultOptionIds(detail: ProductDetail): ID[] {
  const out: ID[] = [];
  for (const g of detail.optionGroups) {
    const defs = g.options.filter((o) => o.isDefault && o.isAvailable).map((o) => o.id);
    out.push(...(g.selectionType === 'SINGLE' ? defs.slice(0, 1) : defs.slice(0, g.maxSelect)));
  }
  return out;
}

/** 選取是否滿足所有群組的最少 / 最多限制 */
export function satisfiesGroups(detail: ProductDetail, optionIds: readonly ID[]): boolean {
  return detail.optionGroups.every((g) => {
    const n = g.options.filter((o) => optionIds.includes(o.id)).length;
    return n >= g.minSelect && n <= g.maxSelect;
  });
}

/**
 * 以商品「目前」的選項群組驗證記憶：失效者丟棄；超出群組上限者視同失效（不靜默截斷）；
 * 必選群組不足時保留仍有效者並以預設補到最少數量（PARTIAL）。
 * 無記憶或記憶不屬於此商品 → NONE（呼叫端使用 defaultOptionIds）。
 */
export function applyRemembered(
  detail: ProductDetail,
  remembered: RememberedChoice | undefined,
): AppliedChoice {
  if (!remembered || remembered.productId !== detail.id) {
    return { status: 'NONE', optionIds: [], labels: [], dropped: [] };
  }

  const wanted = [...new Set(remembered.optionIds)];
  const available = new Set<ID>();
  for (const g of detail.optionGroups) for (const o of g.options) if (o.isAvailable) available.add(o.id);

  const dropped = wanted.filter((id) => !available.has(id));
  let status: ApplyStatus = dropped.length === 0 ? 'FULL' : 'PARTIAL';
  const picked: ID[] = [];

  for (const g of detail.optionGroups) {
    const cap = g.selectionType === 'SINGLE' ? 1 : g.maxSelect;
    const mine = wanted.filter((id) => g.options.some((o) => o.id === id && o.isAvailable));
    const take = mine.slice(0, cap);
    if (mine.length > take.length) {
      dropped.push(...mine.slice(cap)); // 群組改單選或上限調降：不可靜默截斷
      status = 'PARTIAL';
    }
    if (take.length < g.minSelect) {
      const defs = g.options.filter((o) => o.isDefault && o.isAvailable).map((o) => o.id);
      if (take.length === 0) {
        take.push(...defs.slice(0, cap));
      } else {
        for (const d of defs) {
          if (take.length >= g.minSelect) break;
          if (!take.includes(d)) take.push(d); // 保留仍有效者，以預設補到最少數量
        }
      }
      status = 'PARTIAL';
    }
    picked.push(...take);
  }

  const applied: AppliedChoice = {
    status,
    optionIds: picked,
    labels: picked.map((id) => optionName(detail, id)),
    dropped,
  };
  const note = remembered.note?.trim();
  if (note) applied.note = note;
  return applied;
}

/**
 * 卡片「↻ 再點」可否直接加入（不開面板）：記憶全數有效、群組限制皆滿足，且商品還能再加 1 份。
 * inCartQuantity 為購物車內該商品已有的份數（所有行加總）：remainingToday 為數字時，
 * 剩餘份數扣掉已在購物車的份數後須 ≥ 1；remainingToday 省略（未提供）或為 null（不限量）時不限制。
 */
export function canRepeatDirectly(
  detail: ProductDetail,
  applied: AppliedChoice,
  inCartQuantity: number = 0,
): boolean {
  if (applied.status !== 'FULL' || detail.isSoldOut) return false;
  const remaining = detail.remainingToday;
  if (typeof remaining === 'number' && remaining - Math.max(0, inCartQuantity) < 1) return false;
  return satisfiesGroups(detail, applied.optionIds);
}
