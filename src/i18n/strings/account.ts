// src/i18n/strings/account.ts —— 會員中心文案（03 PG-10～PG-14、§8.2、§8.4；繁體中文・台灣用語）
import type { DiscountType, OrderType, UserCouponStatus } from '@/domain/types';

/** 百分比折扣：折 10% → 「9 折」；折 15% → 「85 折」 */
function percentOff(value: number): string {
  const rate = 100 - value;
  return rate % 10 === 0 ? `${rate / 10} 折` : `${rate} 折`;
}

export const account = {
  // ───────── PG-10 會員中心 ─────────
  home: {
    pageTitle: '會員中心',
    noName: '尚未設定姓名',
    avatarFallback: '會',
    sectionShortcuts: '我的資料',
    sectionOthers: '其他',
    nav: {
      orders: { title: '歷史訂單', hint: '查看進行中與過去的訂單' },
      profile: { title: '個人資料', hint: '姓名、Email、行銷訊息' },
      addresses: { title: '地址簿', hint: '外送地址與預設地址' },
      favorites: { title: '我的最愛', hint: '收藏的餐點' },
      coupons: { title: '優惠券', hint: '可用、已使用與已過期' },
      privacy: { title: '隱私權政策', hint: '我們如何使用你的資料' },
    },
    logout: '登出',
    logoutDialog: {
      title: '確定要登出嗎？',
      description: '登出後購物車會保留，會員資料會從這個裝置清除。',
      confirm: '登出',
      cancel: '取消',
    },
    loggedOut: '已登出',
    deleteAccount: '刪除帳號',
    deleteDialog: {
      title: '確定要刪除帳號嗎？',
      description:
        '刪除後，個人資料、地址簿、我的最愛與優惠券會一併清除，歷史訂單會去識別化後保留，無法復原。',
      confirm: '刪除帳號',
      cancel: '取消',
      finalTitle: '最後確認',
      finalDescription: '帳號刪除後無法復原，也無法再以這支手機找回會員資料。',
      acknowledge: '我了解刪除後無法復原',
      finalConfirm: '確定刪除帳號',
      back: '返回',
    },
    deleted: '帳號已刪除',
    deleteFailed: '暫時無法刪除帳號，請稍後再試',
  },

  // ───────── PG-11 個人資料 ─────────
  profile: {
    pageTitle: '個人資料',
    phoneLabel: '手機號碼',
    phoneHint: '手機號碼是登入帳號，需要變更請聯絡店家',
    nameLabel: '姓名',
    nameInvalid: '請輸入姓名（最多 20 字）',
    emailLabel: 'Email',
    emailHint: '用於接收訂單通知（選填）',
    emailInvalid: '請輸入正確的 Email',
    marketing: '我願意收到店家的優惠與活動訊息',
    save: '儲存',
    saving: '儲存中…',
    saved: '已儲存',
    saveFailed: '暫時無法儲存，請稍後再試',
    loadFailed: '暫時無法載入個人資料',
  },

  // ───────── PG-12 地址簿 ─────────
  addresses: {
    pageTitle: '地址簿',
    intro: '儲存常用的外送地址，結帳時可直接選取。',
    add: '新增地址',
    emptyTitle: '還沒有儲存地址',
    emptyBody: '新增地址，下次外送更快',
    default: '預設',
    edit: '編輯',
    editLabel: (label: string) => `編輯地址：${label}`,
    setDefault: '設為預設',
    setDefaultLabel: (label: string) => `將「${label}」設為預設地址`,
    remove: '刪除',
    removeLabel: (label: string) => `刪除地址：${label}`,
    removeDialog: {
      title: '要刪除這個地址嗎？',
      description: (label: string) => `「${label}」會從地址簿移除。`,
      confirm: '刪除',
    },
    removed: '已刪除地址',
    removeFailed: '暫時無法刪除，請稍後再試',
    defaultSet: '已設為預設地址',
    saved: '已儲存地址',
    saveFailed: '暫時無法儲存，請稍後再試',
    loadFailed: '暫時無法載入地址簿',
    note: (note: string) => `備註：${note}`,
    form: {
      addTitle: '新增地址',
      editTitle: '編輯地址',
      label: '地址名稱',
      labelHint: '例：家、公司（最多 10 字）',
      labelInvalid: '請輸入 1～10 字的地址名稱',
      recipientName: '收件人姓名',
      recipientNameInvalid: '請輸入收件人姓名（最多 20 字）',
      recipientPhone: '收件人手機',
      recipientPhoneInvalid: '請輸入正確的手機號碼（09 開頭，共 10 碼）',
      city: '縣市',
      cityPlaceholder: '請選擇縣市',
      cityInvalid: '請選擇縣市',
      district: '行政區',
      districtPlaceholder: '請選擇行政區',
      districtInvalid: '請選擇行政區',
      zipCode: '郵遞區號',
      zipCodeHint: '選擇行政區後會自動帶入',
      zipCodeInvalid: '郵遞區號為 3 碼數字',
      line: '詳細地址',
      lineHint: '路名、門牌、樓層（5～100 字）',
      lineInvalid: '請輸入詳細地址（5～100 字）',
      note: '外送備註',
      noteInvalid: '備註最多 50 字',
      isDefault: '設為預設地址',
      save: '儲存',
      saving: '儲存中…',
      cancel: '取消',
      zonesHint: '目前可外送的區域',
    },
  },

  // ───────── PG-13 我的最愛 ─────────
  favorites: {
    pageTitle: '我的最愛',
    emptyTitle: '還沒有收藏',
    emptyBody: '點商品右上角的愛心加入',
    emptyAction: '去逛菜單',
    loadFailed: '暫時無法載入我的最愛',
    addToCart: '加入購物車',
    addToCartLabel: (name: string) => `將 ${name} 加入購物車`,
    chooseOptions: '選擇選項',
    chooseOptionsLabel: (name: string) => `選擇 ${name} 的選項`,
    remove: '取消收藏',
    removeLabel: (name: string) => `取消收藏 ${name}`,
    removed: (name: string) => `已取消收藏：${name}`,
    removeFailed: '暫時無法取消收藏，請稍後再試',
    addFailed: '暫時無法收藏，請稍後再試',
    added: (name: string) => `已加入購物車：${name}`,
    soldOut: '今日售完',
    unlisted: '已下架',
    unavailable: '目前無法加入',
    loginToFavorite: '登入後可收藏喜愛的餐點',
    login: '登入',
    cartLimit: '購物車的品項已達上限',
  },

  // ───────── PG-14 我的優惠券 ─────────
  coupons: {
    pageTitle: '我的優惠券',
    tabsLabel: '優惠券分類',
    tabs: { available: '可用', used: '已使用', expired: '已過期' },
    emptyTitle: '目前沒有可用的優惠券',
    emptyUsed: '還沒有使用過的優惠券',
    emptyExpired: '沒有已過期的優惠券',
    loadFailed: '暫時無法載入優惠券',
    code: (code: string) => `折扣碼 ${code}`,
    valueLabel: (type: DiscountType, value: number): string => {
      switch (type) {
        case 'PERCENT':
          return percentOff(value);
        case 'FIXED_AMOUNT':
          return `折 NT$ ${value.toLocaleString('en-US')}`;
        case 'FREE_DELIVERY':
          return '免運';
      }
    },
    minOrder: (amount: number) => `小計滿 NT$ ${amount.toLocaleString('en-US')} 可用`,
    noMinOrder: '不限最低消費',
    maxDiscount: (amount: number) => `最高折 NT$ ${amount.toLocaleString('en-US')}`,
    orderTypes: (types: ReadonlyArray<OrderType>): string => {
      const names: Record<OrderType, string> = { PICKUP: '自取', DELIVERY: '外送', DINE_IN: '內用' };
      return `適用：${types.map((x) => names[x]).join('、')}`;
    },
    memberOnly: '會員專屬',
    validUntil: (date: string) => `效期至 ${date}`,
    expiredOn: (date: string) => `已於 ${date}到期`,
    usedOn: (date: string) => `使用於 ${date}`,
    status: {
      AVAILABLE: '可用',
      USED: '已使用',
      EXPIRED: '已過期',
    } satisfies Record<UserCouponStatus, string>,
    howToUse: '結帳時輸入折扣碼即可使用',
  },
} as const;
