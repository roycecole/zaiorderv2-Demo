// src/components/ConfirmDialog.tsx —— 確認對話框（03 §8.4）：標題 + 說明 + 主要 / 次要動作
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '@/i18n/zh-TW';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** 補充說明（例：「購物車內的 3 項餐點會一併移除」） */
  description?: ReactNode;
  /** 主要動作文字（例：「清空」「確認取消」「刪除帳號」） */
  confirmLabel: string;
  /** 次要動作文字，預設「取消」；取消訂單等請傳「保留訂單」 */
  cancelLabel?: string;
  /**
   * default：主要動作為品牌色；danger：破壞性動作，主要動作使用 danger 外觀，
   * 且不使用品牌色（避免品牌為紅色時與一般 CTA 混淆）。
   */
  tone?: 'default' | 'danger';
  /**
   * 按下主要動作時呼叫。可回傳 Promise：等待期間主要動作顯示 loading、對話框保持開啟，
   * 完成後自動關閉（`onOpenChange(false)`）；同步函式則立即關閉。擲出錯誤時對話框保持開啟。
   */
  onConfirm: () => void | Promise<unknown>;
  /** 初始焦點：預設在較安全的「取消」（03 §10.2：確認對話框 → 取消）；少數非破壞性確認可改 `confirm` */
  defaultFocus?: 'cancel' | 'confirm';
}

/**
 * 使用 `role="alertdialog"`；Esc 與點擊遮罩等同取消。
 * @example
 * <ConfirmDialog open={open} onOpenChange={setOpen} tone="danger" title="要清空購物車嗎？"
 *                confirmLabel="清空" onConfirm={() => cart.clear()} />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  onConfirm,
  defaultFocus = 'cancel',
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
      title={title}
      description={description}
      size="sm"
      role="alertdialog"
      showClose={false}
      initialFocusRef={defaultFocus === 'cancel' ? cancelRef : confirmRef}
      footer={
        <>
          <Button
            ref={cancelRef}
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel ?? t.common.cancel}
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => void handleConfirm()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
