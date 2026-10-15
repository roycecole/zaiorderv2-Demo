// src/features/orders/OrdersPage.tsx —— PG-07 歷史訂單
//
// 會員：三個分頁（進行中 / 已完成 / 已取消，`?tab=`），`OrderCard` 清單，游標分頁（每頁 10 筆，捲到底自動載入，
// 並保留「載入更多」按鈕）。訪客導向 PG-08 查詢訂單（該頁會顯示本機記錄的近期訂單）。
//
// Mock 的 `orders.list` 不推進模擬（只做顯示修正），因此進入「進行中」分頁時，對各筆訂單背景呼叫一次
// `orders.get` 結算並推進，狀態有變動就重新載入清單；頁面可見期間每 15 秒同步一次。
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import {
  Button,
  EmptyState,
  ErrorState,
  LinkButton,
  SkeletonCard,
  Spinner,
} from '@/components';
import type { OrderSummary } from '@/domain/types';
import { TabBar, tabPanelProps } from '@/features/account/TabBar';
import { readApiError } from '@/features/auth/errorInfo';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { useApi } from '@/hooks/useApi';
import { useLatest } from '@/hooks/useLatest';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import { errorMessageOf } from '@/i18n/strings/errors';
import { t } from '@/i18n/zh-TW';
import { orders as tOrders } from '@/i18n/strings/orders';
import { qk } from '@/services/api/queryKeys';
import { invalidateOrderLists } from './invalidate';
import { OrderCard } from './OrderCard';
import { useReorder } from './useReorder';

const TABS = ['active', 'completed', 'cancelled'] as const;
type OrderTab = (typeof TABS)[number];

const PAGE_SIZE = 10;
const SYNC_INTERVAL_MS = 15_000;
const MAX_SYNC = 10;

function parseTab(raw: string | null): OrderTab {
  return TABS.find((x) => x === raw) ?? 'active';
}

const summaryKey = (o: OrderSummary): string => `${o.id}:${o.status}:${o.paymentStatus}`;

/**
 * 清單的狀態同步（見檔頭）：對「進行中」分頁已載入的訂單呼叫 `orders.get`，
 * 與清單上的狀態不同就呼叫 `onChanged`（由呼叫端重新載入清單）。
 */
function useActiveSummarySync(
  enabled: boolean,
  items: ReadonlyArray<OrderSummary>,
  onChanged: () => void,
): void {
  const api = useApi();
  const queryClient = useQueryClient();
  const visible = usePageVisibility();
  const itemsRef = useLatest(items);
  const onChangedRef = useLatest(onChanged);
  const checked = useRef(new Set<string>());

  const run = useCallback(
    async (force: boolean): Promise<void> => {
      const targets = itemsRef.current
        .filter((o) => force || !checked.current.has(summaryKey(o)))
        .slice(0, MAX_SYNC);
      if (targets.length === 0) return;
      for (const o of targets) checked.current.add(summaryKey(o));
      const results = await Promise.allSettled(
        targets.map((o) =>
          queryClient.fetchQuery({
            queryKey: qk.orders.detail(o.id),
            queryFn: () => api.orders.get(o.id),
            staleTime: 0,
          }),
        ),
      );
      const changed = results.some((r, i) => {
        const target = targets[i];
        return (
          r.status === 'fulfilled' &&
          target !== undefined &&
          (r.value.status !== target.status || r.value.payment.status !== target.paymentStatus)
        );
      });
      if (changed) onChangedRef.current();
    },
    [api, queryClient, itemsRef, onChangedRef],
  );

  const signature = items.map(summaryKey).join(',');
  useEffect(() => {
    if (enabled && signature !== '') void run(false);
  }, [enabled, signature, run]);

  useEffect(() => {
    if (!enabled || !visible) return;
    const timer = setInterval(() => void run(true), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, visible, run]);
}

function MemberOrders() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const { reorder, pendingOrderId, dialog } = useReorder();
  usePageTitle(tOrders.history.pageTitle);

  const query = useInfiniteQuery({
    queryKey: qk.orders.list(tab),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.orders.list({ tab, limit: PAGE_SIZE, ...(pageParam !== undefined ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  const invalidateLists = useCallback((): void => invalidateOrderLists(queryClient), [queryClient]);
  useActiveSummarySync(tab === 'active' && query.isSuccess, items, invalidateLists);

  // 捲到清單底端自動載入下一頁（無 IntersectionObserver 的環境只靠「載入更多」按鈕）
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const node = sentinelRef.current;
    if (node === null || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  const s = tOrders.history;
  const emptyBody = s.emptyBody[tab];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 md:py-6">
      <h1 className="text-h1 font-bold text-text">{s.pageTitle}</h1>

      <TabBar
        idPrefix="orders"
        label={s.tabsLabel}
        value={tab}
        tabs={TABS.map((id) => ({ id, label: s.tabs[id] }))}
        onChange={(next) => {
          setParams(
            (prev) => {
              const out = new URLSearchParams(prev);
              if (next === 'active') out.delete('tab');
              else out.set('tab', next);
              return out;
            },
            { replace: true },
          );
        }}
      />

      <div {...tabPanelProps('orders', tab)} aria-busy={query.isPending} className="flex flex-col gap-3">
        {query.isPending ? (
          <>
            <span className="sr-only" role="status">
              {t.common.loading}
            </span>
            <SkeletonCard variant="list" />
            <SkeletonCard variant="list" />
            <SkeletonCard variant="list" />
          </>
        ) : query.isError ? (
          <ErrorState
            title={s.loadFailed}
            message={errorMessageOf(query.error)}
            requestId={readApiError(query.error).requestId}
            retrying={query.isRefetching}
            onRetry={() => void query.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="🧾"
            title={s.emptyTitle}
            description={emptyBody}
            action={
              <LinkButton as={Link} to={ROUTES.home} variant="primary">
                {t.common.backToMenu}
              </LinkButton>
            }
          />
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {items.map((order) => (
                <li key={order.id}>
                  <OrderCard
                    order={order}
                    onReorder={(o) => reorder({ id: o.id })}
                    reordering={pendingOrderId === order.id}
                  />
                </li>
              ))}
            </ul>
            <div ref={sentinelRef} className="flex min-h-(--hit-size) items-center justify-center">
              {query.hasNextPage ? (
                <Button
                  variant="secondary"
                  loading={query.isFetchingNextPage}
                  loadingLabel={s.loadingMore}
                  onClick={() => void query.fetchNextPage()}
                >
                  {s.loadMore}
                </Button>
              ) : query.isFetchingNextPage ? (
                <Spinner />
              ) : (
                <p className="text-sm leading-5 text-text-muted">{s.allLoaded}</p>
              )}
            </div>
          </>
        )}
      </div>

      <p className="text-xs leading-4 text-text-muted">{s.guestNote}</p>
      {dialog}
    </div>
  );
}

export function OrdersPage() {
  const isLoggedIn = useSessionStore(selectIsLoggedIn);
  // 訪客：導向查詢訂單（PG-07；07 §8），那裡會列出本機記錄的近期訂單
  if (!isLoggedIn) return <Navigate to={ROUTES.orderLookup} replace />;
  return <MemberOrders />;
}
