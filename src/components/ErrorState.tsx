// src/components/ErrorState.tsx —— 區塊層級的錯誤狀態（03 §8.1）：原因 + 重試 + requestId
import clsx from 'clsx';
import { CircleAlert, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/i18n/zh-TW';
import { Button } from './Button';

export interface ErrorStateProps {
  /** 標題，預設「發生了一點問題」 */
  title?: ReactNode;
  /** 原因與可以怎麼做（不暴露技術細節）；通常來自 `errorMessage(code)` */
  message?: ReactNode;
  /** 提供則顯示「重試」按鈕 */
  onRetry?: () => void;
  retryLabel?: string;
  /** 重試進行中 */
  retrying?: boolean;
  /** 附上參考編號方便客服（06 §3.1 `requestId`） */
  requestId?: string | null | undefined;
  /** 精簡版（卡片內的小區塊）：較小的內距與圖示 */
  compact?: boolean;
  /** 額外動作（例如「致電店家」） */
  actions?: ReactNode;
  className?: string;
}

/** `role="alert"`：出現時由輔助科技朗讀一次。全頁層級（404 / 500）請使用頁面元件而非本元件。 */
export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel,
  retrying = false,
  requestId,
  compact = false,
  actions,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={clsx(
        'flex flex-col items-center justify-center gap-2 text-center',
        compact ? 'px-4 py-6' : 'px-6 py-10',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={clsx(
          'grid place-items-center rounded-full bg-danger-soft text-danger',
          compact ? 'size-10' : 'size-14',
        )}
      >
        <CircleAlert className={compact ? 'size-5' : 'size-7'} />
      </div>
      <h2 className="text-base leading-6 font-semibold text-text">
        {title ?? t.common.errorTitle}
      </h2>
      {message !== undefined && message !== null ? (
        <p className="max-w-prose text-sm leading-5 text-text-sub">{message}</p>
      ) : null}
      {onRetry || actions ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {onRetry ? (
            <Button
              variant="secondary"
              leadingIcon={<RefreshCw aria-hidden="true" className="size-4" />}
              loading={retrying}
              onClick={onRetry}
            >
              {retryLabel ?? t.common.retry}
            </Button>
          ) : null}
          {actions}
        </div>
      ) : null}
      {requestId ? (
        <p className="mt-1 text-xs leading-4 text-text-muted">
          {t.common.requestId}：<span className="font-mono">{requestId}</span>
        </p>
      ) : null}
    </div>
  );
}
