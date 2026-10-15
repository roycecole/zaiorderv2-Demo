// src/app/layouts/ShellFooter.tsx —— 頁尾：店家資訊、隱私權、條款、鍵盤快速鍵、偏好設定、清除我的資料
//
// 入口位置在一般頁面與任務型頁面一致（WCAG 3.2.6）。觸控面板模式不提供鍵盤與偏好入口（03 §5.6）。
import clsx from 'clsx';
import { Link } from 'react-router';
import { KeyHint, ClearMyDataLink, useShortcutsDialog } from '@/features/a11y';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useStoreInfo } from '@/features/store/queries';
import { env } from '@/config/env';
import { t } from '@/i18n/zh-TW';
import { ROUTES } from '@/app/routes';

const LINK =
  'inline-flex min-h-(--hit-size) items-center font-medium text-text-sub underline underline-offset-4 hover:text-text';

export interface ShellFooterProps {
  variant?: 'app' | 'task';
}

export function ShellFooter({ variant = 'app' }: ShellFooterProps) {
  const kiosk = useIsKioskUi();
  const info = useStoreInfo();
  const shortcuts = useShortcutsDialog();
  const rememberChoices = usePrefsStore((s) => s.rememberChoices);
  const f = t.a11y.shell.footer;

  return (
    <footer
      className={clsx(
        'mt-6 border-t border-border px-4 pt-4 pb-10 text-sm leading-5 text-text-muted md:px-6 lg:px-8',
        // 手機底部 Tab 為 fixed：頁尾預留其高度，最後一列連結不被遮住
        'max-md:pb-[calc(var(--bottom-tab-h,0px)+var(--safe-bottom)+1rem)]',
        variant === 'task' && 'mt-2',
      )}
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="flex flex-wrap items-center gap-x-6">
          <span className="font-medium text-text-sub">{info.data?.name ?? ''}</span>
          {kiosk ? null : (
            <KeyHint action="goStore" placement="inline">
              <Link to={ROUTES.store} className={LINK}>
                {f.storeInfo}
              </Link>
            </KeyHint>
          )}
          <Link to={ROUTES.privacy} className={LINK}>
            {f.privacy}
          </Link>
          <Link to={ROUTES.terms} className={LINK}>
            {f.terms}
          </Link>
          {kiosk ? null : (
            <>
              <KeyHint action="help" placement="inline">
                {/* id：跳過連結「鍵盤快速鍵與偏好」的目標（連結需指向真實存在的元素） */}
                <button
                  id="shortcuts"
                  type="button"
                  className={LINK}
                  onClick={() => shortcuts.open()}
                >
                  {f.shortcuts}
                </button>
              </KeyHint>
              <button
                type="button"
                className={LINK}
                onClick={() => shortcuts.open({ focus: 'preferences' })}
              >
                {f.preferences}
              </button>
              <ClearMyDataLink className={LINK} />
            </>
          )}
        </div>
        {!kiosk && rememberChoices ? (
          <p className="mt-1 text-xs leading-4">{f.memoryNote}</p>
        ) : null}
        {env.demoMode ? <p className="mt-1 text-xs leading-4">{f.demoNote}</p> : null}
      </div>
    </footer>
  );
}
