// src/features/orders/useReorder.tsx —— 再來一單（FLOW-13、FR-OD-06）
//
// 取得訂單與品項快照 → 取最新的商品詳情 → 依現況逐項比對（planReorder）→ 加入購物車。
// 全部原樣加入時直接前往購物車；有調整份數、略過或選項異動時，以對話框說明後再前往（略過清單說明）。
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ROUTES } from '@/app/routes';
import { Button, Dialog, useToast } from '@/components';
import type { ID, Order, ProductDetail } from '@/domain/types';
import { useAnnounce } from '@/features/a11y';
import { isNotFoundError } from '@/features/auth/errorInfo';
import { useCartStore } from '@/features/cart/cartStore';
import { useApi } from '@/hooks/useApi';
import { orders as tOrders } from '@/i18n/strings/orders';
import { qk } from '@/services/api/queryKeys';
import { useGuestOrdersStore } from './guestOrdersStore';
import { isCleanPlan, planReorder } from './reorder';
import type { ReorderPlan } from './reorder';

interface ReorderResult {
  plan: ReorderPlan;
  /** 實際加入購物車的品項行數 */
  added: number;
}

export interface UseReorder {
  /** 以訂單物件或僅有 id（清單卡片）開始再來一單；進行中重複呼叫會被忽略 */
  reorder: (source: Order | { id: ID }) => Promise<void>;
  /** 正在處理的訂單 id（供按鈕顯示 loading） */
  pendingOrderId: ID | null;
  /** 結果對話框：請渲染在頁面內（沒有需要說明的結果時為 null） */
  dialog: ReactNode;
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-3">
      <h3 className="text-sm leading-5 font-semibold text-text">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-5 text-text-sub">
        {items.map((text, i) => (
          <li key={`${text}-${i}`}>{text}</li>
        ))}
      </ul>
    </section>
  );
}

export function useReorder(): UseReorder {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const announce = useAnnounce();
  const [pendingOrderId, setPendingOrderId] = useState<ID | null>(null);
  const [result, setResult] = useState<ReorderResult | null>(null);
  const busyRef = useRef(false);

  const reorder = useCallback(
    async (source: Order | { id: ID }): Promise<void> => {
      if (busyRef.current) return;
      busyRef.current = true;
      setPendingOrderId(source.id);
      try {
        let order: Order;
        if ('items' in source) {
          order = source;
        } else {
          const token = useGuestOrdersStore.getState().tokenFor(source.id);
          order = await api.orders.get(source.id, token !== null ? { trackingToken: token } : undefined);
        }

        // 取最新的商品詳情（含選項群組與剩餘份數）；已下架者（404）視為 null
        const productIds = [
          ...new Set(order.items.flatMap((i) => (i.productId != null ? [i.productId] : []))),
        ];
        const entries = await Promise.all(
          productIds.map(async (id): Promise<readonly [ID, ProductDetail | null]> => {
            try {
              const detail = await queryClient.fetchQuery({
                queryKey: qk.store.product(id),
                queryFn: () => api.store.getProduct(id),
                staleTime: 0,
              });
              return [id, detail];
            } catch (e) {
              if (isNotFoundError(e)) return [id, null];
              throw e;
            }
          }),
        );

        const cart = useCartStore.getState();
        const plan = planReorder(order.items, new Map(entries), cart.lines);
        let added = 0;
        const skipped = [...plan.skipped];
        for (const line of plan.lines) {
          if (cart.addLine(line)) added += 1;
          else skipped.push({ name: line.snapshot.name, reason: 'LINE_LIMIT' });
        }
        const finalPlan: ReorderPlan = { ...plan, skipped };

        if (added > 0 && isCleanPlan(finalPlan)) {
          toast({ message: tOrders.reorder.added, tone: 'success' });
          announce(tOrders.reorder.addedCount(added));
          navigate(ROUTES.cart);
          return;
        }
        announce(added > 0 ? tOrders.reorder.addedCount(added) : tOrders.reorder.allSkipped);
        setResult({ plan: finalPlan, added });
      } catch {
        toast({ message: tOrders.reorder.failed, tone: 'error' });
      } finally {
        busyRef.current = false;
        setPendingOrderId(null);
      }
    },
    [api, queryClient, navigate, toast, announce],
  );

  const s = tOrders.reorder;
  const dialog: ReactNode =
    result === null ? null : (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) setResult(null);
        }}
        title={s.dialogTitle}
        description={result.added > 0 ? s.addedCount(result.added) : s.allSkipped}
        footer={
          result.added > 0 ? (
            <>
              <Button variant="secondary" onClick={() => setResult(null)}>
                {s.stay}
              </Button>
              <Button
                onClick={() => {
                  setResult(null);
                  navigate(ROUTES.cart);
                }}
              >
                {s.goCart}
              </Button>
            </>
          ) : (
            <Button onClick={() => setResult(null)}>{s.close}</Button>
          )
        }
      >
        <ResultList
          title={s.adjustedTitle}
          items={result.plan.adjusted.map((a) =>
            a.reason === 'LIMITED' ? s.adjusted(a.name, a.to) : s.adjustedMax(a.name, a.to),
          )}
        />
        <ResultList
          title={s.optionsTitle}
          items={result.plan.optionsDropped.map((name) => s.optionsDropped(name))}
        />
        <ResultList
          title={s.skippedTitle}
          items={result.plan.skipped.map((k) => s.skipped[k.reason](k.name))}
        />
      </Dialog>
    );

  return { reorder, pendingOrderId, dialog };
}
