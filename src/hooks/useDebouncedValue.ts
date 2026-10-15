// src/hooks/useDebouncedValue.ts —— 輸入穩定一段時間後才更新的值（搜尋框等）
import { useEffect, useState } from 'react';

/** 回傳「`value` 停止變動 `delayMs` 毫秒後」的值；首次渲染立即等於 `value`；`delayMs <= 0` 時不延遲。 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    if (delayMs <= 0) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return delayMs <= 0 ? value : debounced;
}
