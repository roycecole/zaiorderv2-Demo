// src/i18n/strings/a11y.ts —— 文案（03 §9、§10；繁體中文・台灣用語）
// 涵蓋：跳過連結、鍵盤偵測提醒、快速鍵與偏好對話框（PG-19）、即時通報，以及外殼（頂部列、頁尾、底部 Tab）。
import type { HotkeyScope } from '@/domain/hotkeys';
import type { MenuLayout } from '@/domain/menuLayout';

const scopeLabels: Record<HotkeyScope, string> = {
  global: '全域',
  menu: '菜單頁',
  sheet: '商品面板',
  cart: '購物車 / 訂單面板',
  checkout: '結帳頁',
  order: '訂單頁',
};

const menuLayoutLabels: Record<MenuLayout, string> = {
  AUTO: '自動',
  GRID: '圖卡',
  LIST: '清單',
};

export const a11y = {
  // ───── 跳過連結（CMP-38）─────
  skipLinks: {
    main: '跳到主要內容',
    cart: '跳到購物車',
    shortcuts: '鍵盤快速鍵與偏好',
  },

  // ───── ⌨ 按鈕 ─────
  helpButton: {
    label: '鍵盤快速鍵與偏好',
    labelWithDot: '鍵盤快速鍵與偏好，有新提示',
  },

  // ───── 鍵盤偵測提醒（CMP-41、03 §9）─────
  notice: {
    groupLabel: '鍵盤快速鍵提醒',
    title: '偵測到實體鍵盤',
    body: '要開啟單鍵快速鍵嗎？例如按 c 開購物車、按 s 搜尋。可隨時在偏好設定關閉。',
    bodyHit: (key: string) => `剛才按的「${key}」是快速鍵，目前尚未開啟。要開啟單鍵快速鍵嗎？`,
    accept: '開啟',
    decline: '不用了',
    declineHint: '之後不會再自動提醒，仍可在偏好設定開啟。',
    screenReaderHint: '使用螢幕閱讀器時，單鍵快速鍵可能與瀏覽模式的按鍵衝突，建議保持關閉。',
    confirmedTitle: '已開啟單鍵快速鍵。',
    confirmedBodyBefore: '按',
    confirmedBodyAfter: '查看全部。',
    confirmedBodyKey: '?',
    viewAll: '查看全部',
    undo: '復原',
  },

  // ───── 即時通報（03 §10.4）─────
  announce: {
    noticeShown: '偵測到實體鍵盤，可以開啟單鍵快速鍵。',
    hotkeysOn: '單鍵快速鍵已開啟，按問號查看全部。',
    hotkeysOff: '單鍵快速鍵已關閉。',
    declined: '已不再提醒。可在偏好設定開啟單鍵快速鍵。',
    dataCleared: '已清除我的資料。',
    page: (title: string) => `已前往：${title}`,
  },

  // ───── PG-19 快速鍵與偏好 ─────
  shortcuts: {
    title: '鍵盤快速鍵與偏好',
    descriptionOff: '開啟下方開關後，按 ? 即可隨時開啟此說明；在輸入框內與輸入法組字時不會觸發',
    descriptionOn: '按 ? 隨時開啟；在輸入框內與輸入法組字時不會觸發',
    keysSection: '鍵盤快速鍵',
    hotkeysSwitch: '啟用單鍵快速鍵',
    hotkeysSwitchHint: '開啟後可用單鍵操作，例如 c 開購物車；關閉時僅保留 Esc 與 Ctrl/⌘ + Enter',
    screenReaderHint: '使用螢幕閱讀器時，單鍵快速鍵可能與瀏覽模式的按鍵衝突，建議保持關閉。',
    keymapOff: '以下為開啟後的鍵位；未啟用時僅 Esc 與 Ctrl/⌘ + Enter 有效',
    keymapOn: '以下為目前有效的鍵位；在輸入框內不會觸發',
    scopeLabels,
    alwaysOn: '不受開關影響',
    navigationTitle: '方向鍵與 Tab',
    navigation: [
      { keys: ['←', '→', '↑', '↓'], label: '在商品卡、分類、選項與時段間移動' },
      { keys: ['Enter', 'Space'], label: '開啟商品面板或選取' },
      { keys: ['Tab', 'Shift + Tab'], label: '依序移動焦點' },
    ],
    prefsSection: '顯示與輸入偏好',
    remember: '記住上次點過的選項（僅存於此裝置）',
    rememberHint: '於此裝置顯示「上次：…」「↻ 再點」與「常點」',
    largeText: '大字模式（文字放大 12.5%）',
    largeTextHint: '文字放大 12.5%，版面自動重排',
    reduceMotion: '減少動態',
    reduceMotionHint: '關閉時跟隨系統設定；開啟後以淡入淡出取代位移與彈跳',
    menuLayout: '菜單版面',
    menuLayoutHint: '自動：依店家設定與商品圖片比例決定',
    menuLayoutLabels,
    clearData: '清除我的資料',
    clearDataHint: '清除此裝置記住的姓名、手機、地址、點餐記憶與本機訂單記錄',
    clearConfirmTitle: '要清除我的資料嗎？',
    clearConfirmBody: '要清除此裝置上記住的姓名、手機、地址、點餐記憶與本機訂單記錄嗎？',
    clearConfirm: '清除',
    footnote: '快速鍵以鍵帽上的字元為準；注音等輸入法下改以實體按鍵比對',
    demoFootnote: '已選「不用了」者，鍵盤提醒不再自動出現；「重置 Demo 資料」會重新啟用提醒。',
    done: '完成',
    /** 鍵位表中，實體鍵 `Ctrl+Enter` 的顯示 */
    ctrlEnter: 'Ctrl/⌘ + Enter',
    jumpCategoryKeys: ['1–9', '0'],
  },

  // ───── 外殼 ─────
  shell: {
    nav: '主要導覽',
    brandOf: (name: string) => `店家資訊：${name}`,
    cart: (count: number) => (count > 0 ? `購物車，${count} 項` : '購物車'),
    lookupOrders: '查詢訂單',
    myOrders: '我的訂單',
    login: '登入',
    account: '我的',
    back: '返回',
    largeText: '大字',
    routeLoading: '頁面載入中…',
    dismissAnnouncement: '關閉公告',
    announcementLabel: '店家公告',
    bottomTab: {
      menu: '菜單',
      orders: '訂單',
      account: '我的',
    },
    footer: {
      storeInfo: '店家資訊',
      privacy: '隱私權政策',
      terms: '服務條款',
      shortcuts: '鍵盤快速鍵',
      preferences: '偏好設定',
      clearData: '清除我的資料',
      memoryNote: '點餐記憶僅存於此裝置，可在「清除我的資料」移除。',
      demoNote: '示範站台：資料皆為範例，不會產生實際訂單。',
      links: '頁尾連結',
    },
  },
} as const;
