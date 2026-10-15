// src/services/api/mock/seed/menu.ts —— 菜單種子資料（08 §3：8 個分類、34 項商品、19 個選項群組）
import type { Allergen, ID, ProductTag, SelectionType } from '@/domain/types';

export interface SeedOption {
  id: ID;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface SeedOptionGroup {
  id: ID;
  name: string;
  selectionType: SelectionType;
  minSelect: number;
  maxSelect: number;
  options: SeedOption[];
}

export interface SeedCategory {
  id: ID;
  name: string;
  icon: string;
  description?: string;
}

export interface SeedProduct {
  id: ID;
  categoryId: ID;
  name: string;
  /** 可省略（最小商品，BR-30 / 03 §6.7） */
  description?: string;
  /** 相對於 public/images 的路徑；省略 = 無圖（以分類圖示佔位） */
  image?: string;
  basePrice: number;
  tags: ProductTag[];
  allergens: Allergen[];
  /** 選項群組（依顯示順序） */
  groupIds: ID[];
  /** 每日限量；null = 不限 */
  dailyLimit: number | null;
  /** 種子的手動售完旗標（僅約束當前營業日；實際狀態由 DemoState.soldOutProductIds 承載） */
  manualSoldOut: boolean;
}

const opt = (
  id: ID,
  name: string,
  priceDelta = 0,
  isDefault = false,
  isAvailable = true,
): SeedOption => ({ id, name, priceDelta, isDefault, isAvailable });

const single = (id: ID, name: string, options: SeedOption[], required = true): SeedOptionGroup => ({
  id,
  name,
  selectionType: 'SINGLE',
  minSelect: required ? 1 : 0,
  maxSelect: 1,
  options,
});

const multiple = (
  id: ID,
  name: string,
  minSelect: number,
  maxSelect: number,
  options: SeedOption[],
): SeedOptionGroup => ({ id, name, selectionType: 'MULTIPLE', minSelect, maxSelect, options });

/** 08 §3.1 */
export const OPTION_GROUPS: SeedOptionGroup[] = [
  single('og_size_bowl', '份量', [opt('opt_bowl_s', '小碗', 0, true), opt('opt_bowl_l', '大碗', 20)]),
  single('og_spice', '辣度', [
    opt('opt_spice_none', '不辣', 0, true),
    opt('opt_spice_s', '小辣'),
    opt('opt_spice_m', '中辣'),
    opt('opt_spice_l', '大辣'),
  ]),
  multiple('og_rice_topping', '加料', 0, 3, [
    opt('opt_egg', '滷蛋', 12),
    opt('opt_tofu_dry', '滷豆干', 10),
    opt('opt_fried_egg', '荷包蛋', 15),
    opt('opt_extra_meat', '加肉燥', 10),
  ]),
  single('og_noodle', '麵條', [
    opt('opt_noodle_thin', '細麵', 0, true),
    opt('opt_noodle_wide', '寬麵'),
    opt('opt_noodle_glass', '冬粉'),
  ]),
  single('og_herb', '香菜', [opt('opt_herb_yes', '要香菜', 0, true), opt('opt_herb_no', '不要香菜')]),
  single('og_garlic', '蒜泥', [opt('opt_garlic_yes', '要蒜泥', 0, true), opt('opt_garlic_no', '不要蒜泥')]),
  single('og_tofu_style', '做法', [
    opt('opt_tofu_fried', '酥炸', 0, true),
    opt('opt_tofu_steamed', '麻辣蒸', 10),
  ]),
  single('og_salt_season', '調味', [
    opt('opt_season_pepper', '胡椒鹽', 0, true),
    opt('opt_season_plum', '梅子粉'),
    opt('opt_season_cumin', '孜然'),
  ]),
  single('og_cup', '杯型', [opt('opt_cup_m', '中杯', 0, true), opt('opt_cup_l', '大杯', 10)]),
  single('og_sugar', '甜度', [
    opt('opt_sugar_full', '正常糖'),
    opt('opt_sugar_less', '少糖'),
    opt('opt_sugar_half', '半糖', 0, true),
    opt('opt_sugar_light', '微糖'),
    opt('opt_sugar_none', '無糖'),
  ]),
  single('og_ice', '冰量', [
    opt('opt_ice_full', '正常冰'),
    opt('opt_ice_less', '少冰'),
    opt('opt_ice_light', '微冰', 0, true),
    opt('opt_ice_none', '去冰'),
    opt('opt_ice_hot', '熱'),
  ]),
  multiple('og_drink_topping', '飲品加料', 0, 2, [
    opt('opt_top_pearl', '珍珠', 10),
    opt('opt_top_herbjelly', '仙草', 10),
    opt('opt_top_coconut', '椰果', 10),
  ]),
  multiple('og_dessert_topping', '配料', 0, 3, [
    opt('opt_dt_peanut', '花生'),
    opt('opt_dt_redbean', '紅豆'),
    opt('opt_dt_tapioca', '粉圓'),
    opt('opt_dt_barley', '薏仁'),
  ]),
  single('og_combo_main', '主餐', [
    opt('opt_cm_lurou', '招牌滷肉飯', 0, true),
    opt('opt_cm_chicken', '嘉義雞肉飯'),
    opt('opt_cm_porkchop', '古早味排骨飯', 30),
  ]),
  single('og_combo_soup', '附湯', [
    opt('opt_cs_meatball', '貢丸湯', 0, true),
    opt('opt_cs_clam', '蛤蜊絲瓜湯', 15),
  ]),
  single('og_combo_drink', '飲料', [
    opt('opt_cd_blacktea', '古早味紅茶', 0, true),
    opt('opt_cd_wintermelon', '冬瓜茶'),
    opt('opt_cd_soymilk', '豆漿'),
  ]),
  multiple('og_share_mains', '主餐（選 2）', 2, 2, [
    opt('opt_sm_lurou', '招牌滷肉飯'),
    opt('opt_sm_chicken', '嘉義雞肉飯'),
    opt('opt_sm_porkchop', '排骨飯', 30),
    opt('opt_sm_beef', '紅燒牛肉麵', 60),
  ]),
  single('og_share_snack', '小吃（選 1）', [
    opt('opt_ss_oyster', '蚵仔煎', 0, true),
    opt('opt_ss_chicken', '鹽酥雞'),
    opt('opt_ss_tofu', '臭豆腐'),
  ]),
  single('og_share_side', '小菜（選 1）', [
    opt('opt_sd_greens', '燙青菜', 0, true),
    opt('opt_sd_tofu', '皮蛋豆腐'),
    opt('opt_sd_cucumber', '涼拌小黃瓜'),
  ]),
];

/** 08 §3.2；顯示順序即 sort_order */
export const CATEGORIES: SeedCategory[] = [
  { id: 'cat_rice', name: '飯類', icon: '🍚' },
  { id: 'cat_noodle', name: '麵食', icon: '🍜' },
  { id: 'cat_snack', name: '小吃', icon: '🍢' },
  { id: 'cat_soup', name: '湯品', icon: '🥣' },
  { id: 'cat_side', name: '小菜', icon: '🥬' },
  { id: 'cat_drink', name: '飲品', icon: '🧋' },
  { id: 'cat_dessert', name: '甜點', icon: '🍮' },
  { id: 'cat_combo', name: '套餐', icon: '🍱' },
];

const p = (
  id: ID,
  categoryId: ID,
  name: string,
  basePrice: number,
  more: Partial<Omit<SeedProduct, 'id' | 'categoryId' | 'name' | 'basePrice'>> = {},
): SeedProduct => ({
  id,
  categoryId,
  name,
  basePrice,
  tags: [],
  allergens: [],
  groupIds: [],
  dailyLimit: null,
  manualSoldOut: false,
  ...more,
});

/**
 * 34 項商品。刻意涵蓋：有圖 / 無圖（12 張有圖）、有 / 無描述、無選項、必選 / 多選 / 單選選項群組、
 * 限量商品（雙人分享餐）、手動售完（控肉飯）、各種標籤與過敏原（08 §3.2、§3.4）。
 */
export const PRODUCTS: SeedProduct[] = [
  // 飯類
  p('prd_lurou', 'cat_rice', '招牌滷肉飯', 35, {
    description: '古早味滷肉燥，肥瘦比例剛剛好',
    image: 'products/lurou.svg',
    tags: ['HOT'],
    allergens: ['SOY'],
    groupIds: ['og_size_bowl', 'og_rice_topping'],
  }),
  p('prd_chicken_rice', 'cat_rice', '嘉義雞肉飯', 45, {
    description: '手撕雞絲拌上雞油，簡單就好吃',
    image: 'products/chicken-rice.svg',
    tags: ['CHEF_PICK'],
    groupIds: ['og_size_bowl', 'og_rice_topping'],
  }),
  p('prd_kong_rou', 'cat_rice', '控肉飯', 85, {
    tags: ['CHEF_PICK'],
    allergens: ['SOY'],
    groupIds: ['og_rice_topping'],
    manualSoldOut: true,
  }),
  p('prd_pork_chop', 'cat_rice', '古早味排骨飯', 110),
  p('prd_chicken_leg', 'cat_rice', '招牌雞腿飯', 120, { tags: ['NEW'] }),
  // 麵食
  p('prd_beef_noodle', 'cat_noodle', '紅燒牛肉麵', 180, {
    description: '慢火燉煮牛腱與牛筋，湯頭濃郁',
    image: 'products/beef-noodle.svg',
    tags: ['HOT', 'CHEF_PICK'],
    groupIds: ['og_noodle', 'og_spice'],
  }),
  p('prd_danzai', 'cat_noodle', '擔仔麵', 60),
  p('prd_oyster_vermicelli', 'cat_noodle', '蚵仔麵線', 65, {
    description: '大腸與鮮蚵料多，柴魚湯頭',
    image: 'products/oyster-vermicelli.svg',
    tags: ['HOT'],
    allergens: ['MOLLUSC'],
    groupIds: ['og_size_bowl', 'og_herb', 'og_garlic', 'og_spice'],
  }),
  p('prd_dry_noodle', 'cat_noodle', '乾拌麵', 50, { groupIds: ['og_noodle', 'og_spice'] }),
  p('prd_wonton_soup', 'cat_noodle', '鮮肉餛飩湯', 60, { groupIds: ['og_herb'] }),
  // 小吃
  p('prd_oyster_omelet', 'cat_snack', '蚵仔煎', 75, {
    description: '鮮蚵厚實，搭配特製甜辣醬',
    image: 'products/oyster-omelet.svg',
    tags: ['HOT'],
    allergens: ['MOLLUSC', 'EGG'],
    groupIds: ['og_spice'],
  }),
  p('prd_stinky_tofu', 'cat_snack', '臭豆腐', 70, {
    description: '外酥內嫩，附自家泡菜',
    image: 'products/stinky-tofu.svg',
    tags: ['HOT'],
    allergens: ['SOY'],
    groupIds: ['og_tofu_style', 'og_spice'],
  }),
  p('prd_salt_chicken', 'cat_snack', '鹽酥雞', 70, {
    description: '現炸酥脆，九層塔香氣十足',
    image: 'products/salt-chicken.svg',
    tags: ['HOT'],
    groupIds: ['og_salt_season', 'og_spice'],
  }),
  p('prd_meatball', 'cat_snack', '彰化肉圓', 45),
  p('prd_rice_cake', 'cat_snack', '古早味碗粿', 35),
  p('prd_fried_vermicelli', 'cat_snack', '炒米粉', 60),
  // 湯品
  p('prd_meatball_soup', 'cat_soup', '貢丸湯', 30),
  p('prd_clam_soup', 'cat_soup', '蛤蜊絲瓜湯', 60, {
    description: '新鮮蛤蜊與絲瓜清甜',
    allergens: ['MOLLUSC'],
  }),
  p('prd_sishen_soup', 'cat_soup', '四神湯', 65),
  p('prd_rib_soup', 'cat_soup', '排骨酥湯', 70),
  // 小菜
  p('prd_greens', 'cat_side', '燙青菜', 40, { tags: ['VEGETARIAN'] }),
  p('prd_braised_egg', 'cat_side', '滷蛋', 15, { allergens: ['EGG'] }),
  p('prd_tofu_dry', 'cat_side', '滷豆干', 15),
  p('prd_century_tofu', 'cat_side', '皮蛋豆腐', 45, { allergens: ['EGG', 'SOY'] }),
  p('prd_cucumber', 'cat_side', '涼拌小黃瓜', 40, { tags: ['VEGETARIAN'], allergens: ['SESAME'] }),
  // 飲品
  p('prd_black_tea', 'cat_drink', '古早味紅茶', 25, {
    description: '茶香濃郁，回甘不澀',
    image: 'products/black-tea.svg',
    groupIds: ['og_cup', 'og_sugar', 'og_ice'],
  }),
  p('prd_winter_melon', 'cat_drink', '冬瓜茶', 30, { groupIds: ['og_cup', 'og_sugar', 'og_ice'] }),
  p('prd_bubble_tea', 'cat_drink', '珍珠奶茶', 55, {
    description: 'Q 彈珍珠搭配香濃奶茶',
    image: 'products/bubble-tea.svg',
    tags: ['HOT'],
    allergens: ['MILK'],
    groupIds: ['og_cup', 'og_sugar', 'og_ice', 'og_drink_topping'],
  }),
  p('prd_soy_milk', 'cat_drink', '豆漿', 25, {
    tags: ['VEGETARIAN'],
    allergens: ['SOY'],
    groupIds: ['og_sugar', 'og_ice'],
  }),
  // 甜點
  p('prd_tofu_pudding', 'cat_dessert', '手工豆花', 45, {
    description: '綿密豆花，配料自選',
    image: 'products/tofu-pudding.svg',
    tags: ['VEGETARIAN'],
    allergens: ['SOY'],
    groupIds: ['og_dessert_topping', 'og_ice'],
  }),
  p('prd_herb_jelly', 'cat_dessert', '燒仙草', 50, {
    tags: ['VEGETARIAN'],
    groupIds: ['og_dessert_topping', 'og_ice'],
  }),
  p('prd_aiyu', 'cat_dessert', '愛玉檸檬', 45, {
    description: '現搖愛玉搭配檸檬汁，清爽解膩',
    image: 'products/aiyu.svg',
    tags: ['NEW', 'VEGETARIAN'],
    groupIds: ['og_ice'],
  }),
  // 套餐
  p('prd_combo_single', 'cat_combo', '超值單人套餐', 99, {
    description: '主餐、附湯與飲料一次搞定',
    tags: ['CHEF_PICK'],
    groupIds: ['og_combo_main', 'og_combo_soup', 'og_combo_drink'],
  }),
  p('prd_combo_share', 'cat_combo', '雙人分享餐', 299, {
    description: '兩份主餐加小吃與小菜，每日限量供應',
    image: 'products/combo-share.svg',
    tags: ['LIMITED'],
    allergens: ['MOLLUSC', 'EGG', 'SOY'],
    groupIds: ['og_share_mains', 'og_share_snack', 'og_share_side'],
    dailyLimit: 5,
  }),
];

/** 種子的手動售完旗標初值（寫入 DemoState.soldOutProductIds 的初始內容） */
export const SEED_SOLD_OUT_IDS: ID[] = PRODUCTS.filter((x) => x.manualSoldOut).map((x) => x.id);
