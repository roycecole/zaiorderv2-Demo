// src/features/demo/armed.ts —— 「下一次送出」預備情境的項數（DemoTrigger 的小圓點與 aria-label 使用）
//
// 獨立成檔：頂部列的 DemoTrigger 屬於主 bundle，只能依賴輕量模組；scenario.ts 會匯入整份 Demo 文案，不能直接被它匯入。
import type { DemoState } from '@/services/api/mock/demoControl';

/** 預備中的「下一次送出」模擬項數：他人搶購 / 變售完 / 時段額滿，加上針對送出訂單的失敗注入（03 PG-18 入口鈕圓點） */
export function armedItemCount(state: DemoState): number {
  const race = state.raceOnNextCreate;
  let n = 0;
  if (race !== null) {
    n +=
      (race.soldOutProductIds?.length ?? 0) +
      (race.buy?.length ?? 0) +
      (race.fillSlots?.length ?? 0);
  }
  if (
    state.failNext !== null &&
    (state.failNext.target === 'orders.create' || state.failNext.target === 'any')
  ) {
    n += 1;
  }
  return n;
}
