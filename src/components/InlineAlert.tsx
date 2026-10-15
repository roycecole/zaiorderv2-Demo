// src/components/InlineAlert.tsx —— 頁內提示（CMP-26 Alert）：info / success / warning / error
import clsx from 'clsx';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/i18n/zh-TW';
import { IconButton } from './IconButton';
import { ICON } from './internal';
import { VisuallyHidden } from './VisuallyHidden';

export type InlineAlertTone = 'info' | 'success' | 'warning' | 'error';

export interface InlineAlertProps {
  tone?: InlineAlertTone;
  /** 標題（粗體一行）；內文放 children */
  title?: ReactNode;
  children?: ReactNode;
  /** 動作（通常是 `<Button size="md" variant="secondary">`）；顯示於內文下方 */
  action?: ReactNode;
  /** 提供則顯示關閉鈕 */
  onDismiss?: () => void;
  dismissLabel?: string;
  /**
   * 即時通報角色：預設 error → `alert`（assertive）、success → `status`（polite）、其餘不通報。
   * 已用 `aria-describedby` 把說明帶給聚焦元素時，請傳 `none` 避免重複朗讀（03 §10.2）。
   */
  role?: 'alert' | 'status' | 'none';
  id?: string;
  className?: string;
}

const TONE = {
  info: { box: 'border-info/25 bg-info-soft', head: 'text-info', Icon: Info },
  success: { box: 'border-success/25 bg-success-soft', head: 'text-success', Icon: CircleCheck },
  warning: { box: 'border-warning/30 bg-warning-soft', head: 'text-warning', Icon: TriangleAlert },
  error: { box: 'border-danger/25 bg-danger-soft', head: 'text-danger', Icon: CircleAlert },
} as const;

/**
 * 狀態一律「圖示 + 文字 + 顏色」；另有視覺隱藏的語意前綴（提示 / 成功 / 注意 / 錯誤）供輔助科技辨識。
 * 離線橫幅（8.1）：`<InlineAlert tone="warning">目前沒有網路連線…</InlineAlert>`。
 */
export function InlineAlert({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  dismissLabel,
  role,
  id,
  className,
}: InlineAlertProps) {
  const { box, head, Icon } = TONE[tone];
  const effectiveRole =
    role ?? (tone === 'error' ? 'alert' : tone === 'success' ? 'status' : 'none');
  const hasTitle = title !== undefined && title !== null;
  return (
    <div
      id={id}
      role={effectiveRole === 'none' ? undefined : effectiveRole}
      className={clsx('flex items-start gap-3 rounded-md border p-3', box, className)}
    >
      <Icon aria-hidden="true" className={clsx(ICON, 'mt-0.5', head)} />
      <div className="min-w-0 flex-1 text-sm leading-5 text-text">
        {hasTitle ? (
          <p className={clsx('font-semibold', head)}>
            <VisuallyHidden>{t.common.tone[tone]}：</VisuallyHidden>
            {title}
          </p>
        ) : null}
        {children !== undefined && children !== null ? (
          <div className={clsx(hasTitle && 'mt-0.5')}>
            {!hasTitle ? <VisuallyHidden>{t.common.tone[tone]}：</VisuallyHidden> : null}
            {children}
          </div>
        ) : null}
        {action !== undefined && action !== null ? (
          <div className="mt-2 flex flex-wrap gap-2">{action}</div>
        ) : null}
      </div>
      {onDismiss ? (
        <IconButton
          label={dismissLabel ?? t.common.close}
          icon={<X />}
          size="sm"
          onClick={onDismiss}
          className="-m-1.5"
        />
      ) : null}
    </div>
  );
}
