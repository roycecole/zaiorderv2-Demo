// src/features/a11y/ClearMyData.tsx —— 「清除我的資料」（FR-CK-14、03 PG-19 / §8.4）
//
// 清除訪客資料（姓名、手機、地址、付款 / 發票設定）、點餐記憶與本機訂單記錄；不清除購物車與其他偏好。
// PG-19、頁尾與結帳頁的捷徑共用這一個確認對話框，行為相同。
import { useState } from 'react';
import { ConfirmDialog } from '@/components';
import { t } from '@/i18n/zh-TW';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { announce } from './LiveAnnouncer';

/** 實際清除（不經確認）：供已自行確認的流程使用 */
export function clearMyData(): void {
  usePrefsStore.getState().clearMyData();
  useGuestOrdersStore.getState().clear();
  announce(t.a11y.announce.dataCleared, 'polite');
}

export interface ClearMyDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 二次確認對話框（預設焦點在「取消」）；確認後清除並通報 */
export function ClearMyDataDialog({ open, onOpenChange }: ClearMyDataDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title={t.a11y.shortcuts.clearConfirmTitle}
      description={t.a11y.shortcuts.clearConfirmBody}
      confirmLabel={t.a11y.shortcuts.clearConfirm}
      onConfirm={clearMyData}
    />
  );
}

export interface ClearMyDataLinkProps {
  className?: string;
}

/** 文字連結樣式的「清除我的資料」捷徑（頁尾、結帳頁）；按下開啟確認對話框 */
export function ClearMyDataLink({ className }: ClearMyDataLinkProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {t.a11y.shell.footer.clearData}
      </button>
      <ClearMyDataDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
