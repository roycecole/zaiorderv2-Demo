// src/features/orders/CancelOrderDialog.tsx —— 取消訂單確認（03 §8.4、FR-OD-03、FLOW-12）
//
// 二次確認 + 選填原因；預設焦點在較安全的「保留訂單」。已付款者說明退款去向。
import { useRef, useState } from 'react';
import { Button, Dialog, Select } from '@/components';
import { orders as tOrders } from '@/i18n/strings/orders';

export interface CancelOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已付款：說明款項會退回原付款方式 */
  paid: boolean;
  /** 確認取消；完成（或擲出錯誤）後對話框關閉，錯誤由呼叫端處理 */
  onConfirm: (reason: string | undefined) => Promise<void>;
}

export function CancelOrderDialog({ open, onOpenChange, paid, onConfirm }: CancelOrderDialogProps) {
  const s = tOrders.tracking.cancelDialog;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  const close = (): void => {
    setReason('');
    onOpenChange(false);
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await onConfirm(reason === '' ? undefined : reason);
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) onOpenChange(true);
        else close();
      }}
      role="alertdialog"
      size="sm"
      showClose={false}
      title={s.title}
      description={paid ? s.descriptionPaid : s.descriptionUnpaid}
      initialFocusRef={keepRef}
      footer={
        <>
          <Button ref={keepRef} variant="secondary" disabled={busy} onClick={close}>
            {s.keep}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            {s.confirm}
          </Button>
        </>
      }
    >
      <Select
        label={s.reasonLabel}
        optional
        placeholder={s.reasonPlaceholder}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={s.reasons.map((r) => ({ value: r, label: r }))}
      />
    </Dialog>
  );
}
