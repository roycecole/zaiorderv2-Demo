// src/components/Dialog.tsx —— 對話框（CMP-26）：Radix Dialog 包裝；焦點陷阱、Esc 關閉、關閉後還原焦點
//
// 實作在 DialogImpl.tsx，第一次開啟時才動態載入（見 lazyOverlay.tsx）；關閉且從未開啟過時不輸出任何內容。
import { useLayoutEffect, useRef } from 'react';
import type { DialogProps } from './DialogImpl';
import { LazyOverlay, createOverlayLoader } from './lazyOverlay';

export type { DialogProps } from './DialogImpl';

const dialogLoader = createOverlayLoader<DialogProps>(() =>
  import('./DialogImpl').then((m) => m.Dialog),
);

/** 預先載入對話框實作（例如已知接下來會開啟時） */
export const preloadDialog = (): Promise<void> => dialogLoader.load();

/**
 * 受控對話框。開啟時背景由 Radix 設為 inert / aria-hidden 並鎖定捲動；Esc 關閉；Tab 在內部循環。
 * @example
 * <Dialog open={open} onOpenChange={setOpen} title="鍵盤快速鍵與偏好" footer={<Button onClick={() => setOpen(false)}>完成</Button>}>
 *   …內容…
 * </Dialog>
 */
export function Dialog(props: DialogProps) {
  // 實作可能在開啟之後才載入完成：先於此處記下開啟當下的焦點，關閉時才能還原給觸發者
  const opener = useRef<HTMLElement | null>(null);
  const { open } = props;
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  return (
    <LazyOverlay
      loader={dialogLoader}
      active={open}
      props={{ ...props, returnFocusRef: props.returnFocusRef ?? opener }}
    />
  );
}
