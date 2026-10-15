// src/features/menu/sheetModel.ts —— 商品面板（PG-02）的純函式模型：選取狀態、預設值套用、單價與驗證
import type { RememberedChoice } from '@/domain/rememberedChoice';
import { applyRemembered, defaultOptionIds } from '@/domain/rememberedChoice';
import { unitPrice } from '@/domain/pricing';
import type { ID, OptionGroup, ProductDetail } from '@/domain/types';
import { groupErrorText } from './OptionGroupField';

/** 群組 ID → 該群組已選的選項 ID（依選項在群組內的順序） */
export type Selected = Record<ID, ID[]>;

/** 品項備註上限（VR-08） */
export const NOTE_MAX = 50;

/** 面板內的提示列（03 §6.8）：套用上次選擇 / 部分失效 / 已恢復預設 */
export type SheetTip =
  { kind: 'NONE' } | { kind: 'APPLIED'; text: string } | { kind: 'PARTIAL' } | { kind: 'RESTORED' };

export interface SheetForm {
  selected: Selected;
  note: string;
  quantity: number;
  tip: SheetTip;
  /** 使用者已按過「加入」且有未滿足的條件：此時才在群組下方顯示錯誤（不在剛開啟時就標紅） */
  attempted: boolean;
}

export function toSelected(detail: ProductDetail, optionIds: ReadonlyArray<ID>): Selected {
  const picked = new Set(optionIds);
  const out: Selected = {};
  for (const group of detail.optionGroups) {
    out[group.id] = group.options.filter((o) => picked.has(o.id)).map((o) => o.id);
  }
  return out;
}

/** 選取結果攤平成跨群組的 optionIds（依群組、選項順序；與 quote 的 optionLabels 順序一致） */
export function flattenSelected(detail: ProductDetail, selected: Selected): ID[] {
  return detail.optionGroups.flatMap((group) => selected[group.id] ?? []);
}

export function selectedLabels(detail: ProductDetail, optionIds: ReadonlyArray<ID>): string[] {
  const picked = new Set(optionIds);
  return detail.optionGroups.flatMap((g) =>
    g.options.filter((o) => picked.has(o.id)).map((o) => o.name),
  );
}

/** 單價 = 基本價 + Σ 選項加價（BR-02，不得小於 0） */
export function selectedUnitPrice(detail: ProductDetail, optionIds: ReadonlyArray<ID>): number {
  const picked = new Set(optionIds);
  const deltas = detail.optionGroups.flatMap((g) =>
    g.options.filter((o) => picked.has(o.id)).map((o) => o.priceDelta),
  );
  return unitPrice({ basePrice: detail.basePrice, optionDeltas: deltas });
}

/** 第一個不滿足最少 / 最多限制的群組與其錯誤文字 */
export function firstGroupError(
  detail: ProductDetail,
  selected: Selected,
): { group: OptionGroup; message: string } | null {
  for (const group of detail.optionGroups) {
    const message = groupErrorText(group, (selected[group.id] ?? []).length);
    if (message !== null) return { group, message };
  }
  return null;
}

export function groupErrors(detail: ProductDetail, selected: Selected): Map<ID, string> {
  const errors = new Map<ID, string>();
  for (const group of detail.optionGroups) {
    const message = groupErrorText(group, (selected[group.id] ?? []).length);
    if (message !== null) errors.set(group.id, message);
  }
  return errors;
}

export interface InitialFormInput {
  detail: ProductDetail;
  /** 編輯購物車行：以該行既有內容為準，不套用點餐記憶（FR-PD-09 優先序） */
  editing?: { optionIds: ID[]; note?: string | undefined; quantity: number } | undefined;
  /** 點餐記憶（已排除過期者）；未啟用時傳 undefined */
  remembered?: RememberedChoice | undefined;
  /** 步進器上限（已扣除購物車內同商品其他行）；< 1 時數量仍為 1（加入鈕停用） */
  maxQuantity: number;
}

/**
 * 預設值優先序（FR-PD-09、FLOW-03）：編輯中的品項行 ＞ 點餐記憶 ＞ 商品預設選項。
 * 記憶以商品「目前」的選項驗證：全數有效 → 套用並提示；部分失效 → 失效者丟棄、必選群組改用預設並提示（PARTIAL）。
 */
export function buildInitialForm({
  detail,
  editing,
  remembered,
  maxQuantity,
}: InitialFormInput): SheetForm {
  const cap = Math.max(1, maxQuantity);
  if (editing !== undefined) {
    const applied = applyRemembered(detail, {
      productId: detail.id,
      optionIds: editing.optionIds,
      labels: [],
      at: 0,
    });
    return {
      selected: toSelected(detail, applied.optionIds),
      note: editing.note ?? '',
      quantity: Math.min(Math.max(1, editing.quantity), cap),
      tip: applied.status === 'PARTIAL' ? { kind: 'PARTIAL' } : { kind: 'NONE' },
      attempted: false,
    };
  }

  const applied = applyRemembered(detail, remembered);
  if (applied.status === 'NONE') {
    return {
      selected: toSelected(detail, defaultOptionIds(detail)),
      note: '',
      quantity: 1,
      tip: { kind: 'NONE' },
      attempted: false,
    };
  }

  const note = applied.note ?? '';
  if (applied.status === 'PARTIAL') {
    return {
      selected: toSelected(detail, applied.optionIds),
      note,
      quantity: 1,
      tip: { kind: 'PARTIAL' },
      attempted: false,
    };
  }
  // FULL：沒有任何可套用的內容（無選項也無備註）時不顯示「已套用上次的選擇」
  const text = applied.labels.join('・') || (note !== '' ? note : '');
  return {
    selected: toSelected(detail, applied.optionIds),
    note,
    quantity: 1,
    tip: text === '' ? { kind: 'NONE' } : { kind: 'APPLIED', text },
    attempted: false,
  };
}

/**
 * 「恢復預設」：選項回到商品預設（§6.8）。由點餐記憶預填的備註一併清除（clearNote）；
 * 編輯購物車行時備註屬於該行，不清除。
 */
export function restoreDefaults(
  detail: ProductDetail,
  form: SheetForm,
  options: { clearNote: boolean },
): SheetForm {
  return {
    ...form,
    selected: toSelected(detail, defaultOptionIds(detail)),
    note: options.clearNote ? '' : form.note,
    tip: { kind: 'RESTORED' },
    attempted: false,
  };
}

/** 備註長度（以字數計，非 UTF-16 單位） */
export function noteLength(note: string): number {
  return Array.from(note).length;
}
