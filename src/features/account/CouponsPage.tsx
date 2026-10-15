// src/features/account/CouponsPage.tsx —— PG-14 我的優惠券：可用 / 已使用 / 已過期（`?tab=`），券卡顯示折扣內容、條件與效期
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LinkButton,
  SkeletonCard,
} from '@/components';
import { formatDateTime, formatMonthDayWeek } from '@/domain/format';
import type { UserCoupon, UserCouponStatus } from '@/domain/types';
import { readApiError } from '@/features/auth/errorInfo';
import { useApi } from '@/hooks/useApi';
import { errorMessageOf } from '@/i18n/strings/errors';
import { t } from '@/i18n/zh-TW';
import { account as tAccount } from '@/i18n/strings/account';
import { qk } from '@/services/api/queryKeys';
import { TabBar, tabPanelProps } from './TabBar';

const s = tAccount.coupons;

const TABS = ['available', 'used', 'expired'] as const;
type CouponTab = (typeof TABS)[number];

const STATUS_OF: Record<CouponTab, UserCouponStatus> = {
  available: 'AVAILABLE',
  used: 'USED',
  expired: 'EXPIRED',
};

function parseTab(raw: string | null): CouponTab {
  return TABS.find((x) => x === raw) ?? 'available';
}

function CouponCard({ item }: { item: UserCoupon }) {
  const { coupon, status } = item;
  const inactive = status !== 'AVAILABLE';
  const titleId = `coupon-${item.id}`;
  const conditions: string[] = [
    coupon.minOrderAmount > 0 ? s.minOrder(coupon.minOrderAmount) : s.noMinOrder,
  ];
  if (coupon.discountType === 'PERCENT' && coupon.maxDiscountAmount !== undefined) {
    conditions.push(s.maxDiscount(coupon.maxDiscountAmount));
  }
  if (coupon.applicableOrderTypes.length > 0 && coupon.applicableOrderTypes.length < 3) {
    conditions.push(s.orderTypes(coupon.applicableOrderTypes));
  }

  const validity =
    status === 'USED' && item.usedAt !== undefined
      ? s.usedOn(formatDateTime(item.usedAt))
      : status === 'EXPIRED'
        ? s.expiredOn(formatMonthDayWeek(coupon.endsAt))
        : s.validUntil(formatMonthDayWeek(coupon.endsAt));

  return (
    <Card
      as="article"
      aria-labelledby={titleId}
      tone={inactive ? 'subtle' : 'default'}
      data-status={status}
      className="flex items-stretch gap-4"
    >
      <div
        aria-hidden="true"
        className={
          inactive
            ? 'grid min-w-20 shrink-0 place-items-center rounded-md bg-bg-muted px-2 text-center text-h3 font-bold text-text-muted grayscale'
            : 'grid min-w-20 shrink-0 place-items-center rounded-md bg-brand-soft px-2 text-center text-h3 font-bold text-brand-text'
        }
      >
        {s.valueLabel(coupon.discountType, coupon.discountValue)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2
          id={titleId}
          className={
            inactive
              ? 'flex flex-wrap items-center gap-2 text-base leading-6 font-bold text-text-muted'
              : 'flex flex-wrap items-center gap-2 text-base leading-6 font-bold text-text'
          }
        >
          <span className="[overflow-wrap:anywhere]">{coupon.name}</span>
          {inactive ? <Badge tone="neutral">{s.status[status]}</Badge> : null}
          {coupon.memberOnly ? <Badge tone="info">{s.memberOnly}</Badge> : null}
        </h2>
        {coupon.description !== undefined && coupon.description !== '' ? (
          <p className="text-sm leading-5 text-text-sub">{coupon.description}</p>
        ) : null}
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-xs leading-4 text-text-sub">
          {conditions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="text-xs leading-4 text-text-muted">
          {validity}
          <span aria-hidden="true">・</span>
          <span className="font-mono">{s.code(coupon.code)}</span>
        </p>
      </div>
    </Card>
  );
}

export function CouponsPage() {
  const api = useApi();
  usePageTitle(s.pageTitle);
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const status = STATUS_OF[tab];

  const query = useQuery({
    queryKey: qk.me.coupons(status),
    queryFn: () => api.me.coupons.list(status),
    staleTime: 30_000,
    retry: false,
  });
  const items = query.data?.items ?? [];
  const emptyText = tab === 'used' ? s.emptyUsed : tab === 'expired' ? s.emptyExpired : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-4 md:py-6">
      <h1 className="text-h1 font-bold text-text">{s.pageTitle}</h1>

      <TabBar
        idPrefix="coupons"
        label={s.tabsLabel}
        value={tab}
        tabs={TABS.map((id) => ({ id, label: s.tabs[id] }))}
        onChange={(next) =>
          setParams(
            (prev) => {
              const out = new URLSearchParams(prev);
              if (next === 'available') out.delete('tab');
              else out.set('tab', next);
              return out;
            },
            { replace: true },
          )
        }
      />

      <div {...tabPanelProps('coupons', tab)} aria-busy={query.isPending} className="flex flex-col gap-3">
        {query.isPending ? (
          <>
            <span role="status" className="sr-only">
              {t.common.loading}
            </span>
            <SkeletonCard variant="list" />
            <SkeletonCard variant="list" />
          </>
        ) : query.isError ? (
          <ErrorState
            title={s.loadFailed}
            message={errorMessageOf(query.error)}
            requestId={readApiError(query.error).requestId}
            onRetry={() => void query.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="🎟️"
            title={emptyText ?? s.emptyTitle}
            action={
              tab === 'available' ? (
                <LinkButton as={Link} to={ROUTES.home} variant="secondary">
                  {t.common.backToMenu}
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {items.map((item) => (
                <li key={item.id}>
                  <CouponCard item={item} />
                </li>
              ))}
            </ul>
            {tab === 'available' ? (
              <p className="text-xs leading-4 text-text-muted">{s.howToUse}</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
