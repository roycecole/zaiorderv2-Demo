// src/hooks/useClockNow.ts —— 以全站時鐘（getClock）週期更新的「現在」，供倒數與營業狀態使用
import { useEffect, useState } from 'react';
import { getClock } from '@/services/clock';

/**
 * 回傳 `getClock().now()`，並每 `intervalMs` 毫秒更新一次（Demo 時間穿梭與測試的 setClock 會反映在下一次更新）。
 * - `intervalMs` 傳 `null` 可暫停更新（例如倒數結束）；恢復或間隔改變時立即同步一次。
 * - 頁面重新可見時立即同步，避免背景分頁被瀏覽器節流後顯示過期時間。
 * 元件內禁止直接使用 `Date.now()` / `new Date()`（ESLint 規則；07 §6.4）。
 */
export function useClockNow(intervalMs: number | null = 1000): Date {
  const [now, setNow] = useState<Date>(() => getClock().now());
  const [lastInterval, setLastInterval] = useState<number | null>(intervalMs);

  // 間隔改變（含暫停 → 恢復）：在渲染中同步一次，不必等下一個 tick
  if (lastInterval !== intervalMs) {
    setLastInterval(intervalMs);
    setNow(getClock().now());
  }

  useEffect(() => {
    if (intervalMs === null) return;
    const tick = (): void => setNow(getClock().now());
    const timer = setInterval(tick, intervalMs);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);

  return now;
}
