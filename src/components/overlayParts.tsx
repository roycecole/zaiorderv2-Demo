// src/components/overlayParts.tsx —— Dialog / Sheet 共用的焦點管理與外觀片段（不對外匯出）
import * as RadixDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { t } from '@/i18n/zh-TW';
import { DialogTitle } from './dialogParts';
import { IconButton } from './IconButton';

export interface OverlayFocusOptions {
  open: boolean;
  /** 開啟時要聚焦的元素；預設為標題（`tabindex="-1"`，03 §10.2：開啟商品面板 → 面板標題） */
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  /** 關閉後要還原焦點的元素；預設為開啟當下的 `document.activeElement`（觸發者） */
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  /** 自訂關閉後的焦點處理；呼叫 `event.preventDefault()` 即可接管（還原邏輯會略過） */
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
}

/**
 * Radix 只在使用 `Dialog.Trigger` 時才會還原焦點；本專案以受控 `open` 開關，
 * 因此自行記下開啟當下的焦點並於關閉時還原（03 §10.6 #3）。
 */
export function useOverlayFocus({
  open,
  initialFocusRef,
  returnFocusRef,
  onCloseAutoFocus,
}: OverlayFocusOptions) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    previouslyFocused.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  const handleOpenAutoFocus = (event: Event): void => {
    event.preventDefault();
    const target =
      initialFocusRef?.current ??
      contentRef.current?.querySelector<HTMLElement>('[data-zo-dialog-title]') ??
      contentRef.current;
    target?.focus({ preventScroll: true });
  };

  const handleCloseAutoFocus = (event: Event): void => {
    onCloseAutoFocus?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const target = returnFocusRef?.current ?? previouslyFocused.current;
    if (target?.isConnected === true) target.focus({ preventScroll: true });
  };

  return { contentRef, handleOpenAutoFocus, handleCloseAutoFocus };
}

export function OverlayBackdrop() {
  return (
    <RadixDialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-zo-fade-out data-[state=open]:animate-zo-fade-in" />
  );
}

export interface OverlayCloseButtonProps {
  label?: string | undefined;
  className?: string;
  /** floating：浮在圖片上（白底 + 陰影）；inline：淡灰底 */
  tone?: 'floating' | 'inline';
}

export function OverlayCloseButton({ label, className, tone = 'inline' }: OverlayCloseButtonProps) {
  return (
    <RadixDialog.Close asChild>
      <IconButton
        label={label ?? t.common.close}
        icon={<X />}
        variant={tone === 'floating' ? 'outline' : 'soft'}
        className={clsx(
          'absolute top-3 right-3 z-10',
          tone === 'floating' && 'border-transparent shadow-md',
          className,
        )}
      />
    </RadixDialog.Close>
  );
}

/** 標題與說明：以 Radix 的 Title / Description 輸出，讓 `aria-labelledby` / `aria-describedby` 自動建立。 */
export interface OverlayTitleProps {
  children: ReactNode;
  className?: string;
  hidden?: boolean;
}

export function OverlayTitle({ children, className, hidden = false }: OverlayTitleProps) {
  return <DialogTitle className={clsx(hidden && 'sr-only', className)}>{children}</DialogTitle>;
}
