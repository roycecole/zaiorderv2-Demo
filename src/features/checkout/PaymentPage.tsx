// src/features/checkout/PaymentPage.tsx —— PG-05 模擬金流（FR-PY-02～04；FLOW-09、FLOW-11）
//
// 僅 Demo 使用：模擬第三方金流頁，不會產生實際扣款。Phase 2 以真實金流導轉取代（HTTP 模式導向 redirectUrl）。
// - 進入時若訂單尚無付款交易，依訂單的付款方式（或 ?method=）發起一次付款（orders.pay）。
// - Demo 面板預設結果（SUCCESS / FAILED）：約 1 秒「處理中」後自動套用；TIMEOUT：不回應直到付款期限到期；MANUAL：顯示按鈕。
// - 保留說明與倒數取 `payment.expiresAt`（不寫死 15 分鐘）；剩餘 < 2 分鐘以 role="alert" 通報一次。
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Hourglass } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Button,
  ErrorState,
  InlineAlert,
  LinkButton,
  RadioCard,
  RadioGroup,
  Skeleton,
  Spinner,
} from '@/components';
import { formatTWD, formatTime } from '@/domain/format';
import type { Order, PaymentMethod } from '@/domain/types';
import { env } from '@/config/env';
import { useApi } from '@/hooks/useApi';
import { useClockNow } from '@/hooks/useClockNow';
import { useDemoControl } from '@/hooks/useDemoControl';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import { t } from '@/i18n/zh-TW';
import { checkout as tCheckout } from '@/i18n/strings/checkout';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { useStoreInfo } from '@/features/store/queries';
import { qk } from '@/services/api/queryKeys';
import type { OrderNavState, PaymentNavState } from './navState';

const T = tCheckout.pay;

/** 「處理中」過場時間（03 PG-05：Demo 面板預設結果時約 1 秒） */
export const PROCESSING_MS = 1000;
/** 剩餘不足此時間時通報一次（03 §9「付款時限」） */
export const WARNING_MS = 2 * 60_000;

const ONLINE_METHODS: ReadonlyArray<PaymentMethod> = ['CREDIT_CARD', 'LINE_PAY', 'JKOPAY'];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 線上付款完成後導回的前端網址（HTTP 模式的 returnUrl；結果仍以後端為準） */
function returnUrlFor(orderId: string): string {
  const base = env.basePath.replace(/\/$/, '');
  const hash = env.routerMode === 'hash' ? '#' : '';
  return `${window.location.origin}${base}/${hash}${ROUTES.payment(orderId)}`;
}

export function PaymentPage() {
  usePageTitle(T.pageTitle);
  const { orderId = '' } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const api = useApi();
  const demo = useDemoControl();
  const queryClient = useQueryClient();
  const visible = usePageVisibility();
  const infoQuery = useStoreInfo();
  const navState = (location.state ?? null) as PaymentNavState | null;

  const token = useGuestOrdersStore(
    (s) => s.orders.find((o) => o.orderId === orderId)?.trackingToken ?? null,
  );
  const opts = token !== null ? { trackingToken: token } : undefined;

  const orderQuery = useQuery({
    queryKey: qk.orders.detail(orderId),
    queryFn: () => api.orders.get(orderId, opts),
    enabled: orderId !== '',
    retry: false,
    // 待付款期間每 5 秒更新（FLOW-16）；頁面隱藏時暫停
    refetchInterval: (q) => (q.state.data?.status === 'PENDING_PAYMENT' && visible ? 5000 : false),
  });
  const order = orderQuery.data;
  const detailKey = qk.orders.detail(orderId);

  const methodParam = ((): PaymentMethod | null => {
    const m = params.get('method');
    return m === 'CREDIT_CARD' || m === 'LINE_PAY' || m === 'JKOPAY' ? m : null;
  })();

  const [processing, setProcessing] = useState(false);
  const [waitingTimeout, setWaitingTimeout] = useState(params.get('sim') === 'timeout');
  const [payError, setPayError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PaymentMethod | null>(null);
  const initiatedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const goOrder = (state?: OrderNavState): void => {
    navigate(ROUTES.order(orderId), { replace: true, ...(state !== undefined ? { state } : {}) });
  };

  const startPayment = async (method: PaymentMethod): Promise<void> => {
    setPayError(null);
    // Demo 面板預設 SUCCESS / FAILED：以「處理中」過場約 1 秒再套用結果（pay 回應已含結果）
    const preset = demo?.getState().nextPaymentResult ?? 'MANUAL';
    const auto = method !== 'CASH' && (preset === 'SUCCESS' || preset === 'FAILED');
    setProcessing(true);
    setWaitingTimeout(false);
    try {
      const [res] = await Promise.all([
        api.orders.pay(orderId, { method, returnUrl: returnUrlFor(orderId) }, opts),
        auto ? sleep(PROCESSING_MS) : Promise.resolve(),
      ]);
      queryClient.setQueryData(detailKey, res.order);
      if (!mountedRef.current) return;
      if (method === 'CASH' || res.status === 'SUCCESS' || res.order.status !== 'PENDING_PAYMENT') {
        goOrder();
        return;
      }
      if (res.status === 'PENDING') {
        if (demo === null && res.redirectUrl !== undefined) {
          // HTTP 模式：前往金流業者（結果以後端 Webhook 為準，導回後只查詢訂單）
          window.location.assign(res.redirectUrl);
          return;
        }
        setWaitingTimeout(res.redirectUrl?.includes('sim=timeout') === true);
      }
      // FAILED：由 order.payment.latest 呈現失敗與「重新付款 / 改用現金」
    } catch (e) {
      if (mountedRef.current) setPayError(t.errors.messageOf(e, T.payInitFailed));
      void queryClient.invalidateQueries({ queryKey: detailKey });
    } finally {
      if (mountedRef.current) setProcessing(false);
    }
  };

  // 進入付款頁：尚無付款交易時發起一次付款
  useEffect(() => {
    if (order === undefined || initiatedRef.current) return;
    if (order.status !== 'PENDING_PAYMENT' || !order.permissions.canPay) return;
    const latest = order.payment.latest;
    if (latest !== undefined && (latest.status === 'PENDING' || latest.status === 'FAILED')) return;
    const method: PaymentMethod =
      methodParam ?? (order.payment.method === 'CASH' ? 'LINE_PAY' : order.payment.method);
    initiatedRef.current = true;
    queueMicrotask(() => void startPayment(method));
    // 只在訂單首次載入時評估；startPayment 以最新閉包執行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  // 倒數（取 payment.expiresAt）
  const expiresAtMs =
    order?.payment.expiresAt != null ? Date.parse(order.payment.expiresAt) : Number.NaN;
  const pending = order?.status === 'PENDING_PAYMENT';
  const now = useClockNow(pending && Number.isFinite(expiresAtMs) ? 1000 : null);
  const remainingMs = Number.isFinite(expiresAtMs) ? expiresAtMs - now.getTime() : Number.NaN;
  const timeUp = pending && Number.isFinite(remainingMs) && remainingMs <= 0;

  // 倒數歸零：重新取得訂單（伺服器結算為「付款逾時」取消）
  useEffect(() => {
    if (timeUp) void orderQuery.refetch();
    // refetch 為穩定引用；只在剛歸零時觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

  // 逾期（含伺服器已結算為付款逾時的取消）：顯示說明後導回訂單頁；顧客或店家取消者直接導向訂單頁
  const cancelledBySystem = order?.status === 'CANCELLED' && order.cancellation?.by === 'SYSTEM';
  const cancelledOther =
    order?.status === 'CANCELLED' && !cancelledBySystem && order.cancellation !== undefined;
  const expired =
    cancelledBySystem ||
    (order?.status === 'CANCELLED' && !cancelledOther) ||
    timeUp ||
    (pending && order?.permissions.canPay === false);
  useEffect(() => {
    if (!expired) return;
    const id = setTimeout(
      () => navigate(ROUTES.order(orderId), { replace: true, state: { paymentExpired: true } }),
      3000,
    );
    return () => clearTimeout(id);
  }, [expired, navigate, orderId]);

  if (
    orderId === '' ||
    (orderQuery.isError && (orderQuery.error as { status?: number }).status === 404)
  ) {
    return (
      <PageShell>
        <ErrorState
          title={T.notFound}
          actions={
            <LinkButton as={Link} to={ROUTES.orderLookup} variant="secondary">
              {T.toLookup}
            </LinkButton>
          }
        />
      </PageShell>
    );
  }
  if (orderQuery.isPending) {
    return (
      <PageShell>
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton height={28} width="60%" />
          <Skeleton height={96} />
          <Skeleton height={56} />
        </div>
        <p role="status" className="sr-only">
          {t.common.loading}
        </p>
      </PageShell>
    );
  }
  if (orderQuery.isError || order === undefined) {
    return (
      <PageShell>
        <ErrorState
          title={T.loadFailed}
          message={t.errors.messageOf(orderQuery.error)}
          onRetry={() => void orderQuery.refetch()}
        />
      </PageShell>
    );
  }

  // 訂單不是待付款（已成功、顧客或店家取消…）：導向訂單頁（07 §8 守衛）
  if ((order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED') || cancelledOther) {
    return <Navigate to={ROUTES.order(orderId)} replace />;
  }

  if (expired) {
    return (
      <PageShell>
        <InlineAlert tone="warning" title={T.expiredTitle} role="alert">
          {T.expiredBody}
        </InlineAlert>
        <div className="mt-4">
          <LinkButton as={Link} to={ROUTES.order(orderId)} state={{ paymentExpired: true }}>
            {T.viewOrder}
          </LinkButton>
        </div>
      </PageShell>
    );
  }

  const latest = order.payment.latest;
  const failed = latest?.status === 'FAILED';
  const attemptPending = latest?.status === 'PENDING';
  const currentMethod: PaymentMethod =
    latest?.method ??
    methodParam ??
    (order.payment.method === 'CASH' ? 'LINE_PAY' : order.payment.method);
  const selected = chosen ?? (currentMethod === 'CASH' ? 'LINE_PAY' : currentMethod);
  const available = (infoQuery.data?.paymentMethods ?? ONLINE_METHODS).filter((m) => m !== 'CASH');
  const methods = available.length > 0 ? available : ONLINE_METHODS;
  const manual = attemptPending && demo !== null && !waitingTimeout && !processing;
  const waiting = attemptPending && !processing && (waitingTimeout || demo === null);
  const showWarning = Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs <= WARNING_MS;

  const settle = async (result: 'SUCCESS' | 'FAILED'): Promise<void> => {
    if (demo === null) return;
    setPayError(null);
    setProcessing(true);
    try {
      const updated: Order = await demo.settlePayment(orderId, result, latest?.method ?? selected);
      queryClient.setQueryData(detailKey, updated);
      if (updated.status !== 'PENDING_PAYMENT') goOrder();
    } catch (e) {
      setPayError(t.errors.messageOf(e, T.payInitFailed));
      void queryClient.invalidateQueries({ queryKey: detailKey });
    } finally {
      if (mountedRef.current) setProcessing(false);
    }
  };

  const switchToCash = async (): Promise<void> => {
    setPayError(null);
    setProcessing(true);
    try {
      const res = await api.orders.pay(orderId, { method: 'CASH' }, opts);
      queryClient.setQueryData(detailKey, res.order);
      goOrder();
    } catch (e) {
      setPayError(t.errors.messageOf(e, T.payInitFailed));
      void queryClient.invalidateQueries({ queryKey: detailKey });
    } finally {
      if (mountedRef.current) setProcessing(false);
    }
  };

  const heldTime =
    order.payment.expiresAt !== null ? formatTime(order.payment.expiresAt) : undefined;

  return (
    <PageShell>
      <p className="mb-3 inline-flex rounded-pill bg-bg-muted px-3 py-1 text-xs leading-4 font-medium text-text-sub">
        {T.demoNote}
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm leading-5">
        <dt className="text-text-sub">{T.method}</dt>
        <dd className="font-semibold text-text">
          {tCheckout.paymentLabel[latest?.method ?? currentMethod]}
        </dd>
        <dt className="text-text-sub">{T.orderNo}</dt>
        <dd className="font-mono text-text">{order.orderNo}</dd>
        <dt className="text-text-sub">{T.amount}</dt>
        <dd className="text-h3 font-bold text-text tabular-nums">
          {formatTWD(order.amounts.total)}
        </dd>
      </dl>

      {heldTime !== undefined ? (
        <p className="mt-4 text-sm leading-5 text-text">{T.held(heldTime)}</p>
      ) : null}
      {Number.isFinite(remainingMs) ? (
        <p className="mt-1 text-sm leading-5 text-text-sub">
          {T.remaining}
          <span className="font-mono text-base font-semibold text-text tabular-nums">
            {formatCountdown(remainingMs)}
          </span>
        </p>
      ) : null}
      {showWarning ? (
        <p role="alert" className="mt-2 text-sm leading-5 font-semibold text-warning">
          {T.warning2Min}
        </p>
      ) : null}

      {navState?.replayed === 'DIFFERENT' ? (
        <InlineAlert tone="info" className="mt-4">
          {tCheckout.replay.differentContent}
        </InlineAlert>
      ) : null}
      {payError !== null ? (
        <InlineAlert tone="error" className="mt-4">
          {payError}
        </InlineAlert>
      ) : null}

      <div className="mt-5" aria-live="polite">
        {processing ? (
          <div className="flex items-center gap-3 text-text-sub">
            <Spinner size="md" label={T.processing} />
            <span>
              <span className="font-semibold text-text">{T.processing}</span>
              <span className="block text-xs leading-4">{T.processingHint}</span>
            </span>
          </div>
        ) : null}

        {waiting ? (
          <div className="flex items-start gap-3 text-text-sub">
            <Hourglass aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <span>
              <span className="font-semibold text-text">{T.waiting}</span>
              <span className="block text-xs leading-4">{T.waitingHint}</span>
            </span>
          </div>
        ) : null}

        {failed && !processing ? (
          <InlineAlert tone="error" title={T.failedTitle} role="alert">
            {latest?.failureMessage ?? T.failedBody}
          </InlineAlert>
        ) : null}
      </div>

      {manual ? (
        <div className="mt-5 flex flex-col gap-3 min-[480px]:flex-row">
          <Button onClick={() => void settle('SUCCESS')}>{T.success}</Button>
          <Button variant="secondary" onClick={() => void settle('FAILED')}>
            {T.fail}
          </Button>
          <Button variant="ghost" onClick={() => goOrder()}>
            {T.cancel}
          </Button>
        </div>
      ) : null}

      {!processing && (failed || attemptPending) ? (
        <div className="mt-6 border-t border-border pt-4">
          <RadioGroup
            name="payMethod"
            legend={T.methodLegend}
            columns={3}
            value={selected}
            onChange={(v) => setChosen(v as PaymentMethod)}
          >
            {methods.map((m) => (
              <RadioCard key={m} value={m} label={tCheckout.paymentLabel[m]} />
            ))}
          </RadioGroup>
          <div className="mt-3 flex flex-col gap-3 min-[480px]:flex-row">
            {failed || selected !== latest?.method ? (
              <Button
                variant={failed ? 'primary' : 'secondary'}
                onClick={() => {
                  setWaitingTimeout(false);
                  void startPayment(selected);
                }}
              >
                {failed ? T.retry : T.payWith(tCheckout.paymentLabel[selected])}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => void switchToCash()}>
              {T.switchToCash}
            </Button>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-6">
      {/* 頁名由外殼的 TaskHeader 顯示（usePageTitle）；h1 視覺隱藏，路由切換後焦點移到此處 */}
      <h1 tabIndex={-1} className="sr-only">
        {T.pageTitle}
      </h1>
      <div className="rounded-lg border border-border bg-bg p-4 shadow-sm kiosk:p-6">
        <h2 className="mb-3 text-h3 font-semibold text-text">{T.gateway}</h2>
        {children}
      </div>
    </div>
  );
}
