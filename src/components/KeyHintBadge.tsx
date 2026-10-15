// src/components/KeyHintBadge.tsx —— 快速鍵徽章（CMP-34 的呈現層）
import clsx from 'clsx';
import { Kbd } from './Kbd';

export interface KeyHintBadgeProps {
  /** 鍵名：單一字元（例：`c`）或組合（例：`['Ctrl', 'Enter']`） */
  keys: string | readonly string[];
  /**
   * 是否顯示。**預設關閉**：單鍵快速鍵未啟用、觸控面板模式時必須為 false（BR-34、03 §10.3）。
   * 由 features/a11y 的 `KeyHint` 依 prefs 決定後傳入；本元件不讀取任何 store。
   */
  visible: boolean;
  /**
   * `corner`（預設）：絕對定位於最近的 `position: relative` 祖先的右上角，不影響版面；
   * `inline`：行內（inline-flex，放在標籤之後，間距 6px），使用者開啟的瞬間允許局部重排（Q-16）。
   */
  placement?: 'corner' | 'inline';
  /** 位於主色填滿的按鈕內：透明底 + 同字色邊框，對比與按鈕文字相同 */
  onBrand?: boolean;
  className?: string;
}

/**
 * `aria-hidden`、`pointer-events: none`：不改變控制項的可存取名稱（WCAG 2.5.3），
 * 控制項本身須另行輸出 `aria-keyshortcuts`（僅在啟用時）。
 */
export function KeyHintBadge({
  keys,
  visible,
  placement = 'corner',
  onBrand = false,
  className,
}: KeyHintBadgeProps) {
  if (!visible) return null;
  const list = typeof keys === 'string' ? [keys] : keys;
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'pointer-events-none inline-flex items-center gap-0.5',
        placement === 'corner' ? 'absolute -top-2 -right-2 z-10' : 'ml-1.5 align-middle',
        className,
      )}
    >
      {list.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-0.5">
          {index > 0 ? <span className="text-xs text-text-muted">+</span> : null}
          <Kbd tone={onBrand ? 'onBrand' : 'default'}>{key}</Kbd>
        </span>
      ))}
    </span>
  );
}
