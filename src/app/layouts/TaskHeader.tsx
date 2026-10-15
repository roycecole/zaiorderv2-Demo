// src/app/layouts/TaskHeader.tsx —— 任務型頁面（結帳、付款、訂單詳情）的精簡頂部列（03 §3.3）
//
// 返回鈕 + 頁名 + 最右側的 ⌨（≥ 768）；隱藏底部 Tab 與登入 / 查詢訂單，避免誤觸。⌨ 位置與一般頁面一致（WCAG 3.2.6）。
import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { IconButton } from '@/components';
import { ROUTES } from '@/app/routes';
import { t } from '@/i18n/zh-TW';
import { HelpButton } from './HelpButton';
import { usePageTitleValue } from './pageTitle';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';

export interface TaskHeaderProps {
  /** 沒有站內歷史（直接開啟網址）時返回的路徑；預設回菜單 */
  backTo?: string;
  backLabel?: string;
}

export function TaskHeader({ backTo = ROUTES.home, backLabel }: TaskHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const title = usePageTitleValue();
  const kiosk = useIsKioskUi();

  const goBack = (): void => {
    // location.key === 'default'：此分頁的第一個畫面，沒有站內歷史可返回
    if (location.key !== 'default') void navigate(-1);
    else void navigate(backTo);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg">
      <div className="mx-auto flex min-h-(--appbar-h) max-w-[1440px] items-center gap-2 pr-2 pl-1 md:px-6 lg:px-8">
        <IconButton label={backLabel ?? t.a11y.shell.back} icon={<ArrowLeft />} onClick={goBack} />
        <p className="min-w-0 flex-1 truncate text-h3 font-semibold text-text">{title ?? ''}</p>
        {kiosk ? null : <HelpButton />}
      </div>
    </header>
  );
}
