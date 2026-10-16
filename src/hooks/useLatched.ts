// src/hooks/useLatched.ts —— 條件第一次成立後就維持為 true（閂鎖）
//
// 用在「首次載入完成才顯示內容」這類只該單向切換的狀態：條件成立後，即使之後因為重新取資料
// 又暫時變回 false，也不會退回骨架畫面（否則內容裡新掛載的查詢觀察者會觸發重新取資料，
// 進而又退回骨架，形成閃爍迴圈）。
import { useState } from 'react';

export function useLatched(value: boolean): boolean {
  const [latched, setLatched] = useState(value);
  // 「在渲染中依 props / state 調整 state」：React 官方建議的寫法，會立刻以新值重新渲染，不會多一次畫面
  if (value && !latched) setLatched(true);
  return latched || value;
}
