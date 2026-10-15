// src/features/demo/DemoContext.tsx —— 面板內各區塊共用的 DemoControl、狀態快照與寫入入口
import { createContext, useContext } from 'react';
import type { DemoControl, DemoState } from '@/services/api/mock/demoControl';

export interface DemoContextValue {
  demo: DemoControl;
  /** DemoState 快照（寫入後立即更新；面板每秒輪詢外部變更，例如失敗注入被消耗） */
  state: DemoState;
  /** 輪詢版號：面板展開時每秒 +1，供庫存讀數與送出紀錄重讀 */
  revision: number;
  /** 觸控面板模式（FAB 仍在，但「庫存與時段」與「送出結果」不顯示） */
  kiosk: boolean;
  /**
   * 寫入 DemoState：同步 useInputModeStore（inputMode / themeOverride）、
   * 時間穿梭後清除已過期的購物車，並 invalidate menu / product / pickup-slots / quote / orders / store。
   */
  patchState(patch: Partial<DemoState>): void;
  /** DemoControl 的動作（act、injectOtherOrder、fillSlot…）完成後呼叫：重讀快照並 invalidate */
  afterWrite(): void;
}

export const DemoContext = createContext<DemoContextValue | null>(null);

export function useDemoContext(): DemoContextValue {
  const value = useContext(DemoContext);
  if (value === null) throw new Error('Demo 面板的元件必須放在 <DemoRoot> 內');
  return value;
}
