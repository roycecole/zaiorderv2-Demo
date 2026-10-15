// src/app/layouts/HelpButton.tsx —— 頂部列的 ⌨「鍵盤快速鍵與偏好」圖示按鈕（≥ 768、非觸控面板）
//
// 位置固定在頂部列最右側，不隨單鍵快速鍵開關出現或消失（不位移版面）；鍵盤提醒收起後在其上顯示小圓點。
import { Keyboard } from 'lucide-react';
import { IconButton } from '@/components';
import { useKeyboardNotice, useKeyShortcuts, useShortcutsDialog } from '@/features/a11y';
import { t } from '@/i18n/zh-TW';

export function HelpButton() {
  const notice = useKeyboardNotice();
  const shortcuts = useShortcutsDialog();
  const keys = useKeyShortcuts('help');
  const dot = notice.dotVisible;
  return (
    <span className="hidden md:inline-flex">
      <IconButton
        label={dot ? t.a11y.helpButton.labelWithDot : t.a11y.helpButton.label}
        tooltip={t.a11y.helpButton.label}
        aria-keyshortcuts={keys}
        aria-haspopup="dialog"
        icon={
          <>
            <Keyboard />
            {dot ? (
              <span
                aria-hidden="true"
                data-zo-kbd-dot=""
                className="pointer-events-none absolute top-2 right-2 size-2.5 rounded-full bg-brand-text shadow-[0_0_0_2px_var(--color-bg)]"
              />
            ) : null}
          </>
        }
        onClick={() => shortcuts.open()}
      />
    </span>
  );
}
