// src/features/demo/rememberedSample.ts —— Demo「載入範例」點餐記憶（08 §2.5「點餐記憶（訪客）」）
//
// 以 Mock 種子的商品 / 選項 ID 組成四筆；鹽酥雞的「特辣」（opt_spice_xl）是已停售的舊選項，
// 菜單中不存在，用於展示「部分選項已不提供，已改用預設」。
import type { RememberedMap } from '@/domain/rememberedChoice';

export function sampleRemembered(nowMs: number): RememberedMap {
  return {
    prd_lurou: {
      productId: 'prd_lurou',
      optionIds: ['opt_bowl_l', 'opt_egg'],
      labels: ['大碗', '滷蛋'],
      note: '不要蔥',
      at: nowMs,
    },
    prd_black_tea: {
      productId: 'prd_black_tea',
      optionIds: ['opt_cup_m', 'opt_sugar_half', 'opt_ice_light'],
      labels: ['中杯', '半糖', '微冰'],
      at: nowMs - 1,
    },
    prd_beef_noodle: {
      productId: 'prd_beef_noodle',
      optionIds: ['opt_noodle_thin', 'opt_spice_none'],
      labels: ['細麵', '不辣'],
      at: nowMs - 2,
    },
    prd_salt_chicken: {
      productId: 'prd_salt_chicken',
      optionIds: ['opt_season_plum', 'opt_spice_xl'],
      labels: ['梅子粉', '特辣'],
      at: nowMs - 3,
    },
  };
}
