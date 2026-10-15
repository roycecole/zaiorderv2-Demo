// src/components/EmptyState.tsx —— 空狀態（CMP-28）：插圖 + 標題 + 說明 + 主要動作（03 §8.2）
import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** 插圖：emoji 字串或 lucide 圖示（裝飾性，會置於圓形淡底） */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** 主要動作（通常一個 Button / LinkButton） */
  action?: ReactNode;
  /** 標題的標題層級；預設 `h2`（頁面已有 h1）。放在區塊內時視情況改 `h3` */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-text-muted',
        className,
      )}
    >
      {icon !== undefined && icon !== null ? (
        <div
          aria-hidden="true"
          className="mb-1 grid size-14 place-items-center rounded-full bg-bg-muted text-3xl text-text-muted [&>svg]:size-7"
        >
          {icon}
        </div>
      ) : null}
      <Heading className="text-base leading-6 font-semibold text-text-sub">{title}</Heading>
      {description !== undefined && description !== null ? (
        <p className="max-w-prose text-sm leading-5">{description}</p>
      ) : null}
      {action !== undefined && action !== null ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
