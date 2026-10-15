// src/components/dialogParts.tsx —— 供自訂版面的 Dialog / Sheet 內容使用的標題與說明
import * as RadixDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import type { ComponentPropsWithRef } from 'react';

/**
 * 在 `Sheet` / `Dialog` 內自行排版時使用（例如把標題放在圖片下方的自訂區塊）。
 * 與 `title` 屬性擇一；同時取得 `tabindex="-1"` 以便開啟時聚焦。
 */
export function DialogTitle({
  className,
  ...rest
}: ComponentPropsWithRef<typeof RadixDialog.Title>) {
  return (
    <RadixDialog.Title
      tabIndex={-1}
      data-zo-dialog-title=""
      className={clsx('text-h2 font-bold text-text [overflow-wrap:anywhere]', className)}
      {...rest}
    />
  );
}

export function DialogDescription({
  className,
  ...rest
}: ComponentPropsWithRef<typeof RadixDialog.Description>) {
  return (
    <RadixDialog.Description
      className={clsx('text-sm leading-5 text-text-sub', className)}
      {...rest}
    />
  );
}
