// src/features/orders/OrderPage.tsx —— PG-06 訂單追蹤 / 詳情（FR-OD-01～05、08、10、11；FLOW-10、FLOW-12、FLOW-13、FLOW-16）
//
// 存取：會員本人或持有追蹤權杖的訪客（07 §8）；以權杖存取回 404 時由 `useOrderPolling` 換發權杖並重試一次。
// 資料：非終態（或終態但退款進行中）且頁面可見時每 5 秒輪詢；狀態變更時 Toast、通報、`document.title` 前綴與震動。
// 觸控面板（Kiosk）：放大版的完成畫面（取餐號碼超大字、櫃檯付款說明、倒數由 `KioskDoneCountdown` 負責）。
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Maximize2, Phone, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  IconButton,
  InlineAlert,
  LinkButton,
  Skeleton,
  VisuallyHidden,
  buttonClassName,
  useToast,
} from '@/components';
import { formatTime } from '@/domain/format';
import type { Order, OrderStatus } from '@/domain/types';
import { KeyHint, useAnnounce, useHotkeyAction, useHotkeyScope, useKeyShortcuts } from '@/features/a11y';
import { readApiError } from '@/features/auth/errorInfo';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { KioskDoneCountdown } from '@/features/kiosk';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { useStoreInfo } from '@/features/store/queries';
import { useApi } from '@/hooks/useApi';
import { useClockNow } from '@/hooks/useClockNow';
import { errorMessageOf } from '@/i18n/strings/errors';
import { orders as tOrders } from '@/i18n/strings/orders';
import { qk } from '@/services/api/queryKeys';
import { CancelOrderDialog } from './CancelOrderDialog';
import { useGuestOrdersStore } from './guestOrdersStore';
import { invalidateOrderLists } from './invalidate';
import { FulfillmentSection, ItemsSection, PaymentSection, formatScheduledWhen } from './OrderDetailSections';
import { OrderStatusBadge } from './OrderStatusBadge';
import { OrderTimeline } from './OrderTimeline';
import { isPaymentTimeout, spokenPickupNo, statusLabel } from './orderView';
import { SaveOrderPrompt } from './SaveOrderPrompt';
import { useOrderPolling } from './useOrderPolling';
import { useReorder } from './useReorder';

const s = tOrders.tracking;

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** 狀態名稱之後的預計時間：「・預計 12:35 可取餐（約 8 分鐘）」；預約單改由獨立一行固定顯示預約時間 */
function etaSuffix(order: Order, nowMs: number): string | undefined {
  const active = order.status === 'ACCEPTED' || order.status === 'DELIVERING';
  if (!active || order.scheduledAt !== null || order.estimatedReadyAt === null) return undefined;
  const minutes = Math.ceil((Date.parse(order.estimatedReadyAt) - nowMs) / 60_000);
  const approx = minutes > 0 ? s.expectedMinutes(minutes) : s.almostReady;
  return `・${s.expected[order.orderType](formatTime(order.estimatedReadyAt))}（${approx}）`;
}

/** 狀態的副標說明（不含取消者與原因，那由取消區塊處理） */
function hintOf(order: Order): string {
  const { status, orderType, pickupNo } = order;
  if (status === 'READY') {
    const make = s.hint.READY[orderType];
    return typeof make === 'function' ? make(pickupNo) : make;
  }
  return s.hint[status];
}

/** 找不到訂單的畫面：說明並提供「查詢訂單」入口（PG-06） */
function NotFoundView() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-12 text-center">
      <h1 tabIndex={-1} className="text-h2 font-bold text-text">
        {s.notFoundTitle}
      </h1>
      <p className="text-base leading-6 text-text-sub">{s.notFoundBody}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <LinkButton as={Link} to={ROUTES.orderLookup} variant="primary">
          {s.lookupOrder}
        </LinkButton>
        <LinkButton as={Link} to={ROUTES.home} variant="secondary">
          {s.backToMenu}
        </LinkButton>
      </div>
    </div>
  );
}

/** 訪客沒有此訂單的權杖：導向查詢訂單並說明（07 §8） */
function RedirectToLookup() {
  const { toast } = useToast();
  useEffect(() => {
    toast({ message: s.notFoundBody, tone: 'info', id: 'order-not-found' });
  }, [toast]);
  return <Navigate to={ROUTES.orderLookup} replace />;
}

function LoadingView() {
  return (
    <div
      aria-busy="true"
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 md:py-6"
    >
      <h1 className="sr-only" tabIndex={-1}>
        {s.pageTitle}
      </h1>
      <span role="status" className="sr-only">
        {s.loading}
      </span>
      <Card className="flex flex-col gap-3">
        <Skeleton height={16} width={80} />
        <Skeleton height={56} width={160} />
        <Skeleton height={32} width="70%" rounded="full" />
      </Card>
      <Card className="flex flex-col gap-3">
        <Skeleton height={20} width={96} />
        <Skeleton height={28} />
        <Skeleton height={28} />
        <Skeleton height={28} />
      </Card>
    </div>
  );
}

interface OrderViewProps {
  orderId: string;
}

function OrderView({ orderId }: OrderViewProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const announce = useAnnounce();
  const kiosk = useIsKioskUi();
  const isLoggedIn = useSessionStore(selectIsLoggedIn);
  const hasToken = useGuestOrdersStore((st) => st.orders.some((o) => o.orderId === orderId));
  const { order, isLoading, notFound, error, polling, refresh } = useOrderPolling(orderId);
  const store = useStoreInfo();
  const { reorder, pendingOrderId, dialog: reorderDialog } = useReorder();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [enlargeOpen, setEnlargeOpen] = useState(false);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const lastStatus = useRef<OrderStatus | null>(null);
  const announcedTwoMinutes = useRef(false);

  // 任務型版面的頂部列頁名、document.title 與路由播報（取餐號碼載入後附上）
  usePageTitle(
    order !== undefined
      ? `${s.pageTitle}・${order.pickupNo}`
      : notFound
        ? s.notFoundTitle
        : s.pageTitle,
  );

  const canReorder = order?.permissions.canReorder === true;
  const again = (): void => {
    if (order !== undefined && canReorder) void reorder(order);
  };

  // 快速鍵（預設關閉；啟用後 a / u）
  useHotkeyScope('order');
  useHotkeyAction('refresh', () => void refresh());
  useHotkeyAction('again', again, { enabled: canReorder });
  const againShortcut = useKeyShortcuts('again');
  const refreshShortcut = useKeyShortcuts('refresh');

  // 倒數與預計時間：待付款每秒更新，其餘每 30 秒（「約 n 分鐘」）
  const now = useClockNow(order?.status === 'PENDING_PAYMENT' ? 1000 : 30_000);
  const nowMs = now.getTime();
  const expiresAtMs =
    order?.status === 'PENDING_PAYMENT' && order.payment.expiresAt !== null
      ? Date.parse(order.payment.expiresAt)
      : null;
  const remainingSeconds =
    expiresAtMs === null ? null : Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));

  // 付款剩 2 分鐘時通報一次（WCAG 2.2.1；03 §10.6 #17）
  useEffect(() => {
    if (remainingSeconds === null || announcedTwoMinutes.current) return;
    if (remainingSeconds > 0 && remainingSeconds <= 120) {
      announcedTwoMinutes.current = true;
      announce(s.payTwoMinutes);
    }
  }, [remainingSeconds, announce]);

  // 首次載入完成：焦點移到取餐號碼標題（送出訂單成功 → 狀態標題；觸控面板完成畫面朗讀號碼）
  const loadedId = order?.id ?? null;
  useEffect(() => {
    if (loadedId === null) return;
    const active = document.activeElement;
    if (active === null || active === document.body) h1Ref.current?.focus({ preventScroll: true });
  }, [loadedId]);

  // 狀態變更提醒（FR-OD-10）：Toast、通報（可取餐時 assertive）、震動
  useEffect(() => {
    if (order === undefined) return;
    const previous = lastStatus.current;
    lastStatus.current = order.status;
    if (previous === null || previous === order.status) return;
    const label = statusLabel(order.status, order.orderType);
    toast({
      message: s.statusChanged(label),
      tone: order.status === 'CANCELLED' ? 'warning' : 'info',
      id: 'order-status',
    });
    announce(
      s.statusChangedAnnounce(label, order.pickupNo),
      order.status === 'READY' ? 'assertive' : 'polite',
    );
    if (order.status === 'READY' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(200);
    }
  }, [order, toast, announce]);

  // 分頁標題提示：可取餐時加上前綴，離開頁面還原
  const titlePrefix =
    order?.status === 'READY' && order.orderType !== 'DELIVERY'
      ? `（${statusLabel('READY', order.orderType)}）`
      : null;
  useEffect(() => {
    if (titlePrefix === null) return;
    const original = document.title;
    document.title = `${titlePrefix}${original}`;
    return () => {
      document.title = original;
    };
  }, [titlePrefix]);

  const cancelMutation = useMutation({
    mutationFn: async (reason: string | undefined): Promise<Order> => {
      const token = useGuestOrdersStore.getState().tokenFor(orderId);
      return api.orders.cancel(orderId, reason, token !== null ? { trackingToken: token } : undefined);
    },
    onSuccess: (updated) => {
      // 自己造成的狀態變更由這裡提示，不再重複觸發「狀態變更」提醒
      lastStatus.current = updated.status;
      queryClient.setQueryData(qk.orders.detail(orderId), updated);
      invalidateOrderLists(queryClient);
      const refunding = updated.payment.status === 'REFUNDING';
      toast({ message: refunding ? s.cancelledRefund : s.cancelled, tone: 'success' });
      announce(refunding ? s.cancelledRefund : s.cancelled);
    },
    onError: (e) => {
      const { code } = readApiError(e);
      if (code === 'ORDER_STATE_CONFLICT') {
        toast({ message: s.cancelConflict, tone: 'warning' });
        void refresh();
      } else {
        toast({ message: errorMessageOf(e, s.cancelFailed), tone: 'error' });
      }
    },
  });

  const copyOrderNo = async (): Promise<void> => {
    if (order === undefined) return;
    try {
      await navigator.clipboard.writeText(order.orderNo);
      toast({ message: s.copied, tone: 'success' });
    } catch {
      toast({ message: s.copyFailed, tone: 'warning' });
    }
  };

  const refreshNow = async (): Promise<void> => {
    await refresh();
    announce(s.refreshed);
  };

  // ───────── 狀態分流 ─────────
  // 觸控面板沒有「查詢訂單」入口：閒置重置會先清掉本機訂單記錄，這裡必須回到首頁，
  // 否則重新渲染的重導向會蓋過重置的導覽，落在被隱藏的查詢訂單頁（FLOW-21）
  if (!isLoggedIn && !hasToken) {
    return kiosk ? <Navigate to={ROUTES.home} replace /> : <RedirectToLookup />;
  }
  if (isLoading) return <LoadingView />;
  if (notFound) return <NotFoundView />;
  if (order === undefined) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <ErrorState
          title={s.loadFailedTitle}
          message={errorMessageOf(error)}
          requestId={readApiError(error).requestId}
          onRetry={() => void refresh()}
          actions={
            <LinkButton as={Link} to={ROUTES.home} variant="ghost">
              {s.backToMenu}
            </LinkButton>
          }
        />
      </div>
    );
  }

  const spoken = spokenPickupNo(order.pickupNo);
  const storePhone = store.data?.phone;

  // ───────── 觸控面板：完成畫面 ─────────
  if (kiosk) {
    const awaitingCounter = order.status === 'PENDING' || order.status === 'PENDING_PAYMENT';
    return (
      <div className="mx-auto flex min-h-[60dvh] w-full max-w-3xl flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <p aria-hidden="true" className="text-h2 font-semibold text-text-sub">
          {tOrders.pickupNo}
        </p>
        <h1
          ref={h1Ref}
          tabIndex={-1}
          className="rounded-xl bg-brand-soft px-12 py-6 text-[6rem] leading-none font-bold tracking-widest text-text tabular-nums"
        >
          <span aria-hidden="true">{order.pickupNo}</span>
          <VisuallyHidden>{spoken}</VisuallyHidden>
        </h1>
        <p className="text-h1 font-bold text-text">
          {awaitingCounter ? s.kiosk.payAtCounter : hintOf(order)}
        </p>
        <OrderStatusBadge status={order.status} orderType={order.orderType} size="lg" />
        <KioskDoneCountdown active />
      </div>
    );
  }

  // ───────── 一般模式 ─────────
  const { permissions } = order;
  const paymentExpired = order.status === 'PENDING_PAYMENT' && !permissions.canPay;
  const paymentFailed =
    order.status === 'PENDING_PAYMENT' && order.payment.latest?.status === 'FAILED';
  const cancelledByTimeout = isPaymentTimeout(order);
  const refundText =
    order.payment.status === 'REFUNDING'
      ? s.refunding
      : order.payment.status === 'REFUNDED'
        ? s.refunded
        : null;
  const showScheduled =
    order.scheduledAt !== null &&
    (order.status === 'PENDING_PAYMENT' || order.status === 'PENDING' || order.status === 'ACCEPTED');
  const payUntil =
    order.payment.expiresAt !== null ? formatTime(order.payment.expiresAt) : null;

  return (
    <div
      data-polling={polling ? 'true' : 'false'}
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 md:py-6"
    >
      {/* 狀態卡 */}
      <Card as="section" aria-labelledby="order-pickup-no" className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p aria-hidden="true" className="text-sm leading-5 font-medium text-text-sub">
              {tOrders.pickupNo}
            </p>
            <h1
              id="order-pickup-no"
              ref={h1Ref}
              tabIndex={-1}
              className="text-[3.5rem] leading-[1.1] font-bold tracking-wide text-text tabular-nums"
            >
              <span aria-hidden="true">{order.pickupNo}</span>
              <VisuallyHidden>{spoken}</VisuallyHidden>
            </h1>
          </div>
          <IconButton
            label={s.enlargeLabel(order.pickupNo)}
            icon={<Maximize2 />}
            variant="soft"
            onClick={() => setEnlargeOpen(true)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <OrderStatusBadge
            status={order.status}
            orderType={order.orderType}
            size="lg"
            suffix={etaSuffix(order, nowMs)}
          />
          <Button
            variant="ghost"
            aria-keyshortcuts={refreshShortcut}
            leadingIcon={<RefreshCw aria-hidden="true" className="size-4" />}
            loadingLabel={s.refreshing}
            onClick={() => refreshNow()}
          >
            <KeyHint action="refresh">{s.refresh}</KeyHint>
          </Button>
        </div>

        <div className="flex flex-col gap-1 text-sm leading-5 text-text-sub">
          {showScheduled && order.scheduledAt !== null ? (
            <p className="font-semibold text-text">
              {s.scheduled[order.orderType](formatScheduledWhen(order.scheduledAt))}
            </p>
          ) : null}
          {order.status === 'PENDING' && order.acceptBy != null ? (
            <p className="font-semibold text-text">{s.acceptBy(formatTime(order.acceptBy))}</p>
          ) : null}
          {order.status === 'CANCELLED' && cancelledByTimeout ? (
            <p className="text-text">{s.paymentExpired}</p>
          ) : (
            <p>{hintOf(order)}</p>
          )}
          {order.status === 'CANCELLED' && !cancelledByTimeout && order.cancellation !== undefined ? (
            <p>
              {s.cancelledBy[order.cancellation.by]}
              {order.cancellation.reason !== undefined && order.cancellation.reason !== ''
                ? `・${s.cancelReason(order.cancellation.reason)}`
                : null}
            </p>
          ) : null}
          {refundText !== null ? <p className="font-semibold text-text">{refundText}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 border-t border-border pt-3 text-sm leading-5">
          <span className="text-text-sub">{tOrders.orderNo}</span>
          <span className="font-mono font-semibold text-text [overflow-wrap:anywhere]">
            {order.orderNo}
          </span>
          <Button
            variant="ghost"
            aria-label={s.copyLabel(order.orderNo)}
            leadingIcon={<Copy aria-hidden="true" className="size-4" />}
            onClick={() => copyOrderNo()}
          >
            {s.copy}
          </Button>
        </div>
      </Card>

      {/* 付款提醒（待付款才顯示） */}
      {order.status === 'PENDING_PAYMENT' && permissions.canPay && payUntil !== null ? (
        <InlineAlert
          tone="warning"
          title={s.payReminder(payUntil)}
          action={
            <LinkButton as={Link} to={ROUTES.payment(order.id)} variant="primary">
              {s.payNow}
            </LinkButton>
          }
        >
          {remainingSeconds !== null ? (
            <p role="timer" className="tabular-nums">
              {s.payCountdown(formatCountdown(remainingSeconds))}
            </p>
          ) : null}
          {paymentFailed ? <p>{s.paymentFailed}</p> : null}
        </InlineAlert>
      ) : null}
      {paymentExpired ? (
        <InlineAlert tone="info" role="status">
          {s.paymentExpired}
        </InlineAlert>
      ) : null}

      {error !== null ? (
        <InlineAlert tone="warning" role="none">
          {s.staleWarning}
        </InlineAlert>
      ) : null}

      {/* 訂單進度 */}
      <Card as="section" aria-labelledby="order-progress-title">
        <h2 id="order-progress-title" className="mb-4 text-h3 font-bold text-text">
          {s.sectionProgress}
        </h2>
        <OrderTimeline
          order={order}
          paymentCountdown={
            remainingSeconds !== null ? (
              <span className="tabular-nums">{s.payCountdown(formatCountdown(remainingSeconds))}</span>
            ) : undefined
          }
        />
      </Card>

      <FulfillmentSection order={order} store={store.data} />
      <ItemsSection order={order} />
      <PaymentSection order={order} />

      {/* 動作 */}
      <div className="flex flex-wrap items-center gap-3">
        {permissions.canCancel ? (
          <Button variant="secondary" onClick={() => setCancelOpen(true)}>
            {s.cancelOrder}
          </Button>
        ) : null}
        {storePhone !== undefined ? (
          <a
            href={`tel:${storePhone.replace(/[^\d+]/g, '')}`}
            aria-label={s.callStoreLabel(storePhone)}
            className={buttonClassName({ variant: 'secondary' })}
          >
            <Phone aria-hidden="true" className="size-4" />
            {s.callStore}
          </a>
        ) : null}
        {permissions.canReorder ? (
          <Button
            variant="primary"
            aria-keyshortcuts={againShortcut}
            leadingIcon={<RotateCcw aria-hidden="true" className="size-4" />}
            loading={pendingOrderId === order.id}
            loadingLabel={s.reordering}
            onClick={() => void reorder(order)}
          >
            <KeyHint action="again">{s.reorder}</KeyHint>
          </Button>
        ) : null}
      </div>

      {!isLoggedIn ? <SaveOrderPrompt orderId={order.id} /> : null}

      {permissions.canCancel ? (
        <CancelOrderDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          paid={order.payment.status === 'PAID'}
          onConfirm={async (reason) => {
            try {
              await cancelMutation.mutateAsync(reason);
            } catch {
              // 錯誤已由 onError 提示
            }
          }}
        />
      ) : null}

      <Dialog
        open={enlargeOpen}
        onOpenChange={setEnlargeOpen}
        size="lg"
        title={s.enlargedTitle}
        description={s.enlargedHint}
      >
        <p className="py-6 text-center text-[clamp(4rem,22vw,9rem)] leading-none font-bold tracking-widest text-text tabular-nums">
          <span aria-hidden="true">{order.pickupNo}</span>
          <VisuallyHidden>{spoken}</VisuallyHidden>
        </p>
      </Dialog>

      {reorderDialog}
    </div>
  );
}

export function OrderPage() {
  const { orderId = '' } = useParams();
  // 以 orderId 為 key：切換訂單時重置狀態變更偵測與倒數通報
  return <OrderView key={orderId} orderId={orderId} />;
}
