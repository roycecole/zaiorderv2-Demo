// 07 §6.4 時鐘：全站唯一的「現在」來源、Demo 時間穿梭（錨點繼續走時）、systemClock（鍵盤提醒用真實時間）
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { createOffsetClock, getClock, setClock, systemClock } from './clock';
import type { Clock } from './clock';

afterEach(() => {
  setClock(systemClock);
  vi.useRealTimers();
});

describe('systemClock / getClock', () => {
  it('預設 getClock() 就是 systemClock，並回傳目前（可被假計時器控制）的系統時間', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00+08:00'));
    expect(getClock()).toBe(systemClock);
    expect(getClock().now().toISOString()).toBe('2026-10-14T04:00:00.000Z');
    vi.advanceTimersByTime(90_000);
    expect(getClock().now().toISOString()).toBe('2026-10-14T04:01:30.000Z');
  });

  it('每次呼叫 now() 回傳新的 Date 物件（修改它不影響時鐘）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const a = systemClock.now();
    a.setFullYear(1999);
    expect(systemClock.now().getTime()).toBe(0);
  });
});

describe('setClock', () => {
  it('覆寫後 getClock 回傳覆寫值；不影響 systemClock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const fixed: Clock = { now: () => new Date('2026-10-14T12:00:00+08:00') };
    setClock(fixed);
    expect(getClock()).toBe(fixed);
    expect(getClock().now().toISOString()).toBe('2026-10-14T04:00:00.000Z');
    expect(systemClock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z'); // 鍵盤提醒用真實時間，不受穿梭影響
  });

  it('可還原為 systemClock', () => {
    setClock({ now: () => new Date(0) });
    setClock(systemClock);
    expect(getClock()).toBe(systemClock);
  });
});

describe('createOffsetClock（Demo 時間穿梭：以固定起點繼續走時）', () => {
  it('起點為錨點；之後每過 1 秒顯示時間也前進 1 秒', () => {
    let real = 1_000_000;
    const base: Clock = { now: () => new Date(real) };
    const c = createOffsetClock(new Date('2026-10-14T12:00:00+08:00'), base);
    expect(c.now().toISOString()).toBe('2026-10-14T04:00:00.000Z');
    real += 90_000;
    expect(c.now().toISOString()).toBe('2026-10-14T04:01:30.000Z');
  });

  it('錨點只在建立時讀取一次底層時鐘作為起點；之後差值才影響結果', () => {
    let real = 5_000;
    let reads = 0;
    const base: Clock = {
      now: () => {
        reads++;
        return new Date(real);
      },
    };
    const c = createOffsetClock(new Date(100_000), base);
    expect(reads).toBe(1);
    expect(c.now().getTime()).toBe(100_000);
    real = 7_500;
    expect(c.now().getTime()).toBe(102_500);
  });

  it('預設底層為 systemClock（可用假計時器驗證）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const c = createOffsetClock(new Date('2026-10-14T04:00:00Z'));
    vi.advanceTimersByTime(60_000);
    expect(c.now().toISOString()).toBe('2026-10-14T04:01:00.000Z');
  });

  it('可疊加：以 getClock() 作為底層，穿梭後再穿梭', () => {
    let real = 0;
    setClock({ now: () => new Date(real) });
    const first = createOffsetClock(new Date(1_000_000), getClock());
    const second = createOffsetClock(new Date(5_000_000), first);
    real += 2_000;
    expect(second.now().getTime()).toBe(5_002_000);
  });

  it('不改動傳入的錨點 Date', () => {
    const anchor = new Date(1_000_000);
    const c = createOffsetClock(anchor, { now: () => new Date(0) });
    c.now();
    expect(anchor.getTime()).toBe(1_000_000);
  });

  it('性質：任意經過時間 Δ，結果 = 錨點 + Δ', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (anchorMs, delta) => {
          let real = 123;
          const c = createOffsetClock(new Date(anchorMs), { now: () => new Date(real) });
          real += delta;
          expect(c.now().getTime()).toBe(anchorMs + delta);
        },
      ),
    );
  });
});
