// src/app/layouts/RouteFallback.tsx —— 首次載入時，等路由 chunk 下載的畫面（React Router 的 HydrateFallback）
//
// 沒有它時，路由 chunk 下載完成之前整頁是空白（且主控台會警告 "No `HydrateFallback` element provided"）。
// 頂部列的高度與外殼一致（--appbar-h / --topbar-h），外殼出現時不會位移（CLS）。
import { Skeleton, VisuallyHidden } from '@/components';
import { t } from '@/i18n/zh-TW';

export function RouteFallback() {
  return (
    <div role="status" aria-busy="true" className="flex min-h-dvh flex-col bg-bg">
      <VisuallyHidden>{t.a11y.shell.routeLoading}</VisuallyHidden>
      <div className="border-b border-border bg-bg">
        <div className="mx-auto flex h-(--appbar-h) max-w-[1440px] items-center gap-3 pr-2 pl-4 md:h-(--topbar-h) md:px-6 lg:px-8">
          <Skeleton width={40} height={40} rounded="full" />
          <Skeleton width={128} height={20} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1440px] flex-1 px-4 pt-3 md:px-8" />
    </div>
  );
}
