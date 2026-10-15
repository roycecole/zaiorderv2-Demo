// src/i18n/strings/menu.ts —— 文案（03 §9；繁體中文・台灣用語）
// 菜單頁（PG-01）、商品卡（§6.6）、「常點」（§6.8）與商品面板（PG-02）。購物車與加入結果的回饋文案在 cart.ts。
import type { Allergen } from '@/domain/types';

const allergen: Record<Allergen, string> = {
  CRUSTACEAN: '甲殼類',
  MOLLUSC: '軟體動物',
  PEANUT: '花生',
  MILK: '乳製品',
  EGG: '蛋',
  TREE_NUT: '堅果',
  SESAME: '芝麻',
  GLUTEN: '麩質',
  SOY: '大豆',
  FISH: '魚類',
  MANGO: '芒果',
  SULFITE: '亞硫酸鹽',
};

export const menu = {
  /** 頁面 h1（視覺隱藏，路由切換時朗讀頁標題） */
  title: '菜單',
  /** 立即單的預估時間（店家資訊列） */
  eta: (min: number, max: number) => (min === max ? `預估 ${min} 分` : `預估 ${min}–${max} 分`),
  titleOf: (storeName: string) => `${storeName}・菜單`,
  loading: '菜單載入中…',
  loadError: '菜單暫時無法載入',
  empty: {
    title: '菜單準備中',
    description: '目前沒有可供點餐的餐點，請稍後再來看看',
  },

  /** QR 桌號（`?table=`）：菜單頂部的內用提示（03 PG-01） */
  table: {
    label: '內用桌號',
    badge: (table: string) => `內用・桌號 ${table}`,
    hint: '取餐方式已固定為內用，結帳時不需再輸入桌號',
    checking: '正在確認桌號…',
    /** 桌號無法辨識、已回到一般點餐時的提示（03 PG-01）；結帳頁共用同一句 */
    notFoundFallback:
      '找不到 QR 帶入的桌號，已改為一般點餐；要內用請改選「內用」（桌號可留空），或洽店員',
    /** 桌號有效，但店家目前未開放內用，已回到一般點餐時的提示（03 PG-01）；結帳頁共用 */
    unavailableFallback: '店家目前未開放內用，已改為一般點餐',
  },

  search: {
    label: '搜尋菜單',
    placeholder: '搜尋菜單…',
    clear: '清除搜尋',
    cleared: '已清除搜尋',
    resultsTitle: '搜尋結果',
    emptyTitle: (query: string) => `找不到「${query}」`,
    emptyDescription: '試試其他關鍵字，或清除搜尋',
  },

  chips: {
    label: '菜單分類',
    all: '全部',
    hot: '熱銷',
    hotIcon: '🔥',
    /** 名稱含數量，例「飯類，5 項」 */
    itemLabel: (name: string, count: number) => `${name}，${count} 項`,
    prev: '上一頁',
    next: '下一頁',
    selected: (name: string, count: number) => `已切換到：${name}，${count} 項`,
  },

  section: {
    count: (n: number) => `${n} 項`,
  },

  layout: {
    label: '商品版面',
    grid: '圖卡',
    list: '清單',
    changed: (name: string) => `已切換為${name}版面`,
  },

  recent: {
    title: '常點的餐點',
    subtitle: '依你上次點餐的選項',
  },

  banner: {
    label: '最新消息',
    roleDescription: '輪播',
    previous: '上一則',
    next: '下一則',
    position: (index: number, total: number) => `${index} / ${total}`,
  },

  card: {
    add: '加入',
    addLabel: (name: string) => `加入 ${name}`,
    addLabelInCart: (name: string, inCart: number) => `加入 ${name}（購物車已有 ${inCart} 份）`,
    adjustLabel: (name: string) => `調整選項：${name}`,
    repeat: '再點',
    repeatLabel: (name: string, last: string) =>
      last === '' ? `再點 ${name}` : `再點 ${name}，上次：${last}`,
    last: (labels: string) => `上次：${labels}`,
    soldOutAction: '售完',
    soldOutLabel: (name: string) => `${name} 今日售完`,
    decreaseLabel: (name: string) => `減少一份 ${name}`,
    increaseLabel: (name: string) => `增加一份 ${name}`,
    removeLabel: (name: string) => `移除 ${name}`,
    addBlocked: '目前暫時無法加入',
    repeatFailed: '暫時無法再點，請稍後再試',
    noMemory: '這項商品沒有點餐記憶',
    focusFirst: '請先以方向鍵選取商品',
    // 取得焦點的商品卡底部提示列（僅單鍵快速鍵啟用時顯示）
    hintAdd: '加入',
    hintRepeat: '再點',
    hintFavorite: '收藏',
    hintOpen: '詳情',
  },

  favorite: {
    addLabel: (name: string) => `收藏 ${name}`,
    removeLabel: (name: string) => `取消收藏 ${name}`,
    added: (name: string) => `已加入我的最愛：${name}`,
    removed: (name: string) => `已取消收藏：${name}`,
    loginHint: '登入後可收藏喜愛的餐點',
    failed: '收藏失敗，請稍後再試',
  },

  sheet: {
    loadingTitle: '餐點資訊載入中',
    loadError: '暫時無法載入這項餐點',
    add: '加入購物車',
    update: '更新購物車',
    updated: '已更新購物車',
    updatedAnnounce: (label: string, count: number, total: string) =>
      `已更新購物車：${label}，目前 ${count} 項，共 ${total}`,

    // 選項群組標頭（§6.5）：必選不使用 danger 色
    required: '必選',
    optional: '選填',
    singleChoice: '單選',
    atLeast: (n: number) => `至少 ${n} 項`,
    atMost: (n: number) => `最多 ${n} 項`,
    noneOption: '不選擇',
    pickOne: (groupName: string) => `請選擇${groupName}`,
    pickAtLeast: (groupName: string, n: number) => `${groupName}至少要選 ${n} 項`,
    pickAtMost: (groupName: string, n: number) => `${groupName}最多選 ${n} 項`,

    noteLabel: '備註',
    notePlaceholder: '例：不要蔥',
    noteTooLong: (max: number) => `備註最多 ${max} 字`,

    quantityLabel: '數量',
    quantityAnnounce: (n: number, total: string) => `數量 ${n}，${total}`,

    // 點餐記憶（§6.8）
    appliedLast: (text: string) => `已套用上次的選擇：${text}`,
    partialMemory: '部分選項已不提供，已改用預設',
    restoreDefault: '恢復預設',
    restored: '已恢復預設選項',

    allergens: '過敏原',
    priceDescription: (price: string) => `單價 ${price}`,
  },

  allergen,
} as const;
