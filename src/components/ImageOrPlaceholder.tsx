// src/components/ImageOrPlaceholder.tsx —— 商品圖片或佔位（CMP-32；03 §6.7 資料缺漏降級）
import clsx from 'clsx';
import { useState } from 'react';
import type { CardMedia } from '@/domain/menuLayout';

export interface ImageOrPlaceholderProps {
  /**
   * 圖片區的呈現（`domain/menuLayout` 的 `cardMedia(layout, hasImage)` 結果）：
   * - `PHOTO`：圖卡的圖片（預設 4:3）；缺圖或載入失敗時以同尺寸佔位圖塊取代
   * - `PLACEHOLDER`：圖卡缺圖的佔位圖塊（維持 4:3 與卡片節奏）
   * - `THUMB`：清單縮圖 88×88（觸控面板 104）；缺圖時 `cardMedia` 會回 `NONE`，載入失敗則以佔位縮圖取代以維持版面
   * - `NONE`：不渲染任何東西（清單缺圖時整塊不顯示）
   */
  media: CardMedia;
  imageUrl?: string | null | undefined;
  /** 品名：`alt` 的預設值，並在沒有分類圖示時取首字作為佔位內容 */
  name: string;
  /** 分類圖示（`Category.icon`，emoji 或短文字）；無則用品名首字 */
  icon?: string | null | undefined;
  /**
   * 覆寫 alt。預設為品名（03 §10.6 #11：商品圖 alt 為商品名稱）。
   * 傳空字串表示裝飾性（例如旁邊已有同名文字連結且希望避免重複朗讀）。
   * 佔位圖塊永遠是裝飾性（`aria-hidden`），不輸出 `<img>`。
   */
  alt?: string;
  /** 圖片區長寬比（僅 PHOTO / PLACEHOLDER）：預設 4:3；商品面板用 16:9 */
  aspect?: '4/3' | '16/9' | '1/1';
  /** 首屏重要圖片可設 eager；預設 lazy（03 §4.6） */
  loading?: 'lazy' | 'eager';
  className?: string;
}

const ASPECT = { '4/3': 'aspect-[4/3]', '16/9': 'aspect-[16/9]', '1/1': 'aspect-square' } as const;

const firstChar = (text: string): string => Array.from(text.trim())[0] ?? '';

export function ImageOrPlaceholder({
  media,
  imageUrl,
  name,
  icon,
  alt,
  aspect = '4/3',
  loading = 'lazy',
  className,
}: ImageOrPlaceholderProps) {
  // 以「失敗的網址」記錄：imageUrl 改變時自然重新嘗試，不需 effect 重置
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (media === 'NONE') return null;

  const thumb = media === 'THUMB';
  const showImage =
    media !== 'PLACEHOLDER' &&
    typeof imageUrl === 'string' &&
    imageUrl.length > 0 &&
    failedUrl !== imageUrl;

  const frame = clsx(
    'relative grid shrink-0 place-items-center overflow-hidden rounded-md',
    thumb ? 'size-[88px] kiosk:size-[104px]' : clsx('w-full', ASPECT[aspect]),
  );

  if (showImage) {
    return (
      <div className={clsx(frame, 'bg-bg-muted', className)}>
        <img
          src={imageUrl}
          alt={alt ?? name}
          width={thumb ? 176 : aspect === '16/9' ? 640 : 400}
          height={thumb ? 176 : aspect === '16/9' ? 360 : 300}
          loading={loading}
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(imageUrl)}
          className="absolute inset-0 size-full object-cover"
        />
      </div>
    );
  }

  const glyph = (icon && icon.trim().length > 0 ? icon : firstChar(name)) || '';
  return (
    <div
      aria-hidden="true"
      data-placeholder=""
      className={clsx(
        frame,
        'bg-bg-muted font-semibold text-text-muted forced-colors:border forced-colors:border-[CanvasText]',
        thumb ? 'text-h1' : 'text-4xl',
        className,
      )}
    >
      <span className="leading-none">{glyph}</span>
    </div>
  );
}
