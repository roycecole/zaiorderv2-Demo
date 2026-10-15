// a11y 測試共用：重置全域狀態、模擬 matchMedia、渲染 HotkeyProvider
import { vi } from 'vitest';
import { resetAnnouncer } from '../LiveAnnouncer';
import { resetNoticeSession } from '../noticeSession';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';

/** 重置 prefs、輸入模式、提醒 session 與通報；每個測試前呼叫 */
export function resetA11yState(): void {
  window.localStorage.clear();
  usePrefsStore.getState().reset();
  useGuestOrdersStore.getState().clear();
  useInputModeStore.setState({
    inputMode: 'AUTO',
    themeOverride: null,
    demoPanelOpen: false,
    keyboardNoticeReplaySeq: 0,
  });
  resetNoticeSession();
  resetAnnouncer();
}

/**
 * 模擬 window.matchMedia：`matches` 為 (query) => boolean。
 * 回傳還原函式。預設：(any-pointer: fine) 為真，其餘為假（手機寬度）。
 */
export function stubMatchMedia(
  matches: (query: string) => boolean = (q) => q.includes('any-pointer: fine'),
): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

/** 指定視窗寬度（影響 useBreakpoint 與 min-width 查詢） */
export function stubViewportWidth(width: number, extra?: (query: string) => boolean): () => void {
  const minWidth = (q: string): boolean => {
    const m = /min-width:\s*(\d+)px/.exec(q);
    return m !== null && width >= Number(m[1]);
  };
  return stubMatchMedia((q) => {
    if (extra?.(q) === true) return true;
    if (q.includes('any-pointer: fine')) return true;
    return minWidth(q);
  });
}

export const spy = () => vi.fn<(arg?: string) => void>();
