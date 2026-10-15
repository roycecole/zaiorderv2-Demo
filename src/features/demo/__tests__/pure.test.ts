// Demo 面板用的純函式：時間穿梭預設、合法店家動作、情境摘要、品牌色提示
import { describe, expect, it } from 'vitest';
import { msOf } from '@/domain/taipeiTime';
import { DEFAULT_DEMO_STATE } from '@/services/api/mock/demoControl';
import { BRAND_PRESETS, brandHint, presetOf } from '../brand';
import { FAIL_CONTINUOUS } from '../constants';
import { armedItemCount, describeFailNext, describeScenario } from '../scenario';
import { legalStoreActions } from '../storeActions';
import {
  DEFAULT_CALENDAR,
  localInputToIso,
  nearestBusinessDate,
  nearestSunday,
  presetInstant,
  shiftInstant,
  toLocalInputValue,
} from '../timeTravel';
import { mergeActiveOrders } from '../useActiveOrders';

describe('時間穿梭預設（08 §5）', () => {
  // 2026-10-14（週三）
  const wed = msOf('2026-10-14', '09:00');

  it('預設時間落在最近一個營業日（含今日）', () => {
    expect(presetInstant('before-open', wed)).toBe('2026-10-14T10:30:00+08:00');
    expect(presetInstant('lunch', wed)).toBe('2026-10-14T12:00:00+08:00');
    expect(presetInstant('break', wed)).toBe('2026-10-14T14:30:00+08:00');
    expect(presetInstant('last-order', wed)).toBe('2026-10-14T20:40:00+08:00');
    expect(presetInstant('after-close', wed)).toBe('2026-10-14T21:30:00+08:00');
  });

  it('今天是週日時，營業日預設順延到週一；「週日」取最近的週日 12:00（含今日）', () => {
    const sun = msOf('2026-10-18', '09:00');
    expect(presetInstant('lunch', sun)).toBe('2026-10-19T12:00:00+08:00');
    expect(presetInstant('sunday', sun)).toBe('2026-10-18T12:00:00+08:00');
    expect(presetInstant('sunday', wed)).toBe('2026-10-18T12:00:00+08:00');
  });

  it('特殊公休日順延', () => {
    const calendar = { ...DEFAULT_CALENDAR, closedDates: new Set(['2026-10-14', '2026-10-15']) };
    expect(nearestBusinessDate('2026-10-14', calendar)).toBe('2026-10-16');
    expect(presetInstant('lunch', wed, calendar)).toBe('2026-10-16T12:00:00+08:00');
  });

  it('nearestSunday', () => {
    expect(nearestSunday('2026-10-14')).toBe('2026-10-18');
    expect(nearestSunday('2026-10-18')).toBe('2026-10-18');
  });

  it('快轉以目前時間為基準', () => {
    expect(shiftInstant(wed, 15)).toBe('2026-10-14T09:15:00+08:00');
    expect(shiftInstant(wed, 24 * 60)).toBe('2026-10-15T09:00:00+08:00');
  });

  it('datetime-local 的值視為台北時間；溢位與格式錯誤回傳 null', () => {
    expect(localInputToIso('2026-10-20T20:40')).toBe('2026-10-20T20:40:00+08:00');
    expect(localInputToIso('2026-02-31T10:00')).toBeNull();
    expect(localInputToIso('2026-10-20T24:00')).toBeNull();
    expect(localInputToIso('2026-10-20 20:40')).toBeNull();
    expect(localInputToIso('')).toBeNull();
    expect(toLocalInputValue(msOf('2026-10-14', '12:30'))).toBe('2026-10-14T12:30');
  });
});

describe('legalStoreActions（canTransition）', () => {
  it('依狀態與取餐方式只回傳合法的店家動作', () => {
    expect(legalStoreActions('PENDING_PAYMENT', 'PICKUP')).toEqual([]);
    expect(legalStoreActions('PENDING', 'PICKUP')).toEqual(['ACCEPT', 'REJECT']);
    expect(legalStoreActions('ACCEPTED', 'DINE_IN')).toEqual(['READY', 'REJECT']);
    expect(legalStoreActions('READY', 'PICKUP')).toEqual(['COMPLETE', 'REJECT']);
    expect(legalStoreActions('READY', 'DELIVERY')).toEqual(['DISPATCH', 'REJECT']);
    expect(legalStoreActions('DELIVERING', 'DELIVERY')).toEqual(['COMPLETE', 'REJECT']);
    expect(legalStoreActions('COMPLETED', 'PICKUP')).toEqual([]);
    expect(legalStoreActions('CANCELLED', 'PICKUP')).toEqual([]);
  });
});

describe('預備項目與情境摘要', () => {
  it('armedItemCount：他人搶購 / 變售完 / 時段額滿 + 針對送出訂單的失敗注入', () => {
    expect(armedItemCount(DEFAULT_DEMO_STATE)).toBe(0);
    expect(
      armedItemCount({
        ...DEFAULT_DEMO_STATE,
        raceOnNextCreate: {
          soldOutProductIds: ['a'],
          buy: [{ productId: 'b', quantity: 2 }],
          fillSlots: [{ startAt: '2026-10-14T12:30:00+08:00', leave: 0 }],
        },
        failNext: { target: 'orders.create', remaining: 1 },
      }),
    ).toBe(4);
    // 其他端點的失敗注入不屬於「下次送出」
    expect(
      armedItemCount({ ...DEFAULT_DEMO_STATE, failNext: { target: 'orders.pay', remaining: 1 } }),
    ).toBe(0);
  });

  it('describeFailNext：階段與持續失敗', () => {
    expect(describeFailNext({ target: 'orders.create', remaining: 1, phase: 'AFTER_COMMIT' })).toBe(
      '送出訂單（訂單已建立、回應遺失）將失敗 1 次',
    );
    expect(describeFailNext({ target: 'orders.quote', remaining: FAIL_CONTINUOUS })).toBe(
      '試算（報價）持續失敗',
    );
  });

  it('describeScenario：預設值為空；非預設才列出', () => {
    expect(describeScenario(DEFAULT_DEMO_STATE)).toEqual([]);
    expect(
      describeScenario({
        ...DEFAULT_DEMO_STATE,
        clockOverride: '2026-10-14T20:40:00+08:00',
        menuProfile: 'MINIMAL',
        themeOverride: '#FACC15',
        autoSimulate: false,
        speed: 5,
      }),
    ).toEqual([
      '模擬時間 10/14（三） 20:40',
      '菜單：精簡',
      '主題色 #FACC15',
      '自動模擬已關閉',
      '速度 5×',
    ]);
  });
});

describe('品牌色', () => {
  it('7 組預設，且檸檬黃的主色上文字為深色', () => {
    expect(BRAND_PRESETS).toHaveLength(7);
    const yellow = brandHint('#FACC15');
    expect(yellow?.onBrand).toBe('dark');
    expect(yellow?.onBrandRatio).toBeGreaterThanOrEqual(4.5);
    expect(yellow?.lowOnWhite).toBe(true);
    expect(brandHint('#D93A22')?.onBrand).toBe('white');
  });

  it('所有預設品牌色的主色上文字對比 ≥ 4.5', () => {
    for (const p of BRAND_PRESETS) {
      const hint = brandHint(p.hex);
      expect(hint, p.key).not.toBeNull();
      expect(hint?.onBrandRatio ?? 0, p.key).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('無效輸入回傳 null；presetOf 不分大小寫', () => {
    expect(brandHint('red')).toBeNull();
    expect(brandHint('')).toBeNull();
    expect(presetOf('#2e7d4f')?.name).toBe('抹茶綠');
    expect(presetOf(null)).toBeUndefined();
  });
});

describe('mergeActiveOrders', () => {
  const o = (id: string, status: 'PENDING' | 'COMPLETED', placedAt: string) =>
    ({ id, label: id, status, orderType: 'PICKUP', placedAt }) as const;

  it('去重、略過已結束、最新的在前', () => {
    const merged = mergeActiveOrders(
      [
        o('a', 'PENDING', '2026-10-14T12:00:00+08:00'),
        o('done', 'COMPLETED', '2026-10-14T13:00:00+08:00'),
      ],
      [
        o('a', 'PENDING', '2026-10-14T12:00:00+08:00'),
        o('b', 'PENDING', '2026-10-14T12:30:00+08:00'),
      ],
    );
    expect(merged.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
