// src/hooks/useLatest.ts —— 讓事件處理器 / 計時器永遠讀到最新的值，而不必把它列入 effect 相依
import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** 回傳一個 ref，其 `.current` 在每次渲染提交後更新為最新的 `value`。不要在渲染過程中讀取。 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef<T>(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
