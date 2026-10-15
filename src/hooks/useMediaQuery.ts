// src/hooks/useMediaQuery.ts —— 訂閱 CSS media query 的結果（SSR / 測試環境無 matchMedia 時回傳 false）
import { useCallback, useSyncExternalStore } from 'react';

const canMatchMedia = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * 回傳 `window.matchMedia(query).matches`，並在結果改變時重新渲染。
 * @example const isDesktop = useMediaQuery('(min-width: 1024px)');
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canMatchMedia()) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => (canMatchMedia() ? window.matchMedia(query).matches : false),
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
