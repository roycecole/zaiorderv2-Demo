// src/i18n/strings/cart.ts —— 文案（03 §9；繁體中文・台灣用語）
// 購物車頁（PG-03）、桌機訂單面板（CMP-31）、浮動購物車列（CMP-16）與加入購物車後的回饋（§9「加入購物車」「再點結果」）。
/** 金額中的空白改為不換行空白，避免「NT$ / 72」被折行拆開 */
const nb = (text: string): string => text.replace(/ /g, '\u00a0');

export const cart = {
  orderType: {
    legend: '取餐方式',
    /** 觸控面板的店內用語：PICKUP 為「外帶」（03 §5.6） */
    kioskPickup: '外帶',
    /** QR 桌號帶入後取餐方式固定為內用（03 PG-01、FR-CK-05）；文案與結帳頁一致 */
    lockedByTable: (table: string) => `已由 QR 帶入桌號 ${table}，取餐方式固定為內用`,
    /** 桌號確認中：先停用切換，避免確認前後取餐方式又被改回 */
    tableChecking: '正在確認桌號…',
  },

  bar: {
    count: (n: number) => `${n} 項`,
    view: '查看購物車',
  },

  panel: {
    title: '我的訂單',
    emptyHint: '點選商品右下角的「＋」即可加入。',
    /** QR 桌號已帶入：標題右側取代取餐方式徽章 */
    dineInTable: (table: string) => `內用・桌號 ${table}`,
  },

  empty: {
    title: '購物車還是空的',
    description: '來點好吃的吧！',
  },

  page: {
    /** document.title 與路由切換的頁名通報 */
    documentTitle: '購物車',
    title: (n: number) => `購物車（${n}）`,
    backToMenu: '返回菜單',
    clear: '清空',
    listLabel: '購物車品項',
    priceUpdated: '部分商品價格已更新',
    allUnavailable: '購物車裡的餐點目前都無法購買，可回菜單挑選其他餐點',
    expiryNote: '購物車內容會保留 24 小時，逾時將自動清空。',
  },

  checkout: '前往結帳',
  checkoutWithTotal: (amount: string) => `前往結帳 · ${amount}`,
  noLoginNote: '不需登入即可結帳',
  precheckFailed: '暫時無法預先確認餐點狀態，送出訂單時會再確認',
  expiredToast: '購物車超過 24 小時未更新，已自動清空',

  confirmRemove: {
    title: '要移除這個品項嗎？',
  },
  confirmClear: {
    title: '要清空購物車嗎？',
    description: (n: number) => `購物車內的 ${n} 項餐點會一併移除`,
    confirm: '清空',
  },

  summary: {
    subtotal: '小計',
    deliveryFee: '運費',
    discount: '折扣',
    total: '總計',
    shortfall: (amount: string, orderTypeLabel: string) => `還差 ${amount} 可${orderTypeLabel}`,
    feeAtCheckout: '運費將於結帳時依外送地址計算',
  },

  /** 品項行（CMP-17）與逐行狀態（PG-03 品項狀態表） */
  line: {
    notePrefix: '備註：',
    editLabel: (name: string) => `編輯 ${name}`,
    removeLabel: (name: string) => `移除 ${name}`,
    decreaseLabel: (name: string) => `減少一份 ${name}`,
    increaseLabel: (name: string) => `增加一份 ${name}`,

    unlisted: '已下架',
    optionUnavailable: '部分選項暫無供應',
    optionInvalid: '選項已變更，請重新選擇',
    insufficient: (remaining: number, requested: number) =>
      `今日只剩 ${remaining} 份（已選 ${requested} 份）`,
    groupInsufficient: (requested: number, remaining: number) =>
      `合計已選 ${requested} 份，今日只剩 ${remaining} 份`,
    occupied: '已被同商品其他行占用',
    atMost: (n: number) => `目前最多可購買 ${n} 份`,
    remainingToday: (n: number) => `今日剩 ${n} 份`,

    fitTo: (n: number) => `改為 ${n} 份`,
    fitLabel: (name: string, n: number) => `將${name}改為 ${n} 份`,
    reselect: '重新選擇',
    reselectLabel: (name: string) => `重新選擇${name}的選項`,
    adjusted: (n: number) => `已調整為 ${n} 份`,
    undoAdjustLabel: (name: string) => `復原${name}的份數調整`,

    priceUpdated: (from: string, to: string) => `價格已更新：${nb(from)} → ${nb(to)}`,
    priceUpdatedItem: (name: string, from: string, to: string) =>
      `${name}\u3000價格已更新：${nb(from)} → ${nb(to)}`,
  },

  /** 加入、再點、數量與移除後的 Toast 與 aria-live 通報 */
  feedback: {
    added: '已加入購物車',
    addedClamped: (max: number) => `已加入購物車（此品項已達上限 ${max} 份）`,
    addedAnnounce: (label: string, count: number, total: string) =>
      `已加入購物車：${label}，目前 ${count} 項，共 ${total}`,
    /** 已再點：{品名}（{選項摘要}）{金額}，目前 {n} 項，共 {小計}（§6.8） */
    repeated: (label: string, amount: string, count: number, total: string) =>
      `已再點：${label}${label.endsWith('）') ? '' : ' '}${amount}，目前 ${count} 項，共 ${total}`,
    undone: (label: string) => `已復原：${label}`,
    removed: (name: string) => `已移除：${name}`,
    removedAnnounce: (name: string, count: number, total: string) =>
      `已移除：${name}，目前 ${count} 項，共 ${total}`,
    restored: (name: string) => `已復原：${name}`,
    cleared: '購物車已清空',
    quantityChanged: (name: string, quantity: number, count: number, total: string) =>
      `${name} 數量 ${quantity}，目前 ${count} 項，共 ${total}`,
    panelAnnounce: (count: number, total: string) => `我的訂單，目前 ${count} 項，共 ${total}`,
  },
} as const;
