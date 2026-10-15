// src/hooks/useFieldIds.ts —— 表單欄位的 id 與 aria-describedby 組合（label / hint / error / counter 關聯）
import { useId } from 'react';

export interface FieldIds {
  /** 輸入元件的 id（label 的 htmlFor） */
  id: string;
  hintId: string;
  errorId: string;
  counterId: string;
  /** 依存在的說明節點組出 aria-describedby；全部不存在時回傳 undefined（不輸出空屬性） */
  describedBy: (parts: {
    hint?: boolean;
    error?: boolean;
    counter?: boolean;
    /** 額外要關聯的 id（例如 TimeSlotPicker 的說明） */
    extra?: string | undefined;
  }) => string | undefined;
}

/**
 * 以 React `useId` 為基礎產生穩定且唯一的欄位 id。
 * @param prefix id 前綴（僅供除錯辨識），預設 `field`
 */
export function useFieldIds(prefix = 'field'): FieldIds {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const id = `${prefix}-${raw}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const counterId = `${id}-counter`;
  return {
    id,
    hintId,
    errorId,
    counterId,
    describedBy: ({ hint, error, counter, extra }) => {
      const ids: string[] = [];
      if (hint === true) ids.push(hintId);
      if (error === true) ids.push(errorId);
      if (counter === true) ids.push(counterId);
      if (extra) ids.push(extra);
      return ids.length > 0 ? ids.join(' ') : undefined;
    },
  };
}
