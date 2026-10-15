// src/components/DialogImpl.tsx —— 對話框（CMP-26）的實作：Radix Dialog 包裝；焦點陷阱、Esc 關閉、關閉後還原焦點
//
// 由 Dialog.tsx 以動態載入使用（首屏不需要 Radix Dialog 與其相依套件）；請由 `@/components` 引用 Dialog。
import * as RadixDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import type { ReactNode, RefObject } from 'react';
import { OverlayBackdrop, OverlayCloseButton, OverlayTitle, useOverlayFocus } from './overlayParts';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 標題（必填：對話框的可存取名稱）；不想顯示時搭配 `hideTitle` */
  title: ReactNode;
  hideTitle?: boolean;
  /** 說明文字（標題下方；自動成為 `aria-describedby`） */
  description?: ReactNode;
  /** 內容區（可捲動） */
  children?: ReactNode;
  /** 底部動作列（靠右、可換行；通常放 Button） */
  footer?: ReactNode;
  /** 寬度：sm 400、md 480（預設）、lg 640；皆不超過視窗寬 − 32 */
  size?: 'sm' | 'md' | 'lg';
  /** 需要使用者立即回應的中斷式對話框用 `alertdialog`（確認、閒置警示） */
  role?: 'dialog' | 'alertdialog';
  /** 右上角關閉鈕，預設顯示（觸控與鍵盤皆有明確的關閉方式） */
  showClose?: boolean;
  closeLabel?: string;
  /**
   * `false`：Esc 與點擊遮罩都不會關閉（只能由內容內的按鈕關閉）。
   * 預設 `true`。注意：閒置警示等場景的 Esc 語意（= 取消）請由呼叫端以 `onOpenChange` 處理。
   */
  dismissible?: boolean;
  /** 開啟時的初始焦點；預設為標題（`tabindex="-1"`）。有表單欄位的對話框請指定第一個欄位。 */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** 關閉後還原焦點的目標；預設為開啟當下的焦點元素 */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** 接管關閉後的焦點處理（`event.preventDefault()` 後自行聚焦） */
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
}

const WIDTH = {
  sm: 'w-[min(400px,calc(100vw_-_2rem))]',
  md: 'w-[min(480px,calc(100vw_-_2rem))]',
  lg: 'w-[min(640px,calc(100vw_-_2rem))]',
} as const;

/**
 * 受控對話框。開啟時背景由 Radix 設為 inert / aria-hidden 並鎖定捲動；Esc 關閉；Tab 在內部循環。
 * @example
 * <Dialog open={open} onOpenChange={setOpen} title="鍵盤快速鍵與偏好" footer={<Button onClick={() => setOpen(false)}>完成</Button>}>
 *   …內容…
 * </Dialog>
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  description,
  children,
  footer,
  size = 'md',
  role = 'dialog',
  showClose = true,
  closeLabel,
  dismissible = true,
  initialFocusRef,
  returnFocusRef,
  onCloseAutoFocus,
  className,
}: DialogProps) {
  const { contentRef, handleOpenAutoFocus, handleCloseAutoFocus } = useOverlayFocus({
    open,
    initialFocusRef,
    returnFocusRef,
    onCloseAutoFocus,
  });
  const hasDescription = description !== undefined && description !== null;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <OverlayBackdrop />
        <RadixDialog.Content
          ref={contentRef}
          role={role}
          onOpenAutoFocus={handleOpenAutoFocus}
          onCloseAutoFocus={handleCloseAutoFocus}
          onEscapeKeyDown={dismissible ? undefined : (event) => event.preventDefault()}
          onInteractOutside={dismissible ? undefined : (event) => event.preventDefault()}
          className={clsx(
            'fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh_-_3rem)] flex-col rounded-xl bg-bg shadow-lg',
            'data-[state=closed]:animate-zo-pop-out data-[state=open]:animate-zo-pop-in',
            WIDTH[size],
            className,
          )}
        >
          <div className={clsx('shrink-0 px-6 pt-6 pb-3', showClose && 'pr-16')}>
            <OverlayTitle hidden={hideTitle}>{title}</OverlayTitle>
            {hasDescription ? (
              <RadixDialog.Description className="mt-1 text-sm leading-5 text-text-sub">
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          {showClose ? <OverlayCloseButton label={closeLabel} className="top-4 right-4" /> : null}
          {children !== undefined && children !== null ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-1 pb-4">
              {children}
            </div>
          ) : null}
          {footer !== undefined && footer !== null ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

