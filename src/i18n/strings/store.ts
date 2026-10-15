// src/i18n/strings/store.ts —— 店家資訊與營業狀態文案（03 §6.3、PG-15、§9；繁體中文・台灣用語）
import type { PaymentMethod, Weekday } from '@/domain/types';

const weekdayNames: Record<Weekday, string> = {
  0: '週日',
  1: '週一',
  2: '週二',
  3: '週三',
  4: '週四',
  5: '週五',
  6: '週六',
};

const paymentLabels: Record<PaymentMethod, string> = {
  CASH: '現金',
  CREDIT_CARD: '信用卡',
  LINE_PAY: 'LINE Pay',
  JKOPAY: '街口支付',
};

export const store = {
  // ───── 營業狀態（StoreStatusBadge；03 §6.3）─────
  status: {
    loading: '載入營業狀態中…',
    unknown: '營業狀態暫時無法取得',
    /** 狀態名稱（給輔助科技的開頭，不只靠顏色與圖示） */
    stateLabel: { OPEN: '營業中', CLOSED: '休息中', PAUSED: '暫停接單' } as const,
    open: (hours: string) => `營業中・今日 ${hours}`,
    /** `when`：「今日 14:00」或跨午夜的「次日 02:00」 */
    openUntil: (when: string) => `營業中・${when} 打烊`,
    openNoHours: '營業中',
    outOfHours: (next: string) => `休息中・${next} 開始營業`,
    outOfHoursNoNext: '休息中',
    holiday: (next: string) => `今日公休・${next} 營業`,
    holidayNoNext: '今日公休',
    lastOrderPassed: (next: string) => `已停止接單・可預約 ${next}`,
    lastOrderPassedNoNext: '已停止接單',
    paused: '暫停接單',
    pausedUntil: (time: string) => `暫停接單・預計 ${time} 恢復`,
    pausedUntilWithin: (time: string, minutes: number) =>
      `暫停接單・預計 ${time} 恢復（約 ${minutes} 分鐘後）`,
    pausedShort: (minutes: number) => `暫停接單・約 ${minutes} 分鐘後恢復營業`,
    pausedSoon: '暫停接單・即將恢復營業',
    today: '今日',
    tomorrow: '明日',
    nextDay: '次日',
  },

  // ───── 店家資訊列 / 外殼 ─────
  header: {
    sectionLabel: '店家資訊',
    address: '地址',
    phone: '電話',
    retry: '重新載入店家資訊',
    loadFailed: '暫時無法取得店家資訊',
  },
  announcement: {
    region: '店家公告',
    dismiss: '關閉公告',
  },

  // ───── PG-15 店家資訊 ─────
  page: {
    title: '店家資訊',
    backToMenu: '回菜單',
    loadFailedTitle: '暫時無法取得店家資訊',
    loadFailedMessage: '請檢查網路連線後再試一次。',
    contact: {
      title: '聯絡與地址',
      address: '地址',
      openMap: '在地圖開啟',
      mapLabel: (address: string) => `在地圖開啟：${address}`,
      phone: '電話',
      callLabel: (phone: string) => `撥打電話 ${phone}`,
      email: '電子郵件',
    },
    hours: {
      title: '營業時間',
      caption: '每週營業時間',
      weekday: '星期',
      time: '營業時段',
      closed: '公休',
      today: '今日',
      todayLabel: '今日營業時間',
      overnight: (close: string) => `次日 ${close}`,
      weekdayNames,
      specialTitle: '特殊營業日',
      specialNone: '近 30 天沒有特殊營業日安排。',
      specialClosed: '公休',
      specialHours: (open: string, close: string) => `特殊營業 ${open}–${close}`,
      todaySpecial: (text: string) => `今日例外：${text}`,
    },
    services: {
      title: '取餐方式',
      pickup: '自取',
      delivery: '外送',
      dineIn: '內用',
      available: '開放',
      unavailable: '未開放',
      pickupLead: (minutes: number) => `自取約需 ${minutes} 分鐘準備`,
      deliveryLead: (minutes: number) => `外送約需 ${minutes} 分鐘`,
      minOrder: (amount: string) => `最低消費 ${amount}`,
    },
    delivery: {
      title: '外送範圍',
      caption: '外送行政區、運費與條件',
      district: '行政區',
      fee: '運費',
      minOrder: '最低消費',
      freeThreshold: '免運門檻',
      eta: '預估時間',
      etaMinutes: (n: number) => `約 ${n} 分鐘`,
      free: '免運',
      none: '—',
      empty: '目前沒有開放外送的行政區。',
      loadFailed: '外送範圍暫時無法載入。',
      scrollRegion: '外送範圍表（可左右捲動）',
    },
    payment: {
      title: '付款方式',
      labels: paymentLabels,
      empty: '付款方式請洽店家。',
    },
    utensils: {
      title: '餐具政策',
      body: '為了減少一次性餐具，預設不主動提供；需要時可在結帳時勾選「需要餐具」。',
    },
  },
} as const;
