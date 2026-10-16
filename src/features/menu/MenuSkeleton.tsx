// src/features/menu/MenuSkeleton.tsx —— 首頁首次載入的整頁骨架
//
// 店家資訊、營業狀態、Banner 與菜單都回來之前顯示；資料齊了就整塊換成真正的內容（見 MenuPage 的 settled）。
// 逐塊出現會把已經顯示的內容一路往下推，CLS 會超標（NFR-03：≤ 0.1）；整頁骨架被整塊換掉，沒有位移的元素。
// 純裝飾：不進無障礙樹，載入狀態由頁面的 role="status" 文字說明。
import { Skeleton, SkeletonCard, VisuallyHidden } from '@/components';
import { t } from '@/i18n/zh-TW';
import { BannerSkeleton } from './BannerCarousel';
import { CategoryChipsSkeleton } from './CategoryChips';

export interface MenuSkeletonProps {
  /** 搜尋框放在頁內（手機）；桌機放在頂部列的插槽 */
  inlineSearch: boolean;
  /** 觸控面板：沒有店家資訊列 */
  kiosk: boolean;
}

export function MenuSkeleton({ inlineSearch, kiosk }: MenuSkeletonProps) {
  return (
    <div aria-busy="true" role="status">
      <VisuallyHidden>{t.menu.loading}</VisuallyHidden>
      <div aria-hidden="true">
        {kiosk ? null : (
          <div className="px-4 pt-3 md:px-8">
            {/* 手機是有框的緊湊卡片，≥ 768 是單列資訊 */}
            <div className="rounded-lg border border-border p-3 md:rounded-none md:border-0 md:px-0 md:py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <Skeleton width={220} height={28} rounded="full" />
                <Skeleton width={200} height={44} rounded="full" />
              </div>
            </div>
          </div>
        )}
        {inlineSearch ? (
          <div className="px-4 pt-3 md:px-8">
            <Skeleton height={44} rounded="full" />
          </div>
        ) : null}
        <div className="px-4 md:px-8">
          <BannerSkeleton count={3} />
        </div>
        <CategoryChipsSkeleton className="mt-3" />
        <div className="min-h-[70dvh] px-4 pt-5 pb-6 md:px-8 md:pb-14">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} variant="list" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
