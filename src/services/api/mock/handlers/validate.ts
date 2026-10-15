// src/services/api/mock/handlers/validate.ts —— 請求格式驗證（400 VALIDATION_FAILED；業務規則另由 evaluateOrder 以 checks[] 回報）
import { PHONE_RE, normalizePhone } from '@/domain/validation';
import type {
  ApiErrorDetail, CreateOrderRequest, OrderLineInput, OrderType, PaymentMethod, QuoteRequest,
} from '@/domain/types';
import { validationFailed } from '../errors';

const ORDER_TYPES: ReadonlyArray<OrderType> = ['PICKUP', 'DELIVERY', 'DINE_IN'];
const PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = ['CASH', 'CREDIT_CARD', 'LINE_PAY', 'JKOPAY'];
const INVOICE_TYPES = ['PAPER', 'MOBILE_BARCODE', 'CITIZEN_CERT', 'DONATION', 'COMPANY'];

/** Idempotency-Key：UUID v4 或 ULID，長度 ≤ 64（06 §1.4）；Mock 放寬為英數、底線與連字號 */
const KEY_RE = /^[0-9A-Za-z_-]{8,64}$/;

function lineDetails(items: unknown, field = 'items'): ApiErrorDetail[] {
  const out: ApiErrorDetail[] = [];
  if (!Array.isArray(items) || items.length === 0) {
    return [{ field, message: '請至少選擇一項餐點' }];
  }
  items.forEach((raw: unknown, i) => {
    const l = raw as Partial<OrderLineInput> | null;
    if (l === null || typeof l !== 'object') {
      out.push({ field: `${field}[${i}]`, message: '品項格式不正確' });
      return;
    }
    if (typeof l.productId !== 'string' || l.productId === '') {
      out.push({ field: `${field}[${i}].productId`, message: '缺少商品' });
    }
    if (typeof l.quantity !== 'number' || !Number.isInteger(l.quantity) || l.quantity < 1) {
      out.push({ field: `${field}[${i}].quantity`, message: '數量須為 1 以上的整數' });
    }
    if (!Array.isArray(l.optionIds) || l.optionIds.some((x) => typeof x !== 'string')) {
      out.push({ field: `${field}[${i}].optionIds`, message: '選項格式不正確' });
    }
    if (l.note !== undefined && (typeof l.note !== 'string' || l.note.trim().length > 50)) {
      out.push({ field: `${field}[${i}].note`, message: '備註最多 50 字' });
    }
  });
  return out;
}

function commonDetails(req: { orderType?: unknown; scheduledAt?: unknown }): ApiErrorDetail[] {
  const out: ApiErrorDetail[] = [];
  if (!ORDER_TYPES.includes(req.orderType as OrderType)) {
    out.push({ field: 'orderType', message: '請選擇取餐方式' });
  }
  if (req.scheduledAt !== null && req.scheduledAt !== undefined) {
    if (typeof req.scheduledAt !== 'string' || !Number.isFinite(Date.parse(req.scheduledAt))) {
      out.push({ field: 'scheduledAt', message: '預約時間格式不正確' });
    }
  }
  return out;
}

export function validateQuoteRequest(req: QuoteRequest): void {
  const details = [...commonDetails(req), ...lineDetails(req.items)];
  if (req.zipCode !== undefined && !/^\d{3}$/.test(req.zipCode)) {
    details.push({ field: 'zipCode', message: '郵遞區號為 3 碼數字' });
  }
  if (req.couponCode !== undefined && typeof req.couponCode !== 'string') {
    details.push({ field: 'couponCode', message: '折扣碼格式不正確' });
  }
  if (details.length > 0) throw validationFailed(details);
}

export function validateCreateRequest(req: CreateOrderRequest, key: string): void {
  const details = [...commonDetails(req), ...lineDetails(req.items)];
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    details.push({ field: 'Idempotency-Key', message: 'Idempotency-Key 缺少或格式不正確' });
  }
  const contact = req.contact ?? {};
  const name = contact.name?.trim() ?? '';
  const phone = normalizePhone(contact.phone ?? '');
  if (req.orderType === 'PICKUP' || req.orderType === 'DELIVERY') {
    if (name.length < 1 || name.length > 20) {
      details.push({ field: 'contact.name', message: '請輸入姓名（最多 20 字）' });
    }
    if (!PHONE_RE.test(phone)) {
      details.push({ field: 'contact.phone', message: '請輸入正確的手機號碼（09 開頭，共 10 碼）' });
    }
  } else {
    if (name.length > 20) details.push({ field: 'contact.name', message: '請輸入姓名（最多 20 字）' });
    if (phone !== '' && !PHONE_RE.test(phone)) {
      details.push({ field: 'contact.phone', message: '請輸入正確的手機號碼（09 開頭，共 10 碼）' });
    }
  }
  if (req.orderType === 'DELIVERY') {
    const d = req.delivery;
    if (d === undefined) {
      details.push({ field: 'delivery', message: '請填寫外送地址' });
    } else {
      if (!d.city || !d.district) details.push({ field: 'delivery.district', message: '請選擇縣市與行政區' });
      if (!/^\d{3}$/.test(d.zipCode ?? '')) details.push({ field: 'delivery.zipCode', message: '郵遞區號為 3 碼數字' });
      const line = d.line?.trim() ?? '';
      if (line.length < 5 || line.length > 100) {
        details.push({ field: 'delivery.line', message: '請輸入詳細地址（5～100 字）' });
      }
      if (d.note !== undefined && d.note.length > 50) {
        details.push({ field: 'delivery.note', message: '外送備註最多 50 字' });
      }
    }
  }
  // 內用可以沒有桌號：dineIn、tableNo、qrToken 皆可省略；有提供時是否為店家桌位由 evaluateOrder 以 TABLE_NOT_FOUND 回報
  if (req.dineIn !== undefined) {
    const d = req.dineIn as unknown;
    if (d === null || typeof d !== 'object' || Array.isArray(d)) {
      details.push({ field: 'dineIn', message: '內用資料格式不正確' });
    } else {
      const { tableNo, qrToken } = d as { tableNo?: unknown; qrToken?: unknown };
      if (tableNo !== undefined && typeof tableNo !== 'string') {
        details.push({ field: 'dineIn.tableNo', message: '桌號格式不正確' });
      }
      if (qrToken !== undefined && typeof qrToken !== 'string') {
        details.push({ field: 'dineIn.qrToken', message: '桌位權杖格式不正確' });
      }
    }
  }
  if (!PAYMENT_METHODS.includes(req.paymentMethod)) {
    details.push({ field: 'paymentMethod', message: '請選擇付款方式' });
  }
  if (req.invoice === undefined || !INVOICE_TYPES.includes(req.invoice.type)) {
    details.push({ field: 'invoice.type', message: '請選擇發票類型' });
  }
  if (req.note !== undefined && req.note.trim().length > 100) {
    details.push({ field: 'note', message: '備註最多 100 字' });
  }
  if (typeof req.expectedTotal !== 'number' || !Number.isInteger(req.expectedTotal) || req.expectedTotal < 0) {
    details.push({ field: 'expectedTotal', message: '總額格式不正確' });
  }
  if (details.length > 0) throw validationFailed(details);
}
