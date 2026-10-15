// src/i18n/strings/common.ts —— 通用文案（03 §9；繁體中文・台灣用語）
// 通用元件（components）的預設 aria 文字與跨功能共用的詞彙放在這裡；功能專屬文案請寫在各自的 strings/<feature>.ts。
export const common = {
  // 通用動作
  close: '關閉',
  cancel: '取消',
  confirm: '確認',
  done: '完成',
  ok: '好',
  back: '返回',
  next: '下一步',
  retry: '重試',
  reload: '重新載入',
  save: '儲存',
  edit: '編輯',
  remove: '移除',
  delete: '刪除',
  clear: '清除',
  add: '加入',
  undo: '復原',
  search: '搜尋',
  viewAll: '查看全部',
  skip: '略過',
  learnMore: '了解更多',
  callStore: '致電店家',
  backToMenu: '回菜單',

  // 狀態
  loading: '載入中…',
  required: '必填',
  optional: '選填',
  errorTitle: '發生了一點問題',
  requestId: '參考編號',
  offline: '目前沒有網路連線，部分功能暫時無法使用',

  // 價格與庫存（03 §6.2、§6.6）
  priceFrom: '起',
  originalPrice: '原價',
  currentPrice: '現價',
  free: '免運',
  noValue: '—',
  soldOut: '今日售完',
  limitReached: '已達上限',
  unavailable: '暫無供應',
  remaining: (n: number) => `剩 ${n} 份`,
  remainingToday: (n: number) => `今日剩 ${n} 份`,
  maxReachedToday: (n: number) => `今日只剩 ${n} 份，已達上限`,
  maxQuantityReached: (n: number) => `此品項已達上限 ${n} 份`,

  // 數量步進器的預設名稱
  stepper: {
    decrease: '減少數量',
    increase: '增加數量',
    quantityOf: (name: string) => `${name} 數量`,
    removeOf: (name: string) => `移除${name}`,
  },

  // InlineAlert 的語意前綴（給輔助科技；視覺上由圖示與顏色表達）
  tone: {
    info: '提示',
    success: '成功',
    warning: '注意',
    error: '錯誤',
  },

  // 商品標籤（CMP-09、03 §6.6）
  productTag: {
    HOT: '熱銷',
    NEW: '新品',
    CHEF_PICK: '店長推薦',
    SPICY: '辣',
    VEGETARIAN: '素食',
    LIMITED: '限量',
  },

  // 取餐方式（店內用語見 kiosk 文案；此為一般用語）
  orderType: {
    PICKUP: '自取',
    DELIVERY: '外送',
    DINE_IN: '內用',
  },
} as const;
