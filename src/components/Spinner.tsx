// src/components/Spinner.tsx —— 載入中指示（按鈕 inline、區塊載入）
import clsx from 'clsx';
import { LoaderCircle } from 'lucide-react';
import { t } from '@/i18n/zh-TW';
import { VisuallyHidden } from './VisuallyHidden';

export interface SpinnerProps {
  /** sm 16px（按鈕內）、md 20px（預設）、lg 32px（區塊載入） */
  size?: 'sm' | 'md' | 'lg';
  /** 給輔助科技的文字，預設「載入中…」 */
  label?: string;
  /** 純裝飾（例如已有其他載入說明或位於按鈕內）：不輸出 role 與文字 */
  decorative?: boolean;
  className?: string;
}

const SIZE: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-8',
};

/** 旋轉動畫在「減少動態」時由全域 CSS 停止（styles/index.css）。 */
export function Spinner({ size = 'md', label, decorative = false, className }: SpinnerProps) {
  const icon = (
    <LoaderCircle
      aria-hidden="true"
      className={clsx(SIZE[size], 'shrink-0 animate-spin text-current', className)}
    />
  );
  if (decorative) return icon;
  return (
    <span role="status" className="inline-flex items-center">
      {icon}
      <VisuallyHidden>{label ?? t.common.loading}</VisuallyHidden>
    </span>
  );
}
