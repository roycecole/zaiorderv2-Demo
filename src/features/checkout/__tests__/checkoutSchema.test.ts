// 結帳表單驗證（VR-01、VR-02、VR-05～VR-07、VR-09～VR-14、VR-17）與請求建構
import { describe, expect, it } from 'vitest';
import { buildCreateOrderRequest } from '../buildRequest';
import { checkoutFormSchema, checkoutValuesFor } from '../checkoutSchema';
import type { CheckoutFormValues } from '../checkoutSchema';
import { formatPhoneInput, normalizeCouponInput } from '../checkoutHelpers';
import { LUROU, TEA } from './fixtures';

const base: CheckoutFormValues = {
  orderType: 'PICKUP',
  scheduleMode: 'ASAP',
  scheduledAt: '',
  contactName: '王小明',
  contactPhone: '0912-345-678',
  rememberMe: false,
  addressId: '',
  deliveryCity: '',
  deliveryDistrict: '',
  deliveryZip: '',
  deliveryLine: '',
  deliveryNote: '',
  tableNo: '',
  paymentMethod: 'CASH',
  invoiceType: 'PAPER',
  invoiceCarrierCode: '',
  invoiceTaxId: '',
  invoiceBuyerName: '',
  invoiceDonateCode: '',
  couponCode: '',
  note: '',
  needUtensils: false,
  marketingOptIn: false,
};

function errorsOf(over: Partial<CheckoutFormValues>): Record<string, string> {
  const r = checkoutFormSchema.safeParse({ ...base, ...over });
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
}

describe('聯絡資訊', () => {
  it('自取：姓名與手機必填', () => {
    const e = errorsOf({ contactName: '  ', contactPhone: '' });
    expect(e.contactName).toBe('請輸入姓名（最多 20 字）');
    expect(e.contactPhone).toBe('請輸入正確的手機號碼（09 開頭，共 10 碼）');
  });

  it('手機去除連字號與空白後驗證（VR-01）', () => {
    expect(errorsOf({ contactPhone: '0912 345 678' })).toEqual({});
    expect(errorsOf({ contactPhone: '0812345678' }).contactPhone).toBeDefined();
    expect(errorsOf({ contactPhone: '091234567' }).contactPhone).toBeDefined();
  });

  it('姓名最多 20 字（VR-02）', () => {
    expect(errorsOf({ contactName: '王'.repeat(21) }).contactName).toBeDefined();
    expect(errorsOf({ contactName: '王'.repeat(20) })).toEqual({});
  });

  it('內用：聯絡資訊選填，但有填就要符合格式', () => {
    expect(
      errorsOf({ orderType: 'DINE_IN', tableNo: 'A3', contactName: '', contactPhone: '' }),
    ).toEqual({});
    expect(
      errorsOf({ orderType: 'DINE_IN', tableNo: 'A3', contactName: '', contactPhone: '123' })
        .contactPhone,
    ).toBeDefined();
  });
});

describe('外送、桌號與時段', () => {
  const delivery = {
    orderType: 'DELIVERY' as const,
    deliveryCity: '臺北市',
    deliveryDistrict: '大安區',
    deliveryZip: '106',
    deliveryLine: '示範路 5 號 3 樓',
  };

  it('外送地址：縣市 / 行政區必選、詳細地址 5～100 字、備註 ≤ 50 字', () => {
    expect(errorsOf(delivery)).toEqual({});
    expect(errorsOf({ ...delivery, deliveryLine: '短' }).deliveryLine).toBe(
      '請輸入詳細地址（5～100 字）',
    );
    expect(errorsOf({ ...delivery, deliveryZip: '' }).deliveryDistrict).toBe('請選擇縣市與行政區');
    expect(errorsOf({ ...delivery, deliveryNote: 'a'.repeat(51) }).deliveryNote).toBe(
      '外送備註最多 50 字',
    );
  });

  it('內用：桌號選填（可留空 / 全空白），有填才驗 1～10 字元英數字（VR-10）', () => {
    expect(errorsOf({ orderType: 'DINE_IN', tableNo: '' })).toEqual({});
    expect(errorsOf({ orderType: 'DINE_IN', tableNo: '   ' })).toEqual({});
    expect(errorsOf({ orderType: 'DINE_IN', tableNo: 'A-3' }).tableNo).toBe(
      '找不到此桌號，請洽店員',
    );
    expect(errorsOf({ orderType: 'DINE_IN', tableNo: 'A'.repeat(11) }).tableNo).toBe(
      '找不到此桌號，請洽店員',
    );
    expect(errorsOf({ orderType: 'DINE_IN', tableNo: 'A3' })).toEqual({});
  });

  it('自取 / 外送不檢查桌號格式（欄位只屬於內用）', () => {
    expect(errorsOf({ orderType: 'PICKUP', tableNo: 'A-3' })).toEqual({});
  });

  it('觸控面板沒有桌號欄：checkoutValuesFor 把桌號視為空，一般模式留下的殘值不參與驗證', () => {
    // 一般模式輸入了不符格式的桌號（A#3）後，Demo 面板即時切到觸控面板
    const stale: CheckoutFormValues = { ...base, orderType: 'DINE_IN', tableNo: 'A#3' };
    expect(checkoutFormSchema.safeParse(stale).success).toBe(false);

    const kiosk = checkoutValuesFor(stale, true);
    expect(kiosk.tableNo).toBe('');
    expect(checkoutFormSchema.safeParse(kiosk).success).toBe(true);
    // 表單本身的值不改：切回一般模式時殘值仍在，也仍會被驗證
    expect(stale.tableNo).toBe('A#3');
    expect(checkoutValuesFor(stale, false)).toBe(stale);
    expect(checkoutFormSchema.safeParse(checkoutValuesFor(stale, false)).success).toBe(false);
    // 其他欄位的錯誤不受影響（只忽略桌號）
    const other = checkoutValuesFor({ ...stale, paymentMethod: '' }, true);
    expect(checkoutFormSchema.safeParse(other).success).toBe(false);
  });

  it('預約必須選擇時段（VR-17）', () => {
    expect(errorsOf({ scheduleMode: 'SCHEDULED', scheduledAt: '' }).scheduledAt).toBe(
      '請選擇取餐時段',
    );
    expect(
      errorsOf({ scheduleMode: 'SCHEDULED', scheduledAt: '2026-10-14T12:30:00+08:00' }),
    ).toEqual({});
  });
});

describe('付款、發票與備註', () => {
  it('付款方式必選', () => {
    expect(errorsOf({ paymentMethod: '' }).paymentMethod).toBe('請選擇付款方式');
  });

  it('發票：手機條碼 / 自然人憑證 / 愛心碼 / 統編格式（VR-11～VR-14）', () => {
    expect(errorsOf({ invoiceType: 'MOBILE_BARCODE', invoiceCarrierCode: '/ABC1234' })).toEqual({});
    expect(
      errorsOf({ invoiceType: 'MOBILE_BARCODE', invoiceCarrierCode: 'ABC1234' }).invoiceCarrierCode,
    ).toBe('手機條碼格式不正確（例：/ABC1234）');
    expect(
      errorsOf({ invoiceType: 'CITIZEN_CERT', invoiceCarrierCode: 'AB12345678901234' }),
    ).toEqual({});
    expect(
      errorsOf({ invoiceType: 'CITIZEN_CERT', invoiceCarrierCode: '12' }).invoiceCarrierCode,
    ).toBe('自然人憑證條碼格式不正確');
    expect(errorsOf({ invoiceType: 'DONATION', invoiceDonateCode: '168001' })).toEqual({});
    expect(errorsOf({ invoiceType: 'DONATION', invoiceDonateCode: '12' }).invoiceDonateCode).toBe(
      '愛心碼為 3～7 位數字',
    );
  });

  it('UAT-12：統編 04595258 錯誤、04595257 通過', () => {
    expect(errorsOf({ invoiceType: 'COMPANY', invoiceTaxId: '04595258' }).invoiceTaxId).toBe(
      '統一編號格式不正確',
    );
    expect(errorsOf({ invoiceType: 'COMPANY', invoiceTaxId: '04595257' })).toEqual({});
  });

  it('訂單備註 ≤ 100 字（VR-09）', () => {
    expect(errorsOf({ note: 'a'.repeat(101) }).note).toBe('備註最多 100 字');
  });
});

describe('輸入格式化', () => {
  it('手機輸入自動插入連字號，儲存時移除', () => {
    expect(formatPhoneInput('0912345678')).toBe('0912-345-678');
    expect(formatPhoneInput('09123')).toBe('0912-3');
    expect(formatPhoneInput('abc0912-345-6789999')).toBe('0912-345-678');
  });

  it('折扣碼轉大寫、去空白（VR-15）', () => {
    expect(normalizeCouponInput(' welcome 50 ')).toBe('WELCOME50');
  });
});

describe('buildCreateOrderRequest', () => {
  it('自取：手機移除連字號、品項備註去空白、不含外送 / 桌號 / 折扣碼', () => {
    const req = buildCreateOrderRequest({
      values: { ...base, note: ' 分開裝 ' },
      lines: [{ ...LUROU, note: ' 不要蔥 ' }, TEA],
      expectedTotal: 92,
    });
    expect(req).toEqual({
      orderType: 'PICKUP',
      items: [
        { productId: 'prd_lurou', quantity: 1, optionIds: ['opt_bowl_l'], note: '不要蔥' },
        { productId: 'prd_tea', quantity: 1, optionIds: [] },
      ],
      scheduledAt: null,
      contact: { name: '王小明', phone: '0912345678' },
      paymentMethod: 'CASH',
      invoice: { type: 'PAPER' },
      needUtensils: false,
      marketingOptIn: false,
      note: '分開裝',
      expectedTotal: 92,
    });
  });

  it('外送 + 預約 + 折扣碼 + 統編發票；內用帶 qrToken', () => {
    const d = buildCreateOrderRequest({
      values: {
        ...base,
        orderType: 'DELIVERY',
        scheduleMode: 'SCHEDULED',
        scheduledAt: '2026-10-14T13:00:00+08:00',
        deliveryCity: '臺北市',
        deliveryDistrict: '大安區',
        deliveryZip: '106',
        deliveryLine: ' 示範路 5 號 ',
        deliveryNote: '請按電鈴',
        invoiceType: 'COMPANY',
        invoiceTaxId: '04595257',
        invoiceBuyerName: '某某公司',
        couponCode: 'LUNCH10',
      },
      lines: [LUROU],
      expectedTotal: 100,
    });
    expect(d.scheduledAt).toBe('2026-10-14T13:00:00+08:00');
    expect(d.delivery).toEqual({
      city: '臺北市',
      district: '大安區',
      zipCode: '106',
      line: '示範路 5 號',
      note: '請按電鈴',
    });
    expect(d.invoice).toEqual({ type: 'COMPANY', taxId: '04595257', buyerName: '某某公司' });
    expect(d.couponCode).toBe('LUNCH10');

    const t = buildCreateOrderRequest({
      values: {
        ...base,
        orderType: 'DINE_IN',
        tableNo: 'a3',
        scheduleMode: 'SCHEDULED',
        scheduledAt: 'x',
      },
      lines: [LUROU],
      expectedTotal: 67,
      qrToken: 'QR-A3',
    });
    expect(t.scheduledAt).toBeNull(); // 內用不預約
    expect(t.dineIn).toEqual({ tableNo: 'A3', qrToken: 'QR-A3' });
    expect(t.delivery).toBeUndefined();
  });

  it('內用沒有桌號：請求不帶 dineIn（空字串 / 全空白視同未提供）', () => {
    const none = buildCreateOrderRequest({
      values: { ...base, orderType: 'DINE_IN', tableNo: '', contactName: '', contactPhone: '' },
      lines: [LUROU],
      expectedTotal: 67,
    });
    expect(none.orderType).toBe('DINE_IN');
    expect(none.dineIn).toBeUndefined();
    expect('dineIn' in none).toBe(false);
    expect(none.contact).toEqual({});

    const blank = buildCreateOrderRequest({
      values: { ...base, orderType: 'DINE_IN', tableNo: '   ' },
      lines: [LUROU],
      expectedTotal: 67,
      qrToken: '  ',
    });
    expect('dineIn' in blank).toBe(false);
  });

  it('內用手動輸入桌號：只帶 tableNo（轉大寫、無 qrToken）；非內用不帶 dineIn', () => {
    const manual = buildCreateOrderRequest({
      values: { ...base, orderType: 'DINE_IN', tableNo: ' b2 ' },
      lines: [LUROU],
      expectedTotal: 67,
    });
    expect(manual.dineIn).toEqual({ tableNo: 'B2' });
    expect('qrToken' in (manual.dineIn ?? {})).toBe(false);

    const pickup = buildCreateOrderRequest({
      values: { ...base, orderType: 'PICKUP', tableNo: 'A3' },
      lines: [LUROU],
      expectedTotal: 67,
      qrToken: 'QR-A3',
    });
    expect('dineIn' in pickup).toBe(false);
  });
});
