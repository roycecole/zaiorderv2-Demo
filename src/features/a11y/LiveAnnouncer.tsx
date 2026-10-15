// src/features/a11y/LiveAnnouncer.tsx —— 即時通報（CMP-39、03 §10.4）
//
// 兩個常駐的視覺隱藏 live region（polite / assertive）。通報函式放在模組層級的小型 store，
// 因此 `useAnnounce()` 不需 Provider（單元測試與頁面元件獨立渲染時為安全的 no-op）；
// 只要樹中有一個 `<LiveAnnouncer />` 就會被朗讀。
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ReactNode } from 'react';

export type Politeness = 'polite' | 'assertive';

interface AnnouncerState {
  polite: string;
  assertive: string;
}

/** 清空到重新寫入之間的間隔：讓相同訊息連續送出時 DOM 文字確實發生變化而重新播報 */
const REANNOUNCE_GAP_MS = 50;

const store = createStore<AnnouncerState>(() => ({ polite: '', assertive: '' }));
const pending: Record<Politeness, { timer: ReturnType<typeof setTimeout> | null; text: string }> = {
  polite: { timer: null, text: '' },
  assertive: { timer: null, text: '' },
};

/**
 * 以 aria-live 播報訊息。相同訊息連續送出也會重新播報（先清空再寫入）；
 * 極短時間內連續的不同訊息會合併為同一句，避免後者吃掉前者。
 */
export function announce(message: string, politeness: Politeness = 'polite'): void {
  const text = message.trim();
  if (text.length === 0) return;
  const slot = pending[politeness];
  if (slot.timer !== null) {
    clearTimeout(slot.timer);
    slot.text = `${slot.text} ${text}`;
  } else {
    slot.text = text;
  }
  store.setState({ [politeness]: '' } as Partial<AnnouncerState>);
  slot.timer = setTimeout(() => {
    slot.timer = null;
    store.setState({ [politeness]: slot.text } as Partial<AnnouncerState>);
    slot.text = '';
  }, REANNOUNCE_GAP_MS);
}

/** 清除所有待播報與已顯示的訊息（測試與路由重置用） */
export function resetAnnouncer(): void {
  for (const p of ['polite', 'assertive'] as const) {
    const slot = pending[p];
    if (slot.timer !== null) clearTimeout(slot.timer);
    slot.timer = null;
    slot.text = '';
  }
  store.setState({ polite: '', assertive: '' });
}

/**
 * 取得通報函式（穩定的函式識別）：加入購物車、數量變更、已復原…
 * @example const announce = useAnnounce(); announce('已加入購物車：招牌滷肉飯');
 */
export function useAnnounce(): (message: string, politeness?: Politeness) => void {
  return announce;
}

export interface LiveAnnouncerProps {
  /** 選用：直接包住 app（等同在旁邊放一個 `<LiveAnnouncer />`） */
  children?: ReactNode;
}

/** 在 app 外殼放一個即可；兩個 region 於載入時就存在，確保輔助科技有訂閱到。 */
export function LiveAnnouncer({ children }: LiveAnnouncerProps) {
  const polite = useStore(store, (s) => s.polite);
  const assertive = useStore(store, (s) => s.assertive);
  return (
    <>
      {children}
      <div className="sr-only" data-zo-live-announcer="">
        <div role="status" aria-live="polite" aria-atomic="true">
          {polite}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {assertive}
        </div>
      </div>
    </>
  );
}
