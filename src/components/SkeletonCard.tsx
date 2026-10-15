// src/components/SkeletonCard.tsx —— 商品卡 / 訂單卡的載入骨架，尺寸與實際卡片一致以避免版面位移（CLS）
import clsx from 'clsx';
import { Skeleton } from './Skeleton';

export interface SkeletonCardProps {
  /**
   * grid：圖卡（4:3 圖片區 + 兩行文字 + 價格列）；
   * list：橫式（左文字右 88px 縮圖）；
   * bare：精簡單行（品名 + 價格）。
   */
  variant?: 'grid' | 'list' | 'bare';
  className?: string;
}

/** 整張卡片 `aria-hidden`；請在清單容器標示 `aria-busy="true"` 與載入中的可讀文字。 */
export function SkeletonCard({ variant = 'grid', className }: SkeletonCardProps) {
  const shell = 'rounded-lg border border-border bg-bg';
  if (variant === 'bare') {
    return (
      <div
        aria-hidden="true"
        className={clsx(shell, 'flex min-h-[62px] items-center gap-3 px-4 py-2', className)}
      >
        <Skeleton height={20} width="55%" />
        <Skeleton height={20} width={56} className="ml-auto" />
      </div>
    );
  }
  if (variant === 'list') {
    return (
      <div aria-hidden="true" className={clsx(shell, 'flex items-start gap-3 p-3', className)}>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton height={22} width="60%" />
          <Skeleton height={16} width="85%" />
          <Skeleton height={36} width={96} rounded="full" className="mt-2" />
        </div>
        <Skeleton width={88} height={88} className="shrink-0" />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className={clsx(shell, 'flex flex-col gap-2 p-2', className)}>
      <div className="aspect-[4/3] w-full rounded-md bg-bg-muted" />
      <div className="flex flex-col gap-2 px-1 pt-1">
        <Skeleton height={22} width="70%" />
        <Skeleton height={16} width="90%" />
      </div>
      <div className="flex min-h-12 items-center justify-between px-1 pb-1">
        <Skeleton height={20} width={64} />
        <Skeleton height={36} width={72} rounded="full" />
      </div>
    </div>
  );
}
