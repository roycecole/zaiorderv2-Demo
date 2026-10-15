// src/hooks/usePageVisibility.ts —— 頁面是否可見（分頁切換、視窗最小化）
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

const getSnapshot = (): boolean =>
  typeof document === 'undefined' ? true : document.visibilityState !== 'hidden';

/** `true` = 頁面可見。頁面隱藏時應暫停計時、輪詢與提醒（03 §10.3、07 §7.5）。 */
export function usePageVisibility(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
