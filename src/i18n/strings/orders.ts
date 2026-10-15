// src/i18n/strings/orders.ts —— 訂單追蹤、歷史訂單、查詢訂單文案（03 PG-06～PG-08、§6.4、§9；繁體中文・台灣用語）
import type { OperatorType, OrderType, PaymentMethod, PaymentStatus } from '@/domain/types';

/** 秒數轉為「n 分 m 秒」或「m 秒」 */
function waitText(seconds: number): string {
  const total = Math.max(1, Math.ceil(seconds));
  if (total < 60) return `${total} 秒`;
  const m = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${m} 分鐘` : `${m} 分 ${rest} 秒`;
}

const orderTypeLabel: Record<OrderType, string> = {
  PICKUP: '自取',
  DELIVERY: '外送',
  DINE_IN: '內用',
};

/** 狀態名稱（狀態徽章、清單卡片、通報共用）；READY / COMPLETED 依取餐方式（03 §6.4） */
const statusLabel = {
  PENDING_PAYMENT: '等待付款',
  PENDING: '等待店家確認',
  ACCEPTED: '製作中',
  READY: { PICKUP: '可取餐', DELIVERY: '餐點完成，等待外送', DINE_IN: '餐點完成' },
  DELIVERING: '外送中',
  COMPLETED: { PICKUP: '已取餐', DELIVERY: '已送達', DINE_IN: '已完成' },
  CANCELLED: '已取消',
} as const;

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: '現金',
  CREDIT_CARD: '信用卡',
  LINE_PAY: 'LINE Pay',
  JKOPAY: '街口支付',
};

export const orders = {
  // ───────── 通用 ─────────
  orderType: orderTypeLabel,
  pickupNo: '取餐號碼',
  /** 朗讀用：以空白分隔，避免被唸成單字（03 §10.4） */
  pickupNoSpoken: (no: string) => `取餐號碼 ${no.split('').join(' ')}`,
  orderNo: '訂單編號',
  statusLabel,
  /** 時間軸、狀態徽章的語意補充（不只靠顏色與圖示） */
  stepState: {
    done: '已完成',
    current: '目前進度',
    upcoming: '尚未開始',
    cancelled: '已取消',
  },

  // ───────── OrderTimeline 步驟文案（03 §6.4） ─────────
  timeline: {
    label: '訂單進度',
    awaitingPayment: '等待付款',
    submitted: '訂單已送出',
    submittedWaiting: '訂單已送出，等待店家確認',
    preparing: '製作中',
    ready: {
      PICKUP: '可取餐',
      DINE_IN: '餐點完成',
      DELIVERY: {
        upcoming: '餐點完成，等待外送',
        waiting: '餐點完成，等待外送',
        delivering: '外送中',
        done: '已交給外送員',
      },
    },
    completed: { PICKUP: '已取餐', DELIVERY: '已送達', DINE_IN: '已完成' },
    cancelled: '已取消',
    expectedAt: (time: string) => `預計 ${time}`,
    scheduledAt: (time: string) => `預約 ${time}`,
  },

  // ───────── PG-06 訂單追蹤 / 詳情 ─────────
  tracking: {
    pageTitle: '訂單追蹤',
    loading: '載入訂單中…',
    copy: '複製',
    copyLabel: (no: string) => `複製訂單編號 ${no}`,
    copied: '已複製訂單編號',
    copyFailed: '無法自動複製，請長按編號手動複製',
    refresh: '立即更新',
    refreshing: '更新中…',
    refreshed: '已更新訂單狀態',
    refreshFailed: '暫時無法更新，稍後會自動再試',
    staleWarning: '目前無法取得最新狀態，稍後會自動再試。',
    enlarge: '放大顯示取餐號碼',
    enlargeLabel: (no: string) => `放大顯示取餐號碼 ${no.split('').join(' ')}`,
    enlargedTitle: '取餐號碼',
    enlargedHint: '請向店員出示這個號碼',

    // 狀態說明（狀態卡的副標）
    hint: {
      PENDING_PAYMENT: '訂單已建立，完成付款後才會送給店家',
      PENDING: '訂單已送出，等待店家確認',
      ACCEPTED: '店家已接單，正在準備餐點',
      READY: {
        PICKUP: (no: string) => `餐點完成了，請憑取餐號碼 ${no} 取餐`,
        DELIVERY: '餐點完成了，等待外送員出發',
        DINE_IN: (no: string) => `餐點完成了，請憑取餐號碼 ${no} 取餐`,
      },
      DELIVERING: '外送員已出發，請留意電話',
      COMPLETED: '謝謝你的光臨',
      CANCELLED: '這筆訂單已取消',
    },
    /** 狀態卡預計時間行：自取「預計 12:35 可取餐」 */
    expected: {
      PICKUP: (time: string) => `預計 ${time} 可取餐`,
      DELIVERY: (time: string) => `預計 ${time} 送達`,
      DINE_IN: (time: string) => `預計 ${time} 上餐`,
    },
    expectedMinutes: (minutes: number) => `約 ${minutes} 分鐘`,
    almostReady: '即將完成',
    scheduled: {
      PICKUP: (when: string) => `預約 ${when} 取餐`,
      DELIVERY: (when: string) => `預約 ${when} 送達`,
      DINE_IN: (when: string) => `預約 ${when} 用餐`,
    },
    /** 取 Order.acceptBy（伺服器計算，前端不推算；03 §9） */
    acceptBy: (time: string) => `店家將於 ${time} 前確認`,

    // 付款提醒
    payReminder: (time: string) => `已保留餐點與取餐時段，請於 ${time} 前完成付款`,
    payCountdown: (mmss: string) => `剩餘 ${mmss}`,
    payCountdownSpoken: (minutes: number, seconds: number) =>
      `付款時間剩 ${minutes} 分 ${seconds} 秒`,
    payTwoMinutes: '付款時間剩 2 分鐘',
    payNow: '前往付款',
    paymentExpired: '超過付款時間，訂單已自動取消，保留的餐點與時段已釋出。想再訂可按「再來一單」',
    paymentFailed: '付款未完成，可重新付款或改用現金',

    // 取消
    cancelledBy: {
      CUSTOMER: '你取消了這筆訂單',
      STORE: '店家取消了這筆訂單',
      SYSTEM: '系統取消了這筆訂單',
    } satisfies Record<OperatorType, string>,
    cancelReason: (reason: string) => `原因：${reason}`,
    refunding: '款項正在退回原付款方式，完成後會更新狀態',
    refunded: '款項已退回原付款方式',

    // 資訊區塊
    sectionProgress: '訂單進度',
    sectionPickup: '取餐資訊',
    sectionDelivery: '外送資訊',
    sectionDineIn: '內用資訊',
    sectionItems: '訂單明細',
    sectionPayment: '付款與發票',
    pickupAt: (store: string) => `自取・${store}`,
    pickupTime: '取餐時間',
    deliveryAddress: '外送地址',
    deliveryNote: (note: string) => `外送備註：${note}`,
    contact: '聯絡人',
    tableNo: (no: string) => `桌號 ${no}`,
    dineInAt: (store: string) => `內用・${store}`,
    storePhone: '店家電話',
    asap: '盡快',
    itemsSummary: (count: number, total: string) => `${count} 項・${total}`,
    expand: '展開明細',
    collapse: '收合明細',
    itemQuantity: (n: number) => `× ${n}`,
    itemNote: (note: string) => `備註：${note}`,
    subtotal: '小計',
    deliveryFee: '運費',
    discount: '折扣',
    discountWithCode: (code: string) => `折扣（${code}）`,
    total: '總計',
    free: '免運',
    utensils: { yes: '需要餐具', no: '不需要餐具' },
    orderNote: (note: string) => `訂單備註：${note}`,
    paymentMethod: '付款方式',
    paymentMethodLabel,
    placedAt: '下單時間',
    paymentStatusLabel: {
      UNPAID: '尚未付款',
      PAID: '已付款',
      REFUNDING: '退款處理中',
      REFUNDED: '已退款',
    } satisfies Record<PaymentStatus, string>,
    cashOnPickup: '取餐時付款',
    cashUnpaidCancelled: '未付款',
    invoice: '發票',
    invoiceType: {
      PAPER: '紙本發票',
      MOBILE_BARCODE: '手機條碼載具',
      CITIZEN_CERT: '自然人憑證載具',
      DONATION: '捐贈發票',
      COMPANY: '統一編號發票',
    },
    invoiceStatus: {
      PENDING: '尚未開立',
      ISSUED: '已開立',
      VOIDED: '已作廢',
    },
    invoiceNo: (no: string) => `發票號碼 ${no}`,
    invoiceCarrier: (code: string) => `載具 ${code}`,
    invoiceTaxId: (id: string) => `統一編號 ${id}`,
    invoiceDonate: (code: string) => `愛心碼 ${code}`,

    // 動作
    callStore: '致電店家',
    callStoreLabel: (phone: string) => `致電店家 ${phone}`,
    reorder: '再來一單',
    reordering: '加入中…',
    cancelOrder: '取消訂單',
    backToMenu: '回菜單',
    lookupOrder: '查詢訂單',

    // 取消確認（03 §8.4）
    cancelDialog: {
      title: '確定要取消這筆訂單嗎？',
      descriptionUnpaid: '取消後，保留的餐點與取餐時段會釋出。',
      descriptionPaid: '取消後，已付款的金額會退回原付款方式，保留的餐點與取餐時段會釋出。',
      reasonLabel: '取消原因',
      reasonPlaceholder: '請選擇（選填）',
      reasons: ['不小心點錯了', '想更改餐點內容', '等太久了', '改變行程', '其他'],
      confirm: '確認取消',
      keep: '保留訂單',
    },
    cancelled: '訂單已取消',
    cancelledRefund: '訂單已取消，款項會退回原付款方式',
    cancelConflict: '店家已接單，無法自行取消，請致電店家',
    cancelFailed: '暫時無法取消，請稍後再試或致電店家',

    // 狀態變更提醒（FR-OD-10）
    statusChanged: (label: string) => `訂單狀態更新：${label}`,
    statusChangedAnnounce: (label: string, pickupNo: string) =>
      `訂單狀態：${label}，取餐號碼 ${pickupNo.split('').join(' ')}`,
    titlePrefixReady: '（可取餐）',

    // 找不到訂單（404）
    notFoundTitle: '找不到訂單',
    notFoundBody: '找不到訂單，請確認編號與手機',
    loadFailedTitle: '暫時無法載入訂單',

    // 訪客保存提示（FR-OD-11；03 §9）
    savePrompt: {
      title: '想保存這筆訂單？',
      body: '以手機建立會員（可略過）',
      action: '建立會員',
      dismiss: '關閉保存提示',
    },

    // 觸控面板完成畫面（FLOW-21、03 PG-06）
    kiosk: {
      title: '訂單已送出',
      payAtCounter: '請至櫃檯付款並等候叫號',
    },
  },

  // ───────── 再來一單（FLOW-13、03 §9） ─────────
  reorder: {
    added: '已加入購物車',
    addedCount: (n: number) => `已將 ${n} 項餐點加入購物車`,
    failed: '暫時無法再來一單，請稍後再試',
    allSkipped: '這筆訂單的餐點目前都無法加入購物車',
    dialogTitle: '再來一單',
    adjustedTitle: '已調整份數',
    /** 03 §9：已將「{品名}」調整為 {n} 份（今日限量） */
    adjusted: (name: string, n: number) => `已將「${name}」調整為 ${n} 份（今日限量）`,
    adjustedMax: (name: string, n: number) => `已將「${name}」調整為 ${n} 份（單一品項上限）`,
    optionsTitle: '部分選項已不提供',
    optionsDropped: (name: string) => `「${name}」的部分選項已不提供，已改用預設`,
    skippedTitle: '未加入的餐點',
    skipped: {
      UNLISTED: (name: string) => `${name}\u3000已下架`,
      SOLD_OUT: (name: string) => `${name}\u3000今日售完`,
      OPTIONS: (name: string) => `${name}\u3000的必選選項暫無供應`,
      LINE_LIMIT: (name: string) => `${name}\u3000購物車的品項已達上限`,
      CART_LIMIT: (name: string) => `${name}\u3000購物車內已達此品項的數量上限`,
    },
    goCart: '前往購物車',
    stay: '留在這裡',
    close: '知道了',
  },

  // ───────── PG-07 歷史訂單 ─────────
  history: {
    pageTitle: '歷史訂單',
    tabs: { active: '進行中', completed: '已完成', cancelled: '已取消' },
    tabsLabel: '訂單分類',
    emptyTitle: '還沒有訂單',
    emptyBody: {
      active: '現在就去點餐吧',
      completed: '完成的訂單會出現在這裡',
      cancelled: '取消的訂單會出現在這裡',
    },
    loadMore: '載入更多',
    loadingMore: '載入中…',
    allLoaded: '已顯示全部訂單',
    loadFailed: '暫時無法載入訂單',
    card: {
      detail: '查看詳情',
      detailLabel: (orderNo: string) => `查看詳情，訂單 ${orderNo}`,
      reorder: '再來一單',
      reorderLabel: (orderNo: string) => `再來一單，訂單 ${orderNo}`,
      scheduled: (when: string) => `預約 ${when}`,
      placedAt: (when: string) => `下單時間 ${when}`,
    },
    guestNote: '登入前以訪客身分下的訂單不會出現在這裡，可由「查詢訂單」的本機記錄查看。',
  },

  // ───────── PG-08 訪客查詢訂單 ─────────
  lookup: {
    pageTitle: '查詢訂單',
    intro: '輸入訂單編號與下單時留下的手機號碼，不需要登入。',
    orderNoLabel: '訂單編號',
    orderNoHint: '例：ZO261014K7M3QX（在訂單成立頁或簡訊中）',
    orderNoRequired: '請輸入訂單編號',
    orderNoTooLong: '訂單編號格式不正確',
    phoneLabel: '手機號碼',
    phoneInvalid: '請輸入正確的手機號碼（09 開頭，共 10 碼）',
    submit: '查詢',
    submitting: '查詢中…',
    /** 不揭露是哪個欄位錯誤（EC-15） */
    notFound: '找不到訂單，請確認編號與手機',
    rateLimited: '查詢太頻繁，請稍後再試',
    retryIn: (seconds: number) => `請等 ${waitText(seconds)}後再試`,
    recentTitle: '本機記錄的近期訂單',
    recentHint: '記錄在這個裝置，最多保留 10 筆',
    recentEmpty: '這個裝置上還沒有訂單記錄',
    recentOpen: (orderNo: string) => `查看訂單 ${orderNo}`,
    recentPlacedAt: (when: string) => `下單 ${when}`,
    memberHint: '已有會員帳號？登入後可在「我的訂單」查看所有訂單。',
    loginLink: '登入',
  },
} as const;
