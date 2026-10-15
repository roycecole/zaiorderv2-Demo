// src/features/store/StoreStatusBadge.tsx —— 營業狀態（CMP-10、03 §6.3）
//
// 狀態一律「圖示 + 文字 + 顏色」並用，不只靠顏色。文案由 describeStoreStatus 依 §6.3 對照表產生，
// 並以 useClockNow 每 30 秒更新（「約 n 分鐘後恢復營業」「今日 HH:mm 打烊」隨時間變化；Demo 時間穿梭會反映）。
import clsx from 'clsx';
import { CircleCheck, CirclePause, CircleX, Contrast } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StoreStatus } from '@/domain/types';
import { useClockNow } from '@/hooks/useClockNow';
import { t } from '@/i18n/zh-TW';
import { describeStoreStatus } from './storeStatusText';
import type { StoreStatusIcon, StoreStatusTone } from './storeStatusText';

export interface StoreStatusBadgeProps {
  /** `GET /store/status`；尚未載入時傳 undefined（顯示佔位，不推擠版面） */
  status: StoreStatus | undefined;
  /** `full`：03 §6.3 的完整文案；`compact`：頂部列等窄處的精簡文案 */
  variant?: 'full' | 'compact';
  /** 以 role="status" 通報狀態變更（polite）；同一頁面只讓一個徽章通報，避免重複朗讀 */
  announce?: boolean;
  className?: string;
}

const TONE: Record<StoreStatusTone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

const ICON: Record<StoreStatusIcon, LucideIcon> = {
  open: CircleCheck,
  resting: Contrast,
  holiday: CircleX,
  paused: CirclePause,
};

export function StoreStatusBadge({
  status,
  variant = 'full',
  announce = false,
  className,
}: StoreStatusBadgeProps) {
  const now = useClockNow(30_000);

  if (status === undefined) {
    return (
      <span
        className={clsx(
          'inline-flex min-h-7 items-center rounded-pill bg-bg-muted px-3 text-sm leading-5 text-text-muted',
          className,
        )}
        data-zo-store-status="loading"
      >
        {t.store.status.loading}
      </span>
    );
  }

  const view = describeStoreStatus(status, now.getTime());
  const Icon = ICON[view.icon];
  const text = variant === 'compact' ? view.shortText : view.text;

  return (
    <span
      role={announce ? 'status' : undefined}
      data-zo-store-status={status.status}
      className={clsx(
        'inline-flex max-w-full items-center gap-1.5 rounded-pill px-3 py-1 text-sm leading-5 font-semibold',
        'forced-colors:border forced-colors:border-[CanvasText]',
        TONE[view.tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
    </span>
  );
}
