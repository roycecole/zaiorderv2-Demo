// src/features/store/StoreBrand.tsx —— 店家標誌 + 名稱（頂部列、觸控面板標題列、頁尾共用）
import clsx from 'clsx';
import { useState } from 'react';

export interface StoreBrandProps {
  name: string;
  logoUrl?: string | undefined;
  /** `sm`：手機 AppBar（32px）；`md`：桌機頂部列（36px） */
  size?: 'sm' | 'md';
  /** 隱藏名稱文字（僅標誌；呼叫端自行提供可存取名稱） */
  hideName?: boolean;
  className?: string;
}

/**
 * 沒有標誌圖或載入失敗時以店名首字的品牌色圓標佔位（BR-30：無圖也完整可用）。
 * 標誌圖為裝飾性（alt=""）：店名文字已提供名稱。
 */
export function StoreBrand({
  name,
  logoUrl,
  size = 'md',
  hideName = false,
  className,
}: StoreBrandProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = logoUrl !== undefined && logoUrl.length > 0 && failedUrl !== logoUrl;
  const initial = Array.from(name.trim())[0] ?? '店';
  const box = size === 'sm' ? 'size-8 text-base' : 'size-9 text-lg';
  return (
    <span className={clsx('inline-flex min-w-0 items-center gap-2.5', className)}>
      {showImage ? (
        <img
          src={logoUrl}
          alt=""
          className={clsx(box, 'shrink-0 rounded-full bg-bg-muted object-cover')}
          onError={() => setFailedUrl(logoUrl)}
        />
      ) : (
        <span
          aria-hidden="true"
          className={clsx(
            box,
            'grid shrink-0 place-items-center rounded-full bg-brand leading-none font-bold text-on-brand',
          )}
        >
          {initial}
        </span>
      )}
      {hideName ? null : (
        <span className="min-w-0 truncate text-base leading-6 font-bold tracking-wide md:text-h3">
          {name}
        </span>
      )}
    </span>
  );
}
