// src/features/store/StoreHeader.tsx —— 店家資訊列（桌機 StoreStrip / 手機 StoreCard，03 PG-01）
//
// 營業狀態 + 地址 + 電話；`actions` 插槽供菜單頁放取餐方式切換與預估時間。
// 載入前以預留高度的骨架佔位，不推擠下方內容；載入失敗顯示可重試的提示。
import clsx from 'clsx';
import { MapPin, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Skeleton } from '@/components';
import { t } from '@/i18n/zh-TW';
import { useStoreInfo, useStoreStatus } from './queries';
import { StoreStatusBadge } from './StoreStatusBadge';

export interface StoreHeaderProps {
  /** `strip`：單列，桌機（≥ 768）；`card`：緊湊卡片，手機 */
  variant?: 'strip' | 'card';
  /** 右側插槽（取餐方式切換、預估時間…） */
  actions?: ReactNode;
  /** 以 `role="status"` 通報營業狀態變化；同一頁只應有一個通報者（頂部列的徽章或此處） */
  announce?: boolean;
  className?: string;
}

export function StoreHeader({ variant = 'strip', actions, announce = false, className }: StoreHeaderProps) {
  const info = useStoreInfo();
  const status = useStoreStatus();
  const data = info.data;
  const card = variant === 'card';

  return (
    <section
      aria-label={t.store.header.sectionLabel}
      className={clsx(
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-3',
        // 左右留白由放置它的版面決定（菜單頁與橫幅、分類列同一條左緣）
        card ? 'rounded-lg border border-border bg-bg p-3' : 'py-3',
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-sm leading-5 text-text-sub">
        <StoreStatusBadge status={status.data} announce={announce} />
        {/* 手機的緊湊卡片只放營業狀態與動作；地址與電話在店家資訊頁（03 PG-01） */}
        {card ? null : data !== undefined ? (
          <>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <MapPin aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="sr-only">{t.store.header.address}：</span>
                {data.address.city}
                {data.address.district}
                {data.address.line}
              </span>
            </span>
            <a
              href={`tel:${data.phone}`}
              className="hit-area inline-flex items-center gap-1.5 text-text-sub underline underline-offset-4"
            >
              <Phone aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
              <span className="sr-only">{t.store.header.phone}：</span>
              {data.phone}
            </a>
          </>
        ) : info.isError ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {t.store.header.loadFailed}
            <Button variant="ghost" onClick={() => void info.refetch()}>
              {t.store.header.retry}
            </Button>
          </span>
        ) : (
          <Skeleton width={240} height={20} />
        )}
      </div>
      {actions !== undefined && actions !== null ? (
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      ) : null}
    </section>
  );
}
