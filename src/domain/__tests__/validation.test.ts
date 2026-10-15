// 01 §7 驗證規則 VR-01、VR-11～VR-15
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CITIZEN_CERT_RE,
  COUPON_CODE_RE,
  DONATE_CODE_RE,
  MOBILE_BARCODE_RE,
  PHONE_RE,
  isValidTaxId,
  normalizePhone,
} from '../validation';

describe('VR-01 手機號碼', () => {
  it('normalizePhone 去除空白與連字號', () => {
    expect(normalizePhone('0912-345-678')).toBe('0912345678');
    expect(normalizePhone('0912-345 678')).toBe('0912345678');
    expect(normalizePhone(' 0912 345 678 ')).toBe('0912345678');
    expect(normalizePhone('0912\t345\n678')).toBe('0912345678');
    expect(normalizePhone('0912345678')).toBe('0912345678');
  });

  it('09 開頭、共 10 碼才有效', () => {
    expect(PHONE_RE.test('0912345678')).toBe(true);
    expect(PHONE_RE.test(normalizePhone('0912-345-678'))).toBe(true);
    for (const bad of [
      '0812345678',
      '091234567',
      '09123456789',
      '09123456a8',
      '',
      '0912-345-678',
      '0912345678\n',
    ]) {
      expect(PHONE_RE.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('VR-11 統一編號', () => {
  it('已知有效：04595257、10458575', () => {
    expect(isValidTaxId('04595257')).toBe(true);
    expect(isValidTaxId('10458575')).toBe(true);
  });

  it('已知無效與格式不符（長度、非數字、空字串）', () => {
    for (const bad of [
      '04595258',
      '12345678',
      '1234567',
      '123456789',
      '0459525a',
      '',
      ' 04595257',
      '04595257 ',
    ]) {
      expect(isValidTaxId(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  /** 獨立重寫的檢查碼：權重 1,2,1,2,1,2,4,1，乘積的十位數與個位數相加 */
  const checksum = (id: string): number => {
    const w = [1, 2, 1, 2, 1, 2, 4, 1];
    return w.reduce((s, weight, i) => {
      const p = Number(id[i]) * weight;
      return s + Math.floor(p / 10) + (p % 10);
    }, 0);
  };

  it('2023/04/01 新規則：S 能被 5 整除即合法（含 S 不能被 10 整除者）', () => {
    let found: string | undefined;
    for (let n = 0; n < 100_000 && !found; n++) {
      const id = String(n).padStart(8, '0');
      const s = checksum(id);
      if (s % 5 === 0 && s % 10 !== 0) found = id;
    }
    expect(found).toBeDefined();
    expect(isValidTaxId(found as string)).toBe(true);
  });

  it('第 7 碼為 7 時，S + 1 能被 5 整除亦合法；其他第 7 碼不適用此規則', () => {
    let with7: string | undefined;
    let without7: string | undefined;
    for (let n = 0; n < 1_000_000 && (!with7 || !without7); n++) {
      const id = String(n).padStart(8, '0');
      const s = checksum(id);
      if (s % 5 === 0 || (s + 1) % 5 !== 0) continue;
      if (id[6] === '7') with7 ??= id;
      else without7 ??= id;
    }
    expect(with7).toBeDefined();
    expect(isValidTaxId(with7 as string)).toBe(true);
    expect(without7).toBeDefined();
    expect(isValidTaxId(without7 as string)).toBe(false);
  });

  it('性質：與獨立實作的規則一致（任意 8 碼數字）', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{8}$/), (id) => {
        const s = checksum(id);
        expect(isValidTaxId(id)).toBe(s % 5 === 0 || (id[6] === '7' && (s + 1) % 5 === 0));
      }),
      { numRuns: 2000 },
    );
  });

  it('性質：任何非 8 碼數字的字串一律無效', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), (s) => {
        fc.pre(!/^\d{8}$/.test(s));
        expect(isValidTaxId(s)).toBe(false);
      }),
    );
  });
});

describe('VR-12 手機條碼載具', () => {
  it('/ 開頭加 7 碼大寫英數與 . + -', () => {
    for (const ok of ['/ABC1234', '/0000000', '/A.B+C-1', '/ZZZZZZZ'])
      expect(MOBILE_BARCODE_RE.test(ok), ok).toBe(true);
  });
  it('小寫、長度不符、缺少斜線、不允許的字元無效', () => {
    for (const bad of [
      '/abc1234',
      '/ABC123',
      '/ABC12345',
      'ABC12345',
      '/ABC 123',
      '/ABC_123',
      '/ABC1234\n',
    ]) {
      expect(MOBILE_BARCODE_RE.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('VR-13 自然人憑證條碼', () => {
  it('2 碼大寫英文 + 14 碼數字', () => {
    expect(CITIZEN_CERT_RE.test('AB12345678901234')).toBe(true);
  });
  it('其他格式無效', () => {
    for (const bad of [
      'ab12345678901234',
      'A112345678901234',
      'AB1234567890123',
      'AB123456789012345',
      'ABC2345678901234',
    ]) {
      expect(CITIZEN_CERT_RE.test(bad), bad).toBe(false);
    }
  });
});

describe('VR-14 愛心碼', () => {
  it('3～7 位數字', () => {
    for (const ok of ['168001', '123', '1234567']) expect(DONATE_CODE_RE.test(ok), ok).toBe(true);
  });
  it('2 位、8 位、含非數字無效', () => {
    for (const bad of ['12', '12345678', '12a45', '', ' 168'])
      expect(DONATE_CODE_RE.test(bad), bad).toBe(false);
  });
});

describe('VR-15 折扣碼', () => {
  it('4～20 碼大寫英數字（輸入前先轉大寫、去空白）', () => {
    for (const ok of ['WELCOME50', 'LUNCH10', 'FREESHIP', 'ABCD', 'A'.repeat(20)]) {
      expect(COUPON_CODE_RE.test(ok), ok).toBe(true);
    }
    expect(COUPON_CODE_RE.test(' welcome50 '.trim().toUpperCase())).toBe(true);
  });
  it('過短、過長、小寫、含符號無效', () => {
    for (const bad of ['ABC', 'A'.repeat(21), 'welcome50', 'WELCOME-50', 'WELCOME 50', '']) {
      expect(COUPON_CODE_RE.test(bad), bad).toBe(false);
    }
  });
});
