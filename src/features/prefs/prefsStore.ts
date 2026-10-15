// src/features/prefs/prefsStore.ts —— 偏好（07 §6.2 prefs；§7.1）
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_KEYBOARD_PREFS,
  PREFS_VERSION,
  declineNotice,
  disableHotkeys,
  enableHotkeys,
  migratePrefs,
  recordNoticeShown,
  resetKeyboardNotice,
  undoAccept,
} from '@/domain/kbdNotice';
import type { KeyboardPrefs } from '@/domain/kbdNotice';
import type { MenuLayout } from '@/domain/menuLayout';
import { pruneRemembered, rememberFromOrder } from '@/domain/rememberedChoice';
import type { OrderedLine, RememberedMap } from '@/domain/rememberedChoice';
import type { InvoiceType, OrderType, PaymentMethod } from '@/domain/types';
import { appLocalStorage, STORAGE_KEYS } from '@/services/storage/appStorage';

/** 訪客資料：僅在使用者勾選「記住我的資料」時寫入（FR-CK-14） */
export interface GuestProfile {
  name?: string;
  phone?: string;
  delivery?: { city: string; district: string; zipCode: string; line: string; note?: string };
  paymentMethod?: PaymentMethod;
  invoice?: { type: InvoiceType; carrierCode?: string; taxId?: string; buyerName?: string; donateCode?: string };
}

export interface PrefsData extends KeyboardPrefs {
  lastOrderType: OrderType | null;
  lastPaymentMethod: PaymentMethod | null;
  /** 點餐記憶開關（預設開，BR-35） */
  rememberChoices: boolean;
  lastChoices: RememberedMap;
  largeText: boolean;
  reduceMotion: boolean;
  /** 使用者手動選擇的菜單版面；'AUTO' = 跟隨店家設定 */
  menuLayoutOverride: MenuLayout;
  /** 已關閉的公告（以公告文字雜湊或日期識別） */
  dismissedAnnouncement: string | null;
  /** 已關閉「保存訂單」提示 */
  orderSavePromptDismissed: boolean;
  demoBannerDismissed: boolean;
  guestProfile: GuestProfile | null;
}

export interface PrefsActions {
  patch(partial: Partial<PrefsData>): void;
  // 鍵盤相關（轉接 domain/kbdNotice 的純函式）
  enableHotkeys(): void;
  disableHotkeys(): void;
  recordNoticeShown(nowMs: number): void;
  declineNotice(): void;
  undoAccept(): void;
  resetKeyboardNotice(): void;
  // 點餐記憶
  rememberOrder(lines: ReadonlyArray<OrderedLine>, nowMs: number): void;
  clearRemembered(): void;
  /** 「清除我的資料」：訪客資料、點餐記憶（FR-CK-14）；本機訂單記錄由 guestOrdersStore 另行清除 */
  clearMyData(): void;
  /** 重置為預設（Demo 重置、觸控面板閒置重置） */
  reset(): void;
}

export const DEFAULT_PREFS: PrefsData = {
  ...DEFAULT_KEYBOARD_PREFS,
  lastOrderType: null,
  lastPaymentMethod: null,
  rememberChoices: true,
  lastChoices: {},
  largeText: false,
  reduceMotion: false,
  menuLayoutOverride: 'AUTO',
  dismissedAnnouncement: null,
  orderSavePromptDismissed: false,
  demoBannerDismissed: false,
  guestProfile: null,
};

export const usePrefsStore = create<PrefsData & PrefsActions>()(
  persist(
    (set, get) => ({
      ...DEFAULT_PREFS,
      patch: (partial) => set(partial),

      enableHotkeys: () => set(enableHotkeys(pickKeyboard(get()))),
      disableHotkeys: () => set(disableHotkeys(pickKeyboard(get()))),
      recordNoticeShown: (nowMs) => set(recordNoticeShown(pickKeyboard(get()), nowMs)),
      declineNotice: () => set(declineNotice(pickKeyboard(get()))),
      undoAccept: () => set(undoAccept(pickKeyboard(get()))),
      resetKeyboardNotice: () => set(resetKeyboardNotice(pickKeyboard(get()))),

      rememberOrder: (lines, nowMs) => {
        const s = get();
        if (!s.rememberChoices) return;
        set({ lastChoices: rememberFromOrder(s.lastChoices, lines, nowMs) });
      },
      clearRemembered: () => set({ lastChoices: {} }),
      clearMyData: () => set({ guestProfile: null, lastChoices: {} }),
      reset: () => set({ ...DEFAULT_PREFS, kbdNotice: { ...DEFAULT_PREFS.kbdNotice } }),
    }),
    {
      name: STORAGE_KEYS.prefs,
      version: PREFS_VERSION,
      storage: createJSONStorage(() => appLocalStorage),
      partialize: (s) =>
        Object.fromEntries(
          (Object.keys(DEFAULT_PREFS) as Array<keyof PrefsData>).map((k) => [k, s[k]]),
        ) as unknown as PrefsData,
      migrate: (persisted, fromVersion) => migratePrefs(persisted, fromVersion) as PrefsData,
      // 過期的點餐記憶不在載入時清除（Store 不碰時鐘）；讀取端以 selectLiveRemembered 取用（BR-35）
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PrefsData>;
        // kbdNotice 為巢狀物件：淺合併會讓不完整的舊資料缺欄位，逐欄以預設補齊
        return { ...current, ...p, kbdNotice: { ...current.kbdNotice, ...(p.kbdNotice ?? {}) } };
      },
    },
  ),
);

function pickKeyboard(s: PrefsData): KeyboardPrefs {
  return { hotkeysEnabled: s.hotkeysEnabled, kbdNotice: s.kbdNotice };
}

/** 讀取端使用：取得已清除過期項目的點餐記憶（不改動 store） */
export function selectLiveRemembered(s: Pick<PrefsData, 'lastChoices'>, nowMs: number): RememberedMap {
  return pruneRemembered(s.lastChoices, nowMs);
}

// 多分頁同步：其他分頁寫入 prefs 時重新載入（07 §7.1 鍵盤旗標「多分頁經 storage 事件同步」）
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.prefs) void usePrefsStore.persist.rehydrate();
  });
}
