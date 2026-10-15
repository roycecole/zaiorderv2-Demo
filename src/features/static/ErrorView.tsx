// src/features/static/ErrorView.tsx —— 錯誤畫面（路由錯誤邊界與根部錯誤共用）：標題、說明、重試、回首頁、參考編號
import { CircleAlert, House, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { buttonClassName } from '@/components';
import { errorMessageOf } from '@/i18n/strings/errors';
import { t } from '@/i18n/zh-TW';

/** 由任何被擲出的值取出參考編號（ApiError.body.requestId；鴨子型別，不依賴 http 內部） */
export function requestIdOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = (error as { requestId?: unknown }).requestId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const body = (error as { body?: unknown }).body;
  if (typeof body === 'object' && body !== null) {
    const id = (body as { requestId?: unknown }).requestId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return undefined;
}

export interface ErrorViewProps {
  error?: unknown;
  /** 重試（預設重新整理頁面） */
  onRetry?: () => void;
  /** 回首頁的連結：路由內傳 `<Link>`，根部（路由器之外）傳一般 `<a>` */
  homeLink: (className: string, children: ReactNode) => ReactNode;
  /** 獨立整頁（無外殼）：輸出 `<main>` 地標並撐滿視窗高度；位於外殼 `<main>` 內時為 false */
  standalone?: boolean;
}

/**
 * 不暴露技術細節：已知錯誤碼用對照表文案，其餘一律用通用說明（errorMessageOf）。
 * 以 `role="alert"` 出現時朗讀一次。
 */
export function ErrorView({ error, onRetry, homeLink, standalone = false }: ErrorViewProps) {
  const s = t.static.error;
  const requestId = requestIdOf(error);
  const message = error === undefined ? s.message : errorMessageOf(error, s.message);
  const retry = onRetry ?? (() => window.location.reload());

  const content = (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 px-6 py-16 text-center"
    >
      <div
        aria-hidden="true"
        className="grid size-16 place-items-center rounded-full bg-danger-soft text-danger"
      >
        <CircleAlert className="size-8" />
      </div>
      <h1 tabIndex={-1} className="text-h1 font-bold text-text">
        {s.title}
      </h1>
      <p className="max-w-prose text-base leading-6 text-text-sub">{message}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={retry}
          className={buttonClassName({ variant: 'primary', size: 'lg' })}
        >
          <RefreshCw aria-hidden="true" className="size-5" />
          {s.retry}
        </button>
        {homeLink(
          buttonClassName({ variant: 'secondary', size: 'lg' }),
          <>
            <House aria-hidden="true" className="size-5" />
            {s.home}
          </>,
        )}
      </div>
      {requestId !== undefined ? (
        <p className="mt-2 text-xs leading-4 text-text-muted">
          {s.requestId}：<span className="font-mono">{requestId}</span>
        </p>
      ) : null}
    </div>
  );

  return standalone ? <main className="min-h-dvh bg-bg">{content}</main> : content;
}
