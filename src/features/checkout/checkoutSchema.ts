// src/features/checkout/checkoutSchema.ts
import { z } from 'zod';
import {
  CITIZEN_CERT_RE, DONATE_CODE_RE, MOBILE_BARCODE_RE, PHONE_RE, isValidTaxId, normalizePhone,
} from '@/domain/validation';

const phone = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(PHONE_RE, '請輸入正確的手機號碼（09 開頭，共 10 碼）'));

export const invoiceSchema = z
  .object({
    type: z.enum(['PAPER', 'MOBILE_BARCODE', 'CITIZEN_CERT', 'DONATION', 'COMPANY']),
    carrierCode: z.string().trim().optional(),
    taxId: z.string().trim().optional(),
    buyerName: z.string().trim().max(60, '抬頭最多 60 字').optional(),
    donateCode: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (v.type === 'MOBILE_BARCODE' && !MOBILE_BARCODE_RE.test(v.carrierCode ?? '')) {
      fail('carrierCode', '手機條碼格式不正確（例：/ABC1234）');
    }
    if (v.type === 'CITIZEN_CERT' && !CITIZEN_CERT_RE.test(v.carrierCode ?? '')) {
      fail('carrierCode', '自然人憑證條碼格式不正確');
    }
    if (v.type === 'DONATION' && !DONATE_CODE_RE.test(v.donateCode ?? '')) {
      fail('donateCode', '愛心碼為 3～7 位數字');
    }
    if (v.type === 'COMPANY' && !isValidTaxId(v.taxId ?? '')) {
      fail('taxId', '統一編號格式不正確');
    }
  });

export const contactSchema = z.object({
  name: z.string().trim().min(1, '請輸入姓名（最多 20 字）').max(20, '請輸入姓名（最多 20 字）'),
  phone,
});

export const noteSchema = z.string().trim().max(100, '備註最多 100 字');

// ───────── 結帳表單（PG-04；以下為本頁新增，既有匯出維持不變） ─────────

const ORDER_TYPES = ['PICKUP', 'DELIVERY', 'DINE_IN'] as const;
const PAYMENT_METHODS = ['CASH', 'CREDIT_CARD', 'LINE_PAY', 'JKOPAY'] as const;
const INVOICE_TYPES = ['PAPER', 'MOBILE_BARCODE', 'CITIZEN_CERT', 'DONATION', 'COMPANY'] as const;

/** VR-10：桌號 1～10 字元英數字 */
export const TABLE_NO_RE = /^[A-Za-z0-9]{1,10}$/;
/** 郵遞區號（3 碼） */
export const ZIP_RE = /^\d{3}$/;

/** 結帳表單欄位（全部為字串 / 布林，便於與 React Hook Form 與 sessionStorage 草稿往返） */
export const checkoutFormSchema = z
  .object({
    orderType: z.enum(ORDER_TYPES),
    /** ASAP 盡快；SCHEDULED 預約 */
    scheduleMode: z.enum(['ASAP', 'SCHEDULED']),
    /** 預約時段的 ISO 時間；'' = 尚未選擇 */
    scheduledAt: z.string(),
    contactName: z.string(),
    contactPhone: z.string(),
    rememberMe: z.boolean(),
    /** 會員地址簿的 id；'' = 手動填寫 */
    addressId: z.string(),
    deliveryCity: z.string(),
    deliveryDistrict: z.string(),
    deliveryZip: z.string(),
    deliveryLine: z.string(),
    deliveryNote: z.string(),
    tableNo: z.string(),
    paymentMethod: z.union([z.enum(PAYMENT_METHODS), z.literal('')]),
    invoiceType: z.enum(INVOICE_TYPES),
    invoiceCarrierCode: z.string(),
    invoiceTaxId: z.string(),
    invoiceBuyerName: z.string(),
    invoiceDonateCode: z.string(),
    /** 已套用的折扣碼（轉大寫、去空白）；'' = 未使用 */
    couponCode: z.string(),
    note: z.string(),
    needUtensils: z.boolean(),
    marketingOptIn: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const fail = (path: keyof CheckoutFormValues, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    // 聯絡資訊：自取 / 外送必填；內用選填，但有填就要符合格式（FR-CK-03、VR-01、VR-02）
    const needContact = v.orderType !== 'DINE_IN';
    const name = v.contactName.trim();
    const phone = v.contactPhone.trim();
    if (needContact || name !== '') {
      const r = contactSchema.shape.name.safeParse(name);
      if (!r.success) fail('contactName', r.error.issues[0]?.message ?? '請輸入姓名（最多 20 字）');
    }
    if (needContact || phone !== '') {
      const r = contactSchema.shape.phone.safeParse(phone);
      if (!r.success) {
        fail('contactPhone', r.error.issues[0]?.message ?? '請輸入正確的手機號碼（09 開頭，共 10 碼）');
      }
    }

    // 外送地址（VR-05、VR-06、VR-07）
    if (v.orderType === 'DELIVERY') {
      if (v.deliveryCity.trim() === '') fail('deliveryCity', '請選擇縣市與行政區');
      if (v.deliveryDistrict.trim() === '' || !ZIP_RE.test(v.deliveryZip)) {
        fail('deliveryDistrict', '請選擇縣市與行政區');
      }
      const line = v.deliveryLine.trim();
      if (line.length < 5 || line.length > 100) fail('deliveryLine', '請輸入詳細地址（5～100 字）');
      if (v.deliveryNote.trim().length > 50) fail('deliveryNote', '外送備註最多 50 字');
    }

    // 桌號（VR-10）
    if (v.orderType === 'DINE_IN') {
      const table = v.tableNo.trim();
      if (table === '') fail('tableNo', '請輸入桌號');
      else if (!TABLE_NO_RE.test(table)) fail('tableNo', '找不到此桌號，請洽店員');
    }

    // 時段（VR-17）
    if (v.orderType !== 'DINE_IN' && v.scheduleMode === 'SCHEDULED' && v.scheduledAt === '') {
      fail('scheduledAt', '請選擇取餐時段');
    }

    if (v.paymentMethod === '') fail('paymentMethod', '請選擇付款方式');

    // 發票（VR-11～VR-14）：沿用 invoiceSchema
    const inv = invoiceSchema.safeParse({
      type: v.invoiceType,
      carrierCode: v.invoiceCarrierCode,
      taxId: v.invoiceTaxId,
      buyerName: v.invoiceBuyerName,
      donateCode: v.invoiceDonateCode,
    });
    if (!inv.success) {
      for (const issue of inv.error.issues) {
        const key = String(issue.path[0] ?? '');
        const map: Record<string, keyof CheckoutFormValues> = {
          carrierCode: 'invoiceCarrierCode',
          taxId: 'invoiceTaxId',
          buyerName: 'invoiceBuyerName',
          donateCode: 'invoiceDonateCode',
        };
        fail(map[key] ?? 'invoiceType', issue.message);
      }
    }

    // 訂單備註（VR-09）
    const n = noteSchema.safeParse(v.note);
    if (!n.success) fail('note', n.error.issues[0]?.message ?? '備註最多 100 字');
  });

export type CheckoutFormValues = z.infer<typeof checkoutFormSchema>;
