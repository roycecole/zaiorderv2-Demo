// src/features/prefs/inputModeStore.ts —— Demo 面板寫入的「執行期旗標」（FR-DM-10、FR-DM-11）
//
// DemoControl 沒有訂閱機制，因此由 Demo 面板（features/demo）在變更時寫入此 store，
// a11y / 外殼 / 菜單等功能讀取它以決定是否視為觸控面板、是否啟用快速鍵提示、套用哪個預覽主題色。
// 不持久化（DemoState 本身已持久化；DemoRoot 掛載時以 DemoState 初始化此 store）。
import { create } from 'zustand';
import { isKioskMode } from '@/services/storage/appStorage';

export type InputMode = 'AUTO' | 'KIOSK' | 'KEYBOARD_HINTS';

interface InputModeState {
  inputMode: InputMode;
  setInputMode(mode: InputMode): void;
  /**
   * Demo 預覽用品牌色（#RRGGBB）；null = 使用店家設定。ThemeProvider 以
   * `themeOverride ?? StoreInfo.display.brandColor` 推導主題（UAT-14）。
   */
  themeOverride: string | null;
  setThemeOverride(hex: string | null): void;
  /**
   * Demo 面板是否展開：鍵盤偵測提醒的讓位條件（FLOW-25「Demo 面板展開」）。
   * 面板展開時尚未顯示的提醒待命，收合後才顯示；已顯示者被搶走並轉為「稍後」。
   */
  demoPanelOpen: boolean;
  setDemoPanelOpen(open: boolean): void;
  /**
   * 「重播鍵盤提醒」請求序號：Demo 面板每按一次 +1（先 resetKeyboardNotice 再遞增）。
   * `useKeyboardNotice` 監聽此值變化並呼叫 `replay()`（略過證據、仍遵守阻擋條件）。
   */
  keyboardNoticeReplaySeq: number;
  requestKeyboardNoticeReplay(): void;
}

export const useInputModeStore = create<InputModeState>()((set) => ({
  inputMode: 'AUTO',
  setInputMode: (inputMode) => set({ inputMode }),
  themeOverride: null,
  setThemeOverride: (themeOverride) => set({ themeOverride }),
  demoPanelOpen: false,
  setDemoPanelOpen: (demoPanelOpen) => set({ demoPanelOpen }),
  keyboardNoticeReplaySeq: 0,
  requestKeyboardNoticeReplay: () =>
    set((s) => ({ keyboardNoticeReplaySeq: s.keyboardNoticeReplaySeq + 1 })),
}));

/** 觸控面板模式：環境 / 網址旗標，或 Demo 預覽 KIOSK。儲存隔離仍只看 `isKioskMode`（載入時決定） */
export function useIsKioskUi(): boolean {
  const inputMode = useInputModeStore((s) => s.inputMode);
  return isKioskMode || inputMode === 'KIOSK';
}
