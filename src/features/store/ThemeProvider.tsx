// src/features/store/ThemeProvider.tsx —— 店家品牌色 → 主題代幣（03 §4.8、BR-32）
//
// `themeOverride`（Demo 面板的預覽主題色）優先，其次 `StoreInfo.display.brandColor`；
// 對比保護（文字色、hover、淺色底）由 domain/theme.deriveBrandTokens 內建。
// 不渲染任何 DOM；店家資訊載入前沿用 CSS 預設色。
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { applyTheme } from './applyTheme';
import { useStoreInfo } from './queries';

export interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { data } = useStoreInfo();
  const override = useInputModeStore((s) => s.themeOverride);
  const brandColor = override ?? data?.display.brandColor ?? null;
  const loaded = data !== undefined || override !== null;

  useEffect(() => {
    if (!loaded) return;
    applyTheme(document.documentElement, brandColor);
  }, [brandColor, loaded]);

  return <>{children}</>;
}
