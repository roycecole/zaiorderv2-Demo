// src/hooks/useBreakpoint.ts —— 響應式斷點（03 §5.1）
import { useMediaQuery } from './useMediaQuery';

/** `sm`：< 768（手機）、`md`：768–1023（平板）、`lg`：≥ 1024（桌機） */
export type Breakpoint = 'sm' | 'md' | 'lg';

export const BREAKPOINT_MIN_WIDTH = { md: 768, lg: 1024 } as const;

/**
 * 目前的版型斷點。無 matchMedia 的環境（SSR、jsdom）回傳 `'sm'`（手機優先）。
 * 只需判斷單一斷點時，直接用 `useMediaQuery('(min-width: 768px)')` 即可。
 */
export function useBreakpoint(): Breakpoint {
  const atLeastMd = useMediaQuery(`(min-width: ${BREAKPOINT_MIN_WIDTH.md}px)`);
  const atLeastLg = useMediaQuery(`(min-width: ${BREAKPOINT_MIN_WIDTH.lg}px)`);
  if (atLeastLg) return 'lg';
  if (atLeastMd) return 'md';
  return 'sm';
}
