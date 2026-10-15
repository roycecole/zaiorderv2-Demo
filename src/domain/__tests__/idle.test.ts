// BR-37 / FLOW-21 觸控面板閒置：60 秒警示、90 秒重置、完成畫面 30 秒；WCAG 2.2.1
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_IDLE_CONFIG,
  KIOSK_DONE_RETURN_SECONDS,
  KIOSK_IDLE_RESET_MS,
  KIOSK_IDLE_WARN_MS,
  KIOSK_MIN_WARNING_MS,
  doneCountdown,
  idleState,
} from '../idle';

describe('常數', () => {
  it('60 秒警示、90 秒重置、完成畫面 30 秒、警示後至少 20 秒', () => {
    expect(KIOSK_IDLE_WARN_MS).toBe(60_000);
    expect(KIOSK_IDLE_RESET_MS).toBe(90_000);
    expect(KIOSK_DONE_RETURN_SECONDS).toBe(30);
    expect(KIOSK_MIN_WARNING_MS).toBe(20_000);
    expect(DEFAULT_IDLE_CONFIG).toEqual({ warnMs: 60_000, resetMs: 90_000 });
  });
});

describe('idleState', () => {
  it('操作後立即為 ACTIVE，剩餘 90 秒', () => {
    expect(idleState(0, 0)).toEqual({ phase: 'ACTIVE', remainingSeconds: 90 });
  });

  it('59.999 秒 ACTIVE、60 秒 WARNING（剩 30 秒）、89.001 秒 WARNING（剩 1 秒）、90 秒 RESET', () => {
    expect(idleState(0, 59_000)).toEqual({ phase: 'ACTIVE', remainingSeconds: 31 });
    expect(idleState(0, 59_999)).toEqual({ phase: 'ACTIVE', remainingSeconds: 31 });
    expect(idleState(0, 60_000)).toEqual({ phase: 'WARNING', remainingSeconds: 30 });
    expect(idleState(0, 89_001)).toEqual({ phase: 'WARNING', remainingSeconds: 1 });
    expect(idleState(0, 89_999)).toEqual({ phase: 'WARNING', remainingSeconds: 1 });
    expect(idleState(0, 90_000)).toEqual({ phase: 'RESET', remainingSeconds: 0 });
    expect(idleState(0, 500_000)).toEqual({ phase: 'RESET', remainingSeconds: 0 });
  });

  it('剩餘秒數表（ACTIVE 90→31、WARNING 30→1、RESET 0）', () => {
    const phases = new Set<string>();
    for (let sec = 0; sec <= 95; sec++) {
      const s = idleState(0, sec * 1000);
      if (s.phase === 'ACTIVE') expect(s.remainingSeconds).toBe(90 - sec);
      if (s.phase === 'WARNING') expect(s.remainingSeconds).toBe(90 - sec);
      if (s.phase === 'RESET') expect(s.remainingSeconds).toBe(0);
      phases.add(s.phase);
    }
    expect(phases).toEqual(new Set(['ACTIVE', 'WARNING', 'RESET']));
  });

  it('任何操作（lastActivity 更新）回到 ACTIVE', () => {
    expect(idleState(80_000, 100_000).phase).toBe('ACTIVE');
    expect(idleState(100_000, 100_000)).toEqual({ phase: 'ACTIVE', remainingSeconds: 90 });
  });

  it('時鐘倒退（now < lastActivity）不產生負值，視為 ACTIVE', () => {
    expect(idleState(100_000, 50_000)).toEqual({ phase: 'ACTIVE', remainingSeconds: 90 });
  });

  it('自訂設定不合理時仍保證有 WARNING 階段，且警示後至少留 20 秒', () => {
    const cfg = { warnMs: 60_000, resetMs: 60_000 };
    expect(idleState(0, 39_999, cfg).phase).toBe('ACTIVE');
    expect(idleState(0, 40_000, cfg)).toEqual({ phase: 'WARNING', remainingSeconds: 20 });
    expect(idleState(0, 60_000, cfg).phase).toBe('RESET');
  });

  it('自訂設定的 warnMs 較早時照用', () => {
    const cfg = { warnMs: 10_000, resetMs: 50_000 };
    expect(idleState(0, 9_999, cfg).phase).toBe('ACTIVE');
    expect(idleState(0, 10_000, cfg)).toEqual({ phase: 'WARNING', remainingSeconds: 40 });
  });

  it('非有限值（NaN、undefined）回到 ACTIVE 與完整倒數', () => {
    expect(idleState(Number.NaN, 1000)).toEqual({ phase: 'ACTIVE', remainingSeconds: 90 });
    expect(idleState(undefined as unknown as number, 1000)).toEqual({
      phase: 'ACTIVE',
      remainingSeconds: 90,
    });
    expect(idleState(0, Number.POSITIVE_INFINITY)).toEqual({
      phase: 'ACTIVE',
      remainingSeconds: 90,
    });
  });

  it('性質：階段隨閒置時間單調推進（ACTIVE → WARNING → RESET），剩餘秒數單調不增', () => {
    const rank = { ACTIVE: 0, WARNING: 1, RESET: 2 } as const;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: 0, max: 50_000 }),
        (idleMs, extra) => {
          const a = idleState(0, idleMs);
          const b = idleState(0, idleMs + extra);
          expect(rank[b.phase]).toBeGreaterThanOrEqual(rank[a.phase]);
          expect(b.remainingSeconds).toBeLessThanOrEqual(a.remainingSeconds);
          expect(a.remainingSeconds).toBeGreaterThanOrEqual(0);
          expect(a.remainingSeconds).toBeLessThanOrEqual(90);
        },
      ),
    );
  });
});

describe('doneCountdown（完成畫面）', () => {
  it('30 秒 → 0；任何操作（lastActivity 更新）重新計時', () => {
    expect(doneCountdown(0, 0)).toBe(30);
    expect(doneCountdown(0, 29_001)).toBe(1);
    expect(doneCountdown(0, 30_000)).toBe(0);
    expect(doneCountdown(0, 60_000)).toBe(0);
    expect(doneCountdown(25_000, 30_000)).toBe(25);
  });

  it('可自訂秒數；非有限值回到完整秒數；時鐘倒退不超過上限', () => {
    expect(doneCountdown(0, 5_000, 10)).toBe(5);
    expect(doneCountdown(0, Number.NaN)).toBe(30);
    expect(doneCountdown(10_000, 0)).toBe(30);
  });
});
