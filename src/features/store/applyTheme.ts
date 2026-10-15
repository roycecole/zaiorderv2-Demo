// src/features/store/applyTheme.ts
import { brandCssVars, deriveBrandTokens } from '@/domain/theme';

/** 將品牌色推導出的代幣寫入 :root，並同步瀏覽器網址列顏色 */
export function applyTheme(root: HTMLElement, brandColor: string | null | undefined): void {
  const tokens = deriveBrandTokens(brandColor);
  for (const [name, value] of Object.entries(brandCssVars(tokens))) {
    root.style.setProperty(name, value);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.brand);
}
