// 顯示格式與個資遮罩：金額（03 §9 文案用 NT$）、店家時區（Asia/Taipei）日期時間、手機遮罩
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  formatAmount,
  formatDate,
  formatDateTime,
  formatMonthDayWeek,
  formatPhone,
  formatTWD,
  formatTime,
  maskPhone,
  taipeiParts,
} from '../format';

describe('formatTWD / formatAmount', () => {
  it('千分位與 NT$ 前綴', () => {
    expect(formatTWD(0)).toBe('NT$ 0');
    expect(formatTWD(92)).toBe('NT$ 92');
    expect(formatTWD(1234)).toBe('NT$ 1,234');
    expect(formatTWD(1234567)).toBe('NT$ 1,234,567');
  });

  it('負數（折扣）顯示為 −NT$ 30（U+2212 減號）', () => {
    expect(formatTWD(-30)).toBe('−NT$ 30');
    expect(formatTWD(-1200)).toBe('−NT$ 1,200');
    expect(formatTWD(-30).startsWith('−')).toBe(true);
  });

  it('金額四捨五入為整數元；-0 不顯示負號', () => {
    expect(formatTWD(12.4)).toBe('NT$ 12');
    expect(formatTWD(12.6)).toBe('NT$ 13');
    expect(formatTWD(-0.2)).toBe('NT$ 0');
  });

  it('formatAmount 僅數字與千分位，不含幣別', () => {
    expect(formatAmount(1234)).toBe('1,234');
    expect(formatAmount(-5)).toBe('-5');
    expect(formatAmount(0)).toBe('0');
  });
});

describe('時間格式（店家時區 Asia/Taipei，UTC+8，無日光節約）', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('formatTime / formatDate：UTC 04:30 → 台北 12:30', () => {
    expect(formatTime('2026-10-14T04:30:00Z')).toBe('12:30');
    expect(formatDate('2026-10-14T04:30:00Z')).toBe('2026-10-14');
  });

  it('跨日：UTC 16:00 → 台北隔日 00:00；23:59 前仍為同日', () => {
    expect(formatTime('2026-10-14T16:00:00Z')).toBe('00:00');
    expect(formatDate('2026-10-14T16:00:00Z')).toBe('2026-10-15');
    expect(formatDate('2026-10-14T15:59:59Z')).toBe('2026-10-14');
    expect(formatTime('2026-10-14T15:59:59Z')).toBe('23:59');
  });

  it('接受含偏移的 ISO 字串、Date 與毫秒數', () => {
    const iso = '2026-10-14T12:30:00+08:00';
    expect(formatTime(iso)).toBe('12:30');
    expect(formatTime(new Date(iso))).toBe('12:30');
    expect(formatTime(Date.parse(iso))).toBe('12:30');
    expect(formatTime('2026-10-14T00:05:00+08:00')).toBe('00:05'); // 補零
  });

  it('formatMonthDayWeek：「10/14（三）」；週日為「日」', () => {
    expect(formatMonthDayWeek('2026-10-14T12:30:00+08:00')).toBe('10/14（三）');
    expect(formatMonthDayWeek('2026-10-18T12:00:00+08:00')).toBe('10/18（日）');
    expect(formatMonthDayWeek('2026-01-05T09:00:00+08:00')).toBe('1/5（一）');
  });

  it('formatDateTime：月日週 + 空白 + 時間', () => {
    // 注意：format.ts 的 JSDoc 範例寫成「10/14（三）12:30」（無空白），實作則以一個半形空白相連；
    // 規格（docs/）未定義此格式，這裡鎖定目前實作的行為，是否去掉空白待決定（見測試負責人回報）。
    expect(formatDateTime('2026-10-14T12:30:00+08:00')).toBe('10/14（三） 12:30');
    const x = '2026-10-14T12:30:00+08:00';
    expect(formatDateTime(x)).toBe(`${formatMonthDayWeek(x)} ${formatTime(x)}`);
  });

  it('taipeiParts 欄位與星期（0 = 週日）', () => {
    expect(taipeiParts(new Date('2026-10-14T12:30:00+08:00'))).toEqual({
      year: 2026,
      month: 10,
      day: 14,
      hour: 12,
      minute: 30,
      weekday: 3,
    });
    expect(taipeiParts(new Date('2026-12-31T23:59:00+08:00'))).toMatchObject({
      year: 2026,
      month: 12,
      day: 31,
      weekday: 4,
    });
    expect(taipeiParts(new Date('2026-12-31T16:00:00Z'))).toMatchObject({
      year: 2027,
      month: 1,
      day: 1,
      hour: 0,
    });
  });

  it('不依賴執行環境時區：切換 process.env.TZ 後輸出相同', () => {
    const instant = '2026-10-14T16:30:00Z';
    const expected = [formatTime(instant), formatDate(instant), formatDateTime(instant)];
    for (const tz of ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC', 'Asia/Taipei']) {
      process.env.TZ = tz;
      expect([formatTime(instant), formatDate(instant), formatDateTime(instant)], tz).toEqual(
        expected,
      );
    }
    expect(expected).toEqual(['00:30', '2026-10-15', '10/15（四） 00:30']);
  });

  it('性質：台北牆上時間 = UTC + 8 小時（與純算術一致）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), (ms) => {
        const shifted = new Date(ms + 8 * 3_600_000);
        const hh = String(shifted.getUTCHours()).padStart(2, '0');
        const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
        expect(formatTime(ms)).toBe(`${hh}:${mm}`);
        expect(formatDate(ms)).toBe(shifted.toISOString().slice(0, 10));
      }),
    );
  });
});

describe('手機遮罩與分組', () => {
  it('maskPhone：0912345678 → 0912***678', () => {
    expect(maskPhone('0912345678')).toBe('0912***678');
  });
  it('maskPhone：非 10 碼數字原樣回傳（不誤遮）', () => {
    expect(maskPhone('091234567')).toBe('091234567');
    expect(maskPhone('0912-345-678')).toBe('0912-345-678');
    expect(maskPhone('')).toBe('');
  });
  it('formatPhone：0912345678 → 0912 345 678；格式不符原樣回傳', () => {
    expect(formatPhone('0912345678')).toBe('0912 345 678');
    expect(formatPhone('0912 345 678')).toBe('0912 345 678');
    expect(formatPhone('02-2345-6789')).toBe('02-2345-6789');
  });
});
