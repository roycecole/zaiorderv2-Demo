// src/components/Skeleton.tsx —— 載入骨架（CMP-27）
import clsx from 'clsx';
import type { CSSProperties } from 'react';

export interface SkeletonProps {
  /** 寬度：數字為 px，字串為任意 CSS 長度（預設 100%） */
  width?: number | string;
  /** 高度：數字為 px，字串為任意 CSS 長度（預設 1rem） */
  height?: number | string;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
  className?: string;
}

const ROUNDED = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
} as const;

/**
 * 靜態骨架（不做閃爍 / 呼吸動畫：03 §4.5 禁止無限循環動畫）。
 * 純裝飾 `aria-hidden`；載入狀態請在容器加 `aria-busy` 並提供 `role="status"` 文字（例：`<Spinner />`）。
 */
export function Skeleton({ width, height, rounded = 'md', className }: SkeletonProps) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return (
    <span
      aria-hidden="true"
      style={style}
      className={clsx(
        'block max-w-full bg-bg-muted',
        width === undefined && 'w-full',
        height === undefined && 'h-4',
        ROUNDED[rounded],
        className,
      )}
    />
  );
}
