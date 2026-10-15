// src/components/Sheet.tsx —— 面板（03 PG-02、§5.2）：< 768 為底部面板，≥ 768 為置中 Modal 或右側 Drawer
import * as RadixDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import type { ReactNode, RefObject } from 'react';
import { OverlayBackdrop, OverlayCloseButton, OverlayTitle, useOverlayFocus } from './overlayParts';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 標題（必填：面板的可存取名稱）；開啟時焦點預設移到此標題（`tabindex="-1"`） */
  title: ReactNode;
  hideTitle?: boolean;
  /** 標題右側的附屬內容（標籤、收藏鈕等） */
  titleAccessory?: ReactNode;
  /** 標題下方的說明（自動成為 `aria-describedby`） */
  description?: ReactNode;
  /**
   * 標題上方的圖片區（例：`<ImageOrPlaceholder aspect="16/9" …/>`）。有圖片時關閉鈕浮在圖片右上角；
   * 缺圖時（03 §6.7）不要傳，面板高度隨內容。
   */
  media?: ReactNode;
  /** 內容區（可捲動；高度 ≤ 90dvh，隨內容） */
  children?: ReactNode;
  /** 黏在底部的動作列（例：`[− 1 +] [加入購物車 · $47]`）；自動處理安全區域 */
  footer?: ReactNode;
  /**
   * ≥ 768 的位置：`center`（預設，置中 Modal；768–1023 寬 560、≥ 1024 寬 640）、
   * `right`（右側 Drawer，寬 `--panel-w`，例：購物車抽屜）。< 768 一律為底部面板。
   */
  placement?: 'center' | 'right';
  /** center 的寬度：lg（預設，≥ 1024 為 640）、md（一律 560） */
  size?: 'md' | 'lg';
  showClose?: boolean;
  closeLabel?: string;
  /** `false`：Esc 與點擊遮罩都不會關閉 */
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onCloseAutoFocus?: (event: Event) => void;
  className?: string;
}

/**
 * 同為 Radix Dialog：焦點陷阱、Esc 關閉、關閉後焦點回到觸發者、背景 inert 與捲動鎖定。
 * 「下滑關閉」手勢未實作（03 §5.4 要求必須同時提供「✕」，本元件一律提供）。
 * 實體返回鍵優先關閉浮層（FR-PD-01）需 router 整合，由 features 以歷史紀錄處理。
 * @example
 * <Sheet open={open} onOpenChange={setOpen} title="招牌滷肉飯" media={<ImageOrPlaceholder … />}
 *        footer={<><Stepper … /><Button fullWidth size="lg">加入購物車 · NT$ 47</Button></>}>
 *   …選項群組、備註…
 * </Sheet>
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  titleAccessory,
  description,
  media,
  children,
  footer,
  placement = 'center',
  size = 'lg',
  showClose = true,
  closeLabel,
  dismissible = true,
  initialFocusRef,
  returnFocusRef,
  onCloseAutoFocus,
  className,
}: SheetProps) {
  const { contentRef, handleOpenAutoFocus, handleCloseAutoFocus } = useOverlayFocus({
    open,
    initialFocusRef,
    returnFocusRef,
    onCloseAutoFocus,
  });
  const hasMedia = media !== undefined && media !== null && media !== false;
  const hasDescription = description !== undefined && description !== null;
  const right = placement === 'right';

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <OverlayBackdrop />
        <RadixDialog.Content
          ref={contentRef}
          onOpenAutoFocus={handleOpenAutoFocus}
          onCloseAutoFocus={handleCloseAutoFocus}
          onEscapeKeyDown={dismissible ? undefined : (event) => event.preventDefault()}
          onInteractOutside={dismissible ? undefined : (event) => event.preventDefault()}
          className={clsx(
            'fixed z-50 flex flex-col bg-bg shadow-lg',
            // < 768：底部面板
            'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-xl',
            'max-md:data-[state=closed]:animate-zo-slide-down max-md:data-[state=open]:animate-zo-slide-up',
            right
              ? [
                  'md:inset-x-auto md:inset-y-0 md:right-0 md:bottom-auto md:h-dvh md:max-h-none md:w-(--panel-w) md:rounded-t-none md:rounded-l-xl',
                  'md:data-[state=closed]:animate-zo-slide-out-right md:data-[state=open]:animate-zo-slide-in-right',
                ]
              : [
                  'md:inset-0 md:m-auto md:h-fit md:max-h-[90dvh] md:w-[560px] md:rounded-xl',
                  size === 'lg' && 'lg:w-[640px]',
                  'md:data-[state=closed]:animate-zo-pop-out md:data-[state=open]:animate-zo-pop-in',
                ],
            className,
          )}
        >
          {/* 拖曳把手：純裝飾（手勢未實作，以 ✕ 與 Esc 關閉） */}
          <div
            aria-hidden="true"
            className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-sm bg-border-strong md:hidden"
          />
          {showClose ? (
            <OverlayCloseButton
              label={closeLabel}
              tone={hasMedia ? 'floating' : 'inline'}
              className="top-4 right-3 md:top-4 md:right-4"
            />
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-4 md:px-6 md:pt-5">
            {hasMedia ? <div className="mb-4">{media}</div> : null}
            <div
              className={clsx(
                'flex items-start justify-between gap-3',
                showClose && !hasMedia && 'pr-12',
              )}
            >
              <div className="min-w-0">
                <OverlayTitle hidden={hideTitle}>{title}</OverlayTitle>
              </div>
              {titleAccessory !== undefined && titleAccessory !== null ? (
                <div className="shrink-0">{titleAccessory}</div>
              ) : null}
            </div>
            {hasDescription ? (
              <RadixDialog.Description className="mt-1 text-sm leading-5 text-text-sub">
                {description}
              </RadixDialog.Description>
            ) : null}
            {children}
          </div>
          {footer !== undefined && footer !== null ? (
            <div className="flex shrink-0 items-center gap-3 border-t border-border bg-bg px-4 pt-3 pb-(--safe-bottom) md:px-6 md:py-4">
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export { DialogTitle as SheetTitle, DialogDescription as SheetDescription } from './dialogParts';
