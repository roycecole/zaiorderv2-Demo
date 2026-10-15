// src/hooks/useReducedMotion.ts —— 系統「減少動態」偏好
import { useMediaQuery } from './useMediaQuery';

/**
 * 只讀系統的 `prefers-reduced-motion: reduce`。
 * 使用者在偏好（prefs.reduceMotion）的覆寫由 app 層合併：
 * 例如 `prefs.reduceMotion || useReducedMotion()`，並同步寫入 `html[data-motion]`（CSS 動畫由 styles/index.css 處理）。
 */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
