// src/features/kiosk/useKioskActivity.ts —— 觸控面板「使用者操作」追蹤（FLOW-21、BR-37）
//
// 任何指標、觸控、鍵盤、捲動操作都更新 lastActivityMs。時間一律取自單調時鐘 performance.now()：
// 不使用 Clock（Demo 時間穿梭不應影響閒置計時），也不使用系統時間（調整系統時間不應觸發重置）。
import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** 視為「使用者正在操作」的全域事件（capture 階段，涵蓋巢狀捲動容器；passive 不影響捲動效能） */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'touchstart',
  'touchmove',
  'keydown',
  'wheel',
  'click',
  'scroll',
] as const;

export interface KioskActivity {
  /** 最近一次操作的 performance.now() 毫秒；僅供事件處理器與計時器讀取，不要在渲染中讀取 */
  lastActivityRef: RefObject<number>;
  /** 手動記一次操作（例如按「繼續點餐」、重置後重新起算） */
  markActivity: () => void;
}

/**
 * @param enabled 為 false 時不掛任何監聽（非觸控面板模式不付任何成本）
 */
export function useKioskActivity(enabled: boolean): KioskActivity {
  const lastActivityRef = useRef(0);
  const markActivity = useCallback((): void => {
    lastActivityRef.current = performance.now();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    markActivity();
    const options = { capture: true, passive: true } as const;
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, markActivity, options);
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, markActivity, options);
    };
  }, [enabled, markActivity]);

  return { lastActivityRef, markActivity };
}
