// 觸控面板測試共用：假時鐘（performance.now）、活動事件、重置範圍斷言
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export interface FakeMonotonic {
  now(): number;
  /** 前進 seconds 秒，逐秒推進計時器（讓每次 tick 讀到正確的 performance.now） */
  advance(seconds: number): void;
  restore(): void;
}

/** 計時器（setInterval / setTimeout）使用 vitest 假計時器，performance.now 以可控變數取代 */
export function installFakeMonotonic(start = 10_000): FakeMonotonic {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  let nowMs = start;
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  return {
    now: () => nowMs,
    advance(seconds: number) {
      for (let i = 0; i < seconds; i++) {
        nowMs += 1000;
        act(() => {
          vi.advanceTimersByTime(1000);
        });
      }
    },
    restore() {
      spy.mockRestore();
      vi.useRealTimers();
    },
  };
}
