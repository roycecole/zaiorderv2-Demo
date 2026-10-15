// src/features/menu/RecentItems.tsx —— 「常點的餐點」區塊（CMP-36、FR-MN-13、§6.8）
//
// 橫向緊湊卡（最多 6 項）：品名、選項摘要（無選項者省略）、現價、「↻ 再點」；售完者停用；僅列出菜單內仍存在的商品。
// 現價為選項加價後的金額：預取最多 6 筆商品詳情並快取，載入中或失敗時顯示菜單的起始價（「NT$ 35 起」）。
import { useQueries } from '@tanstack/react-query';
import { Repeat2 } from 'lucide-react';
import { useId } from 'react';
import { Badge, Price } from '@/components';
import { applyRemembered } from '@/domain/rememberedChoice';
import type { RememberedChoice } from '@/domain/rememberedChoice';
import type { ProductSummary } from '@/domain/types';
import { optionSummary } from '@/features/cart/cartMath';
import { useApi } from '@/hooks/useApi';
import { t } from '@/i18n/zh-TW';
import { qk } from '@/services/api/queryKeys';
import { selectedUnitPrice } from './sheetModel';

export const RECENT_ITEMS_MAX = 6;

export interface RecentEntry {
  product: ProductSummary;
  remembered: RememberedChoice;
}

export interface RecentItemsProps {
  /** 已依「最近點過」排序、且商品仍在菜單內的項目（最多 6 項） */
  entries: ReadonlyArray<RecentEntry>;
  /** 暫時不可加入（店家狀態政策）時的原因：「再點」停用 */
  blockedReason?: string | null | undefined;
  /** 處理中的商品（取商品詳情驗證記憶） */
  repeatingId?: string | null | undefined;
  onRepeat: (product: ProductSummary, remembered: RememberedChoice) => void;
}

export function RecentItems({ entries, blockedReason, repeatingId, onRepeat }: RecentItemsProps) {
  const api = useApi();
  const titleId = useId();
  const shown = entries.slice(0, RECENT_ITEMS_MAX);
  const details = useQueries({
    queries: shown.map((entry) => ({
      queryKey: qk.store.product(entry.product.id),
      queryFn: () => api.store.getProduct(entry.product.id),
      staleTime: 60_000,
    })),
  });

  if (shown.length === 0) return null;
  const blocked = blockedReason !== null && blockedReason !== undefined && blockedReason !== '';

  return (
    <section aria-labelledby={titleId} className="pt-5 md:pt-7">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 md:mb-4">
        <h2 id={titleId} className="text-h2 font-bold">
          {t.menu.recent.title}
        </h2>
        <p className="text-sm leading-5 text-text-muted">{t.menu.recent.subtitle}</p>
      </div>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:-mx-8 md:px-8 [&::-webkit-scrollbar]:hidden">
        {shown.map((entry, index) => {
          const { product, remembered } = entry;
          const detail = details[index]?.data;
          const applied = detail === undefined ? undefined : applyRemembered(detail, remembered);
          // 詳情載入完成：現價 = 基本價 + 套用後選項加價；否則顯示菜單的起始價
          const price =
            detail !== undefined && applied !== undefined
              ? { amount: selectedUnitPrice(detail, applied.optionIds), from: false }
              : { amount: product.displayPrice, from: product.isPriceFrom };
          const summary =
            applied !== undefined && applied.status !== 'PARTIAL'
              ? optionSummary(applied.labels)
              : optionSummary(remembered.labels);
          const soldOut = product.isSoldOut;
          const busy = repeatingId === product.id;
          const inactive = soldOut || blocked || busy;
          return (
            <li
              key={product.id}
              className="flex w-56 shrink-0 flex-col gap-3 rounded-lg border border-border bg-bg p-4"
            >
              <div className="min-w-0">
                <h3
                  className={
                    soldOut
                      ? 'text-base leading-6 font-semibold text-text-muted [overflow-wrap:anywhere]'
                      : 'text-base leading-6 font-semibold [overflow-wrap:anywhere]'
                  }
                >
                  {product.name}
                </h3>
                {summary !== '' ? (
                  <p className="text-sm leading-5 text-text-muted [overflow-wrap:anywhere]">
                    {summary}
                  </p>
                ) : null}
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                <Price
                  amount={price.amount}
                  from={price.from}
                  tone={soldOut ? 'muted' : 'default'}
                />
                {soldOut ? <Badge tone="inverse">{t.common.soldOut}</Badge> : null}
                <button
                  type="button"
                  aria-label={t.menu.card.repeatLabel(product.name, summary)}
                  aria-disabled={inactive ? true : undefined}
                  onClick={() => {
                    if (!inactive) onRepeat(product, remembered);
                  }}
                  className={
                    inactive
                      ? 'hit-area relative inline-flex min-h-9 cursor-not-allowed items-center gap-1 rounded-pill bg-bg-muted pr-3 pl-2 text-sm leading-5 font-semibold whitespace-nowrap text-text-disabled kiosk:min-h-(--hit-size)'
                      : 'hit-area relative inline-flex min-h-9 items-center gap-1 rounded-pill border border-brand bg-bg pr-3 pl-2 text-sm leading-5 font-semibold whitespace-nowrap text-brand-text transition-colors duration-150 hover:bg-brand-soft kiosk:min-h-(--hit-size)'
                  }
                >
                  <Repeat2 aria-hidden="true" className="size-4 shrink-0" />
                  {t.menu.card.repeat}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
