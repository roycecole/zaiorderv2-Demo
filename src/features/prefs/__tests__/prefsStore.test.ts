// 07 §6.2 / §7.1 偏好 Store：單鍵快速鍵預設關（WCAG 2.1.4、BR-34）、鍵盤提醒旗標、點餐記憶（BR-35）、
// 「清除我的資料」（FR-CK-14）、persist version 2 與遷移、多分頁同步
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMEMBER_TTL_MS } from '@/domain/rememberedChoice';
import { MemoryStorage, stubWebStorage } from '@/test/memoryStorage';
import type { StubbedStorages } from '@/test/memoryStorage';
import type * as PrefsNs from '../prefsStore';

const KEY = 'zaiorder:v1:prefs';
const NOW = Date.parse('2026-10-14T12:00:00+08:00');

type PrefsModule = typeof PrefsNs;
let storages: StubbedStorages;

async function load(preload?: unknown): Promise<PrefsModule> {
  vi.resetModules();
  const local = new MemoryStorage();
  if (preload !== undefined)
    local.setItem(KEY, typeof preload === 'string' ? preload : JSON.stringify(preload));
  storages = stubWebStorage(local);
  return import('../prefsStore');
}
const persisted = (): { state: Record<string, unknown>; version: number } =>
  JSON.parse(storages.local.getItem(KEY) as string) as {
    state: Record<string, unknown>;
    version: number;
  };

const ordered = (productId: string, labels: string[] = [], note?: string) => ({
  productId,
  optionIds: labels.map((l) => `opt_${l}`),
  labels,
  ...(note !== undefined ? { note } : {}),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('預設值', () => {
  it('單鍵快速鍵預設關閉、點餐記憶預設開、無提醒紀錄', async () => {
    const { usePrefsStore, DEFAULT_PREFS } = await load();
    const s = usePrefsStore.getState();
    expect(s.hotkeysEnabled).toBe(false);
    expect(s.kbdNotice).toEqual({ outcome: 'NONE', shownCount: 0, lastShownAt: null });
    expect(s.rememberChoices).toBe(true);
    expect(s.lastChoices).toEqual({});
    expect(s.largeText).toBe(false);
    expect(s.reduceMotion).toBe(false);
    expect(s.menuLayoutOverride).toBe('AUTO');
    expect(s.guestProfile).toBeNull();
    expect(s.lastOrderType).toBeNull();
    expect(s.lastPaymentMethod).toBeNull();
    expect(s.dismissedAnnouncement).toBeNull();
    expect(s.orderSavePromptDismissed).toBe(false);
    expect(s.demoBannerDismissed).toBe(false);
    expect(DEFAULT_PREFS.hotkeysEnabled).toBe(false);
  });
});

describe('patch', () => {
  it('合併部分欄位並寫入儲存', async () => {
    const { usePrefsStore } = await load();
    usePrefsStore
      .getState()
      .patch({ largeText: true, lastOrderType: 'DELIVERY', lastPaymentMethod: 'LINE_PAY' });
    const s = usePrefsStore.getState();
    expect([s.largeText, s.lastOrderType, s.lastPaymentMethod]).toEqual([
      true,
      'DELIVERY',
      'LINE_PAY',
    ]);
    expect(s.reduceMotion).toBe(false);
    expect(persisted().state).toMatchObject({ largeText: true, lastOrderType: 'DELIVERY' });
  });
});

describe('鍵盤偏好（轉接 domain/kbdNotice）', () => {
  it('enableHotkeys：開啟並把 outcome NONE → ACCEPTED；disableHotkeys 關閉但 outcome 不變', async () => {
    const { usePrefsStore } = await load();
    const s = usePrefsStore.getState();
    s.enableHotkeys();
    expect([
      usePrefsStore.getState().hotkeysEnabled,
      usePrefsStore.getState().kbdNotice.outcome,
    ]).toEqual([true, 'ACCEPTED']);
    s.disableHotkeys();
    expect([
      usePrefsStore.getState().hotkeysEnabled,
      usePrefsStore.getState().kbdNotice.outcome,
    ]).toEqual([false, 'ACCEPTED']);
  });

  it('recordNoticeShown：shownCount + 1、lastShownAt 為傳入的真實時間', async () => {
    const { usePrefsStore } = await load();
    usePrefsStore.getState().recordNoticeShown(123_456);
    expect(usePrefsStore.getState().kbdNotice).toEqual({
      outcome: 'NONE',
      shownCount: 1,
      lastShownAt: 123_456,
    });
    usePrefsStore.getState().recordNoticeShown(999);
    expect(usePrefsStore.getState().kbdNotice.shownCount).toBe(2);
  });

  it('declineNotice：outcome = DECLINED，不改變 hotkeysEnabled', async () => {
    const { usePrefsStore } = await load();
    usePrefsStore.getState().declineNotice();
    expect([
      usePrefsStore.getState().kbdNotice.outcome,
      usePrefsStore.getState().hotkeysEnabled,
    ]).toEqual(['DECLINED', false]);
  });

  it('undoAccept：關閉單鍵快速鍵並視為不用了', async () => {
    const { usePrefsStore } = await load();
    usePrefsStore.getState().enableHotkeys();
    usePrefsStore.getState().undoAccept();
    expect([
      usePrefsStore.getState().hotkeysEnabled,
      usePrefsStore.getState().kbdNotice.outcome,
    ]).toEqual([false, 'DECLINED']);
  });

  it('resetKeyboardNotice（Demo 重播）：旗標歸零並把單鍵快速鍵設回關閉', async () => {
    const { usePrefsStore } = await load();
    const s = usePrefsStore.getState();
    s.recordNoticeShown(5);
    s.enableHotkeys();
    s.resetKeyboardNotice();
    expect(usePrefsStore.getState().hotkeysEnabled).toBe(false);
    expect(usePrefsStore.getState().kbdNotice).toEqual({
      outcome: 'NONE',
      shownCount: 0,
      lastShownAt: null,
    });
  });

  it('鍵盤動作不影響其他偏好', async () => {
    const { usePrefsStore } = await load();
    usePrefsStore.getState().patch({ largeText: true, rememberChoices: false });
    usePrefsStore.getState().enableHotkeys();
    expect(usePrefsStore.getState().largeText).toBe(true);
    expect(usePrefsStore.getState().rememberChoices).toBe(false);
  });
});

describe('點餐記憶（BR-35）', () => {
  it('rememberOrder：寫入各商品最近一次的選項與備註，時間為傳入的 nowMs（第 1 行最新）', async () => {
    const { usePrefsStore } = await load();
    usePrefsStore
      .getState()
      .rememberOrder([ordered('a', ['大碗', '滷蛋'], ' 不要蔥 '), ordered('b')], NOW);
    const { lastChoices } = usePrefsStore.getState();
    expect(lastChoices.a).toEqual({
      productId: 'a',
      optionIds: ['opt_大碗', 'opt_滷蛋'],
      labels: ['大碗', '滷蛋'],
      note: '不要蔥',
      at: NOW,
    });
    expect(lastChoices.b?.at).toBe(NOW - 1);
    expect(lastChoices.b?.note).toBeUndefined();
  });

  it('同商品覆蓋為最新一次的選擇', async () => {
    const { usePrefsStore } = await load();
    const s = usePrefsStore.getState();
    s.rememberOrder([ordered('a', ['小碗'])], NOW - 1000);
    s.rememberOrder([ordered('a', ['大碗'])], NOW);
    expect(usePrefsStore.getState().lastChoices.a?.labels).toEqual(['大碗']);
    expect(Object.keys(usePrefsStore.getState().lastChoices)).toEqual(['a']);
  });

  it('使用者關閉點餐記憶（rememberChoices = false）時不記錄', async () => {
    const { usePrefsStore } = await load();
    usePrefsStore.getState().patch({ rememberChoices: false });
    usePrefsStore.getState().rememberOrder([ordered('a', ['大碗'])], NOW);
    expect(usePrefsStore.getState().lastChoices).toEqual({});
  });

  it('寫入時一併清除超過 180 天的舊記憶', async () => {
    const { usePrefsStore } = await load();
    usePrefsStore.getState().patch({
      lastChoices: {
        old: { productId: 'old', optionIds: [], labels: [], at: NOW - REMEMBER_TTL_MS - 1 },
      },
    });
    usePrefsStore.getState().rememberOrder([ordered('fresh')], NOW);
    expect(Object.keys(usePrefsStore.getState().lastChoices)).toEqual(['fresh']);
  });

  it('clearRemembered 只清除點餐記憶', async () => {
    const { usePrefsStore } = await load();
    usePrefsStore.getState().patch({ largeText: true });
    usePrefsStore.getState().rememberOrder([ordered('a')], NOW);
    usePrefsStore.getState().clearRemembered();
    expect(usePrefsStore.getState().lastChoices).toEqual({});
    expect(usePrefsStore.getState().largeText).toBe(true);
  });

  it('selectLiveRemembered：讀取端取得已清除過期項目的記憶，不改動 store', async () => {
    const { usePrefsStore, selectLiveRemembered } = await load();
    usePrefsStore.getState().patch({
      lastChoices: {
        old: { productId: 'old', optionIds: [], labels: [], at: NOW - REMEMBER_TTL_MS - 1 },
        fresh: { productId: 'fresh', optionIds: [], labels: [], at: NOW },
      },
    });
    const live = selectLiveRemembered(usePrefsStore.getState(), NOW);
    expect(Object.keys(live)).toEqual(['fresh']);
    expect(Object.keys(usePrefsStore.getState().lastChoices).sort()).toEqual(['fresh', 'old']);
  });

  it('過期的點餐記憶不在載入時清除（Store 不碰時鐘）', async () => {
    const stale = { productId: 'old', optionIds: [], labels: [], at: NOW - REMEMBER_TTL_MS - 5 };
    const { usePrefsStore } = await load({ state: { lastChoices: { old: stale } }, version: 2 });
    expect(usePrefsStore.getState().lastChoices.old).toEqual(stale);
  });
});

describe('clearMyData / reset', () => {
  const profile = { name: '王小明', phone: '0912345678', paymentMethod: 'CASH' as const };

  it('clearMyData（FR-CK-14）：清除訪客資料與點餐記憶；其餘偏好保留', async () => {
    const { usePrefsStore } = await load();
    const s = usePrefsStore.getState();
    s.patch({ guestProfile: profile, largeText: true, lastOrderType: 'DELIVERY' });
    s.rememberOrder([ordered('a')], NOW);
    s.clearMyData();
    const after = usePrefsStore.getState();
    expect(after.guestProfile).toBeNull();
    expect(after.lastChoices).toEqual({});
    expect(after.largeText).toBe(true);
    expect(after.lastOrderType).toBe('DELIVERY');
  });

  it('reset：全部回到預設（Demo 重置、觸控面板閒置重置），且 kbdNotice 為新物件', async () => {
    const { usePrefsStore, DEFAULT_PREFS } = await load();
    const s = usePrefsStore.getState();
    s.patch({ guestProfile: profile, largeText: true });
    s.enableHotkeys();
    s.recordNoticeShown(1);
    s.reset();
    const after = usePrefsStore.getState();
    expect(after.hotkeysEnabled).toBe(false);
    expect(after.largeText).toBe(false);
    expect(after.guestProfile).toBeNull();
    expect(after.kbdNotice).toEqual({ outcome: 'NONE', shownCount: 0, lastShownAt: null });
    expect(after.kbdNotice).not.toBe(DEFAULT_PREFS.kbdNotice);
    // 之後的變更不污染預設常數
    after.recordNoticeShown(5);
    expect(DEFAULT_PREFS.kbdNotice.shownCount).toBe(0);
  });
});

describe('持久化（zaiorder:v1:prefs，version 2）', () => {
  it('只保存偏好資料欄位（不含函式）、版本為 2', async () => {
    const { usePrefsStore, DEFAULT_PREFS } = await load();
    usePrefsStore.getState().patch({ reduceMotion: true });
    const p = persisted();
    expect(p.version).toBe(2);
    expect(Object.keys(p.state).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
    expect(p.state.reduceMotion).toBe(true);
    expect(p.state.hotkeysEnabled).toBe(false);
  });

  it('v2 的資料原樣還原（hotkeysEnabled: true 保留）', async () => {
    const { usePrefsStore } = await load({
      state: {
        hotkeysEnabled: true,
        kbdNotice: { outcome: 'ACCEPTED', shownCount: 1, lastShownAt: 5 },
        largeText: true,
      },
      version: 2,
    });
    const s = usePrefsStore.getState();
    expect(s.hotkeysEnabled).toBe(true);
    expect(s.kbdNotice).toEqual({ outcome: 'ACCEPTED', shownCount: 1, lastShownAt: 5 });
    expect(s.largeText).toBe(true);
    expect(s.rememberChoices).toBe(true); // 缺少的欄位取預設
  });

  it('v1 遷移：hotkeysEnabled: true 一律重設為關閉並補 kbdNotice，其餘欄位保留', async () => {
    const { usePrefsStore } = await load({
      state: {
        hotkeysEnabled: true,
        largeText: true,
        rememberChoices: false,
        lastOrderType: 'DELIVERY',
      },
      version: 1,
    });
    const s = usePrefsStore.getState();
    expect(s.hotkeysEnabled).toBe(false);
    expect(s.kbdNotice).toEqual({ outcome: 'NONE', shownCount: 0, lastShownAt: null });
    expect(s.largeText).toBe(true);
    expect(s.rememberChoices).toBe(false);
    expect(s.lastOrderType).toBe('DELIVERY');
  });

  it('遷移後寫回 version 2', async () => {
    const { usePrefsStore } = await load({ state: { hotkeysEnabled: true }, version: 1 });
    usePrefsStore.getState().patch({ largeText: true });
    expect(persisted().version).toBe(2);
    expect(persisted().state.hotkeysEnabled).toBe(false);
  });

  it('資料損毀（非 JSON）→ 退回預設，不丟錯', async () => {
    const { usePrefsStore } = await load('{{{');
    expect(usePrefsStore.getState().hotkeysEnabled).toBe(false);
    expect(usePrefsStore.getState().rememberChoices).toBe(true);
  });
});

describe('多分頁同步', () => {
  it('其他分頁寫入 prefs（例如啟用單鍵快速鍵）→ 重新水合；其他鍵不觸發', async () => {
    const { usePrefsStore } = await load();
    storages.local.setItem(
      KEY,
      JSON.stringify({
        state: {
          hotkeysEnabled: true,
          kbdNotice: { outcome: 'ACCEPTED', shownCount: 1, lastShownAt: 7 },
        },
        version: 2,
      }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'zaiorder:v1:cart' }));
    await Promise.resolve();
    expect(usePrefsStore.getState().hotkeysEnabled).toBe(false);
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    await vi.waitFor(() => {
      expect(usePrefsStore.getState().hotkeysEnabled).toBe(true);
    });
    expect(usePrefsStore.getState().kbdNotice.outcome).toBe('ACCEPTED');
  });
});
