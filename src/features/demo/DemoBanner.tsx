// src/features/demo/DemoBanner.tsx —— Demo 提示橫幅（FR-DM-07）：說明資料與金流皆為模擬，可關閉
//
// 以 `position: fixed` 的小卡錨定在左下角、底部 Tab / CartBar 之上（與 Toast 共用 `--toast-offset-bottom` 浮動槽的基準），
// 不佔流、不位移版面（CLS = 0），也不排在跳過連結之前的 Tab 順序。任務型頁面（結帳、付款、訂單詳情）與觸控面板不顯示（見 DemoRoot）。
import { Info, X } from 'lucide-react';
import { Button, IconButton } from '@/components';
import { demo as tDemo } from '@/i18n/strings/demo';

export interface DemoBannerProps {
  onOpenTools: () => void;
  onDismiss: () => void;
}

export function DemoBanner({ onOpenTools, onDismiss }: DemoBannerProps) {
  return (
    <section
      aria-label={tDemo.banner.label}
      className="fixed bottom-(--toast-offset-bottom) left-4 z-40 flex max-w-[min(420px,calc(100vw-2rem))] items-start gap-3 rounded-xl border border-info/25 bg-info-soft p-3 shadow-md"
    >
      <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-info" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 text-text">{tDemo.banner.message}</p>
        <div className="mt-2">
          <Button variant="secondary" onClick={onOpenTools}>
            {tDemo.banner.openTools}
          </Button>
        </div>
      </div>
      <IconButton label={tDemo.banner.dismiss} icon={<X />} variant="ghost" onClick={onDismiss} />
    </section>
  );
}
