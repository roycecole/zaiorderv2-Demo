// src/domain/theme.ts
export interface Rgb { r: number; g: number; b: number }

export const WHITE = '#FFFFFF';
export const INK = '#18181B';
export const DEFAULT_BRAND = '#D93A22';
export const MIN_TEXT_CONTRAST = 4.5;

/** 接受 #RGB / #RRGGBB（大小寫皆可），回傳大寫 #RRGGBB；格式不符回傳 null */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(input.trim());
  if (!m || m[1] === undefined) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toUpperCase()}`;
}

export function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex);
  if (n === null) throw new Error(`Invalid hex color: ${hex}`);
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** WCAG 2.1 相對亮度 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 對比度（1～21） */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 以 weightB（0～1）混合 a 與 b */
export function mix(a: string, b: string, weightB: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const w = Math.min(1, Math.max(0, weightB));
  return rgbToHex({
    r: x.r * (1 - w) + y.r * w,
    g: x.g * (1 - w) + y.g * w,
    b: x.b * (1 - w) + y.b * w,
  });
}

/**
 * 主色上的文字色：依序嘗試白、#18181B、純黑，取第一個對比 ≥ 4.5 者。
 * 中等明度的色（如 #947D39）白字與 #18181B 皆不足，需退到純黑；任何顏色必有白或黑可達 4.5。
 */
export function pickOnBrand(brand: string): string {
  for (const c of [WHITE, INK, '#000000']) {
    if (contrastRatio(c, brand) >= MIN_TEXT_CONTRAST) return c;
  }
  return '#000000';
}

export interface BrandTokens {
  brand: string;           // 主色（按鈕底色、重點填色）
  onBrand: string;         // 主色上的文字色（白或深色，確保 ≥ 4.5:1）
  brandHover: string;      // Hover / Pressed
  brandSoft: string;       // 淺色底（選取、標籤）
  brandSoftStrong: string; // 較深的淺色底（邊框、分隔）
  brandText: string;       // 白底上的文字 / 圖示 / 連結色（確保 ≥ 4.5:1）
}

/** 由店家設定的品牌色推導整組主題代幣；無效或空值退回預設色 */
export function deriveBrandTokens(input: string | null | undefined): BrandTokens {
  const brand = normalizeHex(input) ?? DEFAULT_BRAND;
  const onBrand = pickOnBrand(brand);
  // hover 預設加深；若深色文字因加深而對比不足，改為提亮（兩者必有一個維持 ≥ 4.5）
  let brandHover = mix(brand, '#000000', 0.12);
  if (contrastRatio(onBrand, brandHover) < MIN_TEXT_CONTRAST) brandHover = mix(brand, WHITE, 0.12);
  const brandSoft = mix(brand, WHITE, 0.92);
  const brandSoftStrong = mix(brand, WHITE, 0.82);
  // 以「淺色底」為基準：同時滿足白底與淺色底（選取中的標籤、徽章）上的文字對比 ≥ 4.5
  let brandText = brand;
  for (let w = 0.05; contrastRatio(brandText, brandSoft) < MIN_TEXT_CONTRAST && w <= 0.8; w += 0.05) {
    brandText = mix(brand, '#000000', w);
  }
  return { brand, onBrand, brandHover, brandSoft, brandSoftStrong, brandText };
}

/** 轉為可直接寫入 :root 的 CSS 變數 */
export function brandCssVars(t: BrandTokens): Record<string, string> {
  return {
    '--color-brand': t.brand,
    '--color-on-brand': t.onBrand,
    '--color-brand-hover': t.brandHover,
    '--color-brand-soft': t.brandSoft,
    '--color-brand-soft-strong': t.brandSoftStrong,
    '--color-brand-text': t.brandText,
  };
}
