// src/features/demo/brand.ts —— 預設品牌色與對比提示（03 §4.1、FR-DM-10、UAT-14）
import { contrastRatio, deriveBrandTokens, normalizeHex, WHITE } from '@/domain/theme';

export interface BrandPreset {
  key: string;
  name: string;
  hex: string;
}

/** 7 組預設品牌色（03 §4.1 實測表）；yellow 為深色文字壓力測試 */
export const BRAND_PRESETS: readonly BrandPreset[] = [
  { key: 'red', name: '辣椒紅', hex: '#D93A22' },
  { key: 'green', name: '抹茶綠', hex: '#2E7D4F' },
  { key: 'coffee', name: '咖啡棕', hex: '#7A4B2A' },
  { key: 'orange', name: '活力橘', hex: '#BA520A' },
  { key: 'blue', name: '海洋藍', hex: '#1F5FBF' },
  { key: 'black', name: '極簡黑', hex: '#18181B' },
  { key: 'yellow', name: '檸檬黃', hex: '#FACC15' },
];

export type OnBrandKind = 'white' | 'dark' | 'black';

export interface BrandHint {
  hex: string;
  onBrand: OnBrandKind;
  /** 主色上文字的對比（≥ 4.5） */
  onBrandRatio: number;
  /** 主色對白底的對比；偏低（< 3）表示淺色主色，按鈕靠文字對比辨識 */
  brandOnWhiteRatio: number;
  lowOnWhite: boolean;
}

/** 輸入無效回傳 null；接受 #RGB / #RRGGBB */
export function brandHint(input: string): BrandHint | null {
  const hex = normalizeHex(input);
  if (hex === null) return null;
  const tokens = deriveBrandTokens(hex);
  const onBrand: OnBrandKind =
    tokens.onBrand === WHITE ? 'white' : tokens.onBrand === '#000000' ? 'black' : 'dark';
  const brandOnWhiteRatio = contrastRatio(hex, WHITE);
  return {
    hex,
    onBrand,
    onBrandRatio: contrastRatio(tokens.onBrand, hex),
    brandOnWhiteRatio,
    lowOnWhite: brandOnWhiteRatio < 3,
  };
}

/** 目前覆寫色是否為預設組之一（不分大小寫） */
export function presetOf(hex: string | null): BrandPreset | undefined {
  if (hex === null) return undefined;
  return BRAND_PRESETS.find((p) => p.hex.toLowerCase() === hex.toLowerCase());
}
