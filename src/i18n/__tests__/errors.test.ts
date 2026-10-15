import { describe, expect, it } from 'vitest';
import { errorMessage, errorMessageOf, errors } from '../strings/errors';

describe('errors 文案', () => {
  it('每個已知錯誤碼都有非空訊息', () => {
    for (const [code, message] of Object.entries(errors.byCode)) {
      expect(message.length, code).toBeGreaterThan(0);
      expect(errorMessage(code)).toBe(message);
    }
  });

  it('已知錯誤碼忽略伺服器 message；未知錯誤碼使用 fallback；都沒有則為通用訊息', () => {
    expect(errorMessage('SLOT_UNAVAILABLE', 'server says something')).toBe(
      '此時段已額滿，請選擇其他時段',
    );
    expect(errorMessage('BRAND_NEW_CODE', '伺服器訊息')).toBe('伺服器訊息');
    expect(errorMessage('BRAND_NEW_CODE')).toBe(errors.generic);
    expect(errorMessage(undefined)).toBe(errors.generic);
    expect(errorMessage('toString')).toBe(errors.generic);
  });

  it('errorMessageOf：依 code；非 API 錯誤不暴露技術訊息', () => {
    expect(errorMessageOf({ code: 'SERVICE_UNAVAILABLE', message: 'x' })).toBe(
      errors.byCode.SERVICE_UNAVAILABLE,
    );
    expect(errorMessageOf({ code: 'NEW', message: '新訊息' })).toBe('新訊息');
    expect(errorMessageOf(new TypeError('Cannot read properties of undefined'))).toBe(
      errors.generic,
    );
    expect(errorMessageOf('oops', '自訂降級')).toBe('自訂降級');
  });

  it('需帶入數值的變體', () => {
    expect(errors.otpInvalidRemaining(2)).toBe('驗證碼不正確，還可以再試 2 次');
    expect(errors.stockInsufficient('雙人分享餐', 2, 3)).toBe(
      '雙人分享餐　今日只剩 2 份（已選 3 份）',
    );
    expect(errors.minOrderShortfall(1250)).toBe('還差 NT$ 1,250 可外送');
  });
});
