// src/features/a11y/KeyHint.tsx —— 快速鍵徽章（CMP-34）：包住互動元素，於右上角顯示鍵帽
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { KeyHintBadge } from '@/components';
import type { HotkeyAction } from '@/domain/hotkeys';
import { useKeyHintVisible } from './hotkeyHooks';
import { hintKeyParts } from './keyLabels';

export interface KeyHintProps {
  action: HotkeyAction;
  /** jumpCategory 這類帶參數的動作：該控制項對應的數字鍵（例：分類 chip 的 '1'） */
  arg?: string;
  children: ReactNode;
  className?: string;
  /** `corner`（預設）：右上角、不佔版面；`inline`：行內，接在標籤之後（間距 6px） */
  placement?: 'corner' | 'inline';
  /** 包住主色填滿的按鈕：徽章改為透明底 + 同字色邊框，對比與按鈕文字相同 */
  onBrand?: boolean;
}

/**
 * 預設隱藏：單鍵快速鍵啟用後才顯示（與 `aria-keyshortcuts` 一併，後者由 `useKeyShortcuts` 取得並加在控制項上）；
 * 觸控面板永不顯示。徽章 `aria-hidden`、`pointer-events: none`，不改變控制項的可存取名稱（WCAG 2.5.3）。
 * 角落徽章為絕對定位於包覆元素，不佔版面、不位移既有控制項。
 * @example
 * <KeyHint action="openCart"><IconButton label="購物車" icon={<ShoppingCart />} /></KeyHint>
 */
export function KeyHint({
  action,
  arg,
  children,
  className,
  placement = 'corner',
  onBrand = false,
}: KeyHintProps) {
  const visible = useKeyHintVisible(action);
  const keys = hintKeyParts(action, arg);
  return (
    <span className={clsx('relative inline-flex', className)}>
      {children}
      {keys !== null ? (
        <KeyHintBadge keys={keys} visible={visible} placement={placement} onBrand={onBrand} />
      ) : null}
    </span>
  );
}
