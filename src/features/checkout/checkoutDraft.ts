// src/features/checkout/checkoutDraft.ts —— 結帳草稿（07 §6.2 `zaiorder:v1:checkoutDraft`）
//
// 內容：表單欄位草稿 + Idempotency-Key + 結果未知時記下的送出內容（`unknownBodies`，含姓名與手機，與草稿同敏感度）。
// 存放於 sessionStorage（涵蓋重新整理）；觸控面板模式的 `appSessionStorage` 本身即為記憶體版，不寫入任何 Web Storage。
// 到 2xx 才作廢；觸控面板閒置重置時整份丟棄（FLOW-21、FLOW-24）。
import type { CheckoutKeyState } from '@/domain/idempotency';
import { EMPTY_KEY_STATE } from '@/domain/idempotency';
import type { CreateOrderRequest } from '@/domain/types';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import type { CheckoutFormValues } from './checkoutSchema';

export interface CheckoutDraft {
  form: Partial<CheckoutFormValues>;
  idempotencyKey: string | null;
  unknownBodies: CreateOrderRequest[];
  /** 由 QR（`?table=`）帶入的桌位權杖；重新整理後仍可還原內用桌號（FR-CK-05） */
  qrToken: string | null;
}

const emptyDraft = (): CheckoutDraft => ({
  form: {},
  idempotencyKey: EMPTY_KEY_STATE.idempotencyKey,
  unknownBodies: [],
  qrToken: null,
});

export const EMPTY_DRAFT: CheckoutDraft = emptyDraft();

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 只接受已知欄位且型別正確者（舊版或被竄改的草稿不得讓表單壞掉） */
function sanitizeForm(raw: unknown): Partial<CheckoutFormValues> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  const strings = [
    'orderType',
    'scheduleMode',
    'scheduledAt',
    'contactName',
    'contactPhone',
    'addressId',
    'deliveryCity',
    'deliveryDistrict',
    'deliveryZip',
    'deliveryLine',
    'deliveryNote',
    'tableNo',
    'paymentMethod',
    'invoiceType',
    'invoiceCarrierCode',
    'invoiceTaxId',
    'invoiceBuyerName',
    'invoiceDonateCode',
    'couponCode',
    'note',
  ] as const;
  for (const key of strings) {
    const value = raw[key];
    if (typeof value === 'string') out[key] = value;
  }
  for (const key of ['rememberMe', 'needUtensils', 'marketingOptIn'] as const) {
    const value = raw[key];
    if (typeof value === 'boolean') out[key] = value;
  }
  return out as Partial<CheckoutFormValues>;
}

export function loadDraft(): CheckoutDraft {
  try {
    const text = appSessionStorage.getItem(STORAGE_KEYS.checkoutDraft);
    if (text === null) return emptyDraft();
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return emptyDraft();
    const key = parsed.idempotencyKey;
    const bodies = parsed.unknownBodies;
    const qr = parsed.qrToken;
    return {
      qrToken: typeof qr === 'string' && qr !== '' ? qr : null,
      form: sanitizeForm(parsed.form),
      idempotencyKey: typeof key === 'string' && key !== '' ? key : null,
      unknownBodies: Array.isArray(bodies)
        ? bodies.filter((b): b is CreateOrderRequest => isRecord(b) && Array.isArray(b.items))
        : [],
    };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(draft: CheckoutDraft): void {
  try {
    appSessionStorage.setItem(STORAGE_KEYS.checkoutDraft, JSON.stringify(draft));
  } catch {
    /* 儲存不可用時降級為不保存草稿，不影響結帳 */
  }
}

/** 2xx 之後與觸控面板重置時呼叫：連同 Key 與記下的送出內容一併清除 */
export function clearDraft(): void {
  try {
    appSessionStorage.removeItem(STORAGE_KEYS.checkoutDraft);
    // 桌位權杖與草稿同生命週期：訂單成立或重置後，下一次點餐需重新掃描
    appSessionStorage.removeItem(STORAGE_KEYS.table);
  } catch {
    /* 同上 */
  }
}

export function keyStateOf(draft: CheckoutDraft): CheckoutKeyState {
  return { idempotencyKey: draft.idempotencyKey, unknownBodies: draft.unknownBodies };
}

/**
 * 是否有「結果未知、尚未確認」的送出（草稿內有記下的送出內容）。
 * 觸控面板的閒置警示據此多顯示一行「上一筆訂單結果尚未確認，請洽櫃檯確認」（FLOW-21、FLOW-24）。
 */
export function hasUnconfirmedSubmission(): boolean {
  return loadDraft().unknownBodies.length > 0;
}
