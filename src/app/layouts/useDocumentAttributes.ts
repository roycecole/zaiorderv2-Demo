// src/app/layouts/useDocumentAttributes.ts —— 把顯示偏好寫到 <html>（CSS 已就緒：styles/index.css）
//
// - data-mode="kiosk"：觸控面板模式（環境旗標或 Demo 預覽）
// - data-textscale="1"：大字模式（prefs.largeText，基準字級 +12.5%）
// - data-motion="on"：減少動態（prefs.reduceMotion = true）；未開啟時不寫入，跟隨系統 prefers-reduced-motion
import { useLayoutEffect } from 'react';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';

export function useDocumentAttributes(): void {
  const kiosk = useIsKioskUi();
  const largeText = usePrefsStore((s) => s.largeText);
  const reduceMotion = usePrefsStore((s) => s.reduceMotion);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const set = (name: string, value: string | null): void => {
      if (value === null) root.removeAttribute(name);
      else root.setAttribute(name, value);
    };
    set('data-mode', kiosk ? 'kiosk' : null);
    set('data-textscale', largeText ? '1' : null);
    set('data-motion', reduceMotion ? 'on' : null);
  }, [kiosk, largeText, reduceMotion]);

  // 外殼卸載（例如兩種版面之間切換）時由下一個外殼立即重寫；真正離開 app 時清除
  useLayoutEffect(
    () => () => {
      const root = document.documentElement;
      root.removeAttribute('data-mode');
      root.removeAttribute('data-textscale');
      root.removeAttribute('data-motion');
    },
    [],
  );
}
