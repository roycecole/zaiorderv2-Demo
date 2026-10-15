// src/i18n/zh-TW.ts —— 文案集中管理（03 §9）；各功能的字串放在 strings/<feature>.ts，由各自的負責人維護
//
// `t` 只含「首屏與外殼會用到」的命名空間。體量大、只有特定頁面才需要的字串（結帳、訂單、帳號、會員登入、
// Demo 工具、隱私權 / 服務條款內文）不放進 `t`，由各功能直接匯入自己的字串模組：
//   import { checkout as tCheckout } from '@/i18n/strings/checkout';
// 這樣它們會跟著各自的頁面 chunk 載入，不進首次載入的 JS（NFR-03：≤ 200 kB gzip）。
// 各功能字串模組內不要再 import 其他功能的字串（會把它們拉進不相干的頁面）。
import { a11y } from './strings/a11y';
import { cart } from './strings/cart';
import { common } from './strings/common';
import { errors } from './strings/errors';
import { kiosk } from './strings/kiosk';
import { menu } from './strings/menu';
import { staticPages } from './strings/static';
import { store } from './strings/store';

export const t = {
  common,
  errors,
  a11y,
  store,
  menu,
  cart,
  kiosk,
  static: staticPages,
} as const;
