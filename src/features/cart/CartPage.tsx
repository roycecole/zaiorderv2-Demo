// src/features/cart/CartPage.tsx —— PG-03 購物車
//
// 進入時 `purgeIfExpired()`（24 小時過期，FR-CT-04）並背景預檢（quote）：逐行標示可購買狀態並提供就地動作，
// 「前往結帳」始終可用——阻擋與異動清單由結帳頁負責（FLOW-23）。桌機（≥ 1024）改用首頁右側的訂單面板（§8 路由守衛）。
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineAlert,
  LinkButton,
  buttonClassName,
  iconButtonClassName,
  useToast,
} from '@/components';
import { MAX_QTY_PER_LINE } from '@/domain/cart';
import type { CartLine } from '@/domain/cart';
import { formatTWD } from '@/domain/format';
import { KeyHint, useAnnounce, useHotkeyScope, useKeyShortcuts } from '@/features/a11y';
import { QrTableStrip } from '@/features/checkout/QrTableStrip';
import { useLockOrderTypeToQrTable } from '@/features/checkout/useQrTable';
import {
  LazyProductSheet,
  usePreloadProductSheetOnIntent,
} from '@/features/menu/LazyProductSheet';
import { EDIT_PARAM, PRODUCT_PARAM, useProductSheetNav } from '@/features/menu/productSheetNav';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { t } from '@/i18n/zh-TW';
import { CartLineRow } from './CartLineRow';
import { CartSummary } from './CartSummary';
import { cartSubtotal } from './cartMath';
import { useCartStore } from './cartStore';
import { OrderTypeSwitch } from './OrderTypeSwitch';
import { useCartHotkeys } from './useCartHotkeys';
import { useCartLineActions } from './useCartLineActions';
import { useCartPreview } from './useCartPreview';

/**
 * ≥ 1024 導向首頁並由右側訂單面板呈現（保留網址參數，例如 `?edit=`）；其餘斷點為獨立頁。
 */
export function CartPage() {
  const breakpoint = useBreakpoint();
  const location = useLocation();
  if (breakpoint === 'lg') {
    return <Navigate to={{ pathname: ROUTES.home, search: location.search }} replace />;
  }
  return <CartPageContent />;
}

function CartPageContent() {
  const navigate = useNavigate();
  const nav = useProductSheetNav();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const announce = useAnnounce();
  const checkoutKeys = useKeyShortcuts('checkout');
  const sheetOpen = params.has(EDIT_PARAM) || params.has(PRODUCT_PARAM);
  usePageTitle(t.cart.page.documentTitle);
  // QR 桌號有效時取餐方式固定為內用（03 PG-01、FR-CK-05）
  useLockOrderTypeToQrTable();

  const preview = useCartPreview();
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  usePreloadProductSheetOnIntent(rootRef);
  const [pendingRemove, setPendingRemove] = useState<CartLine | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const actions = useCartLineActions(listRef, pendingRemove !== null || confirmClear);

  const lines = preview.lines;
  const empty = lines.length === 0;
  const showThumb = lines.some((l) => !!l.snapshot.imageUrl);

  // 進入頁面時：超過 24 小時未更新的購物車視為過期並清空（FR-CT-04）
  useEffect(() => {
    const store = useCartStore.getState();
    if (store.lines.length === 0) return;
    store.purgeIfExpired();
    if (useCartStore.getState().lines.length === 0) {
      toast({ message: t.cart.expiredToast, tone: 'info' });
      announce(t.cart.expiredToast);
    }
  }, [toast, announce]);

  useHotkeyScope('cart');
  useCartHotkeys({
    rootRef,
    enabled: !sheetOpen,
    actions,
    remainingOf: preview.remainingOf,
    onEdit: (line) => nav.openEdit(line.lineId),
    onRequestRemove: setPendingRemove,
    onCheckout: () => {
      if (!empty) void navigate(ROUTES.checkout);
    },
  });

  const maxFor = (line: CartLine): number =>
    useCartStore
      .getState()
      .maxAddableFor(line.productId, preview.remainingOf(line.productId), line.lineId);

  const priceChanges = lines.flatMap((line) => {
    const price = preview.availability.byLineId.get(line.lineId)?.price;
    return price === undefined ? [] : [{ line, ...price }];
  });
  const storeIssue = preview.availability.storeIssue;
  const subtotal = preview.subtotal;
  const allUnavailable = !empty && preview.availability.problemCount === lines.length;

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-[560px] px-4 pb-6">
      <header className="flex items-center gap-1 py-2">
        <Link
          to={ROUTES.home}
          aria-label={t.cart.page.backToMenu}
          className={iconButtonClassName({ className: '-ml-3' })}
        >
          <ArrowLeft aria-hidden="true" className="size-(--icon-size)" />
        </Link>
        <h1 tabIndex={-1} className="min-w-0 flex-1 text-h2 font-bold">
          {t.cart.page.title(lines.length)}
        </h1>
        {empty ? null : (
          <Button variant="ghost" onClick={() => setConfirmClear(true)}>
            {t.cart.page.clear}
          </Button>
        )}
      </header>

      {empty ? (
        <EmptyState
          icon={<ShoppingCart />}
          title={t.cart.empty.title}
          description={t.cart.empty.description}
          action={
            <LinkButton as={Link} to={ROUTES.home} data-cart-empty-focus="">
              {t.common.backToMenu}
            </LinkButton>
          }
        />
      ) : (
        <>
          <section aria-label={t.cart.orderType.legend} className="mb-2">
            <OrderTypeSwitch />
          </section>

          <QrTableStrip variant="cart" className="mt-3" />

          {storeIssue !== null ? (
            <InlineAlert tone="warning" className="mt-3">
              {storeIssue === 'STORE_PAUSED'
                ? t.errors.byCode.STORE_PAUSED
                : t.errors.byCode.STORE_CLOSED}
            </InlineAlert>
          ) : null}

          {priceChanges.length > 0 ? (
            <InlineAlert tone="warning" title={t.cart.page.priceUpdated} className="mt-3">
              <ul>
                {priceChanges.map(({ line, from, to }) => (
                  <li key={line.lineId}>
                    {t.cart.line.priceUpdatedItem(
                      line.snapshot.name,
                      formatTWD(from),
                      formatTWD(to),
                    )}
                  </li>
                ))}
              </ul>
            </InlineAlert>
          ) : null}

          {allUnavailable ? (
            <InlineAlert tone="warning" className="mt-3">
              {t.cart.page.allUnavailable}
            </InlineAlert>
          ) : null}

          <ul ref={listRef} className="mt-2" aria-label={t.cart.page.listLabel}>
            {lines.map((line) => {
              const max = maxFor(line);
              const remaining = preview.remainingOf(line.productId);
              return (
                <CartLineRow
                  key={line.lineId}
                  line={line}
                  variant="page"
                  showThumb={showThumb}
                  status={preview.availability.byLineId.get(line.lineId)}
                  maxQuantity={max}
                  maxReason={
                    typeof remaining === 'number' && max < MAX_QTY_PER_LINE
                      ? t.common.maxReachedToday(remaining)
                      : t.common.maxQuantityReached(MAX_QTY_PER_LINE)
                  }
                  adjustedTo={actions.adjusted[line.lineId]?.to}
                  onQuantityChange={actions.changeQuantity}
                  onRequestRemove={setPendingRemove}
                  onRemove={actions.removeNow}
                  onEdit={(l) => nav.openEdit(l.lineId)}
                  onFit={actions.fit}
                  onUndoAdjust={actions.undoAdjust}
                />
              );
            })}
          </ul>

          {preview.failed ? (
            <p className="mt-3 text-sm leading-5 text-text-muted">{t.cart.precheckFailed}</p>
          ) : null}

          <CartSummary
            className="mt-4"
            subtotal={subtotal}
            orderType={preview.orderType}
            shortfall={preview.shortfall}
            loading={preview.checking}
          />
          <p className="mt-3 text-xs leading-4 text-text-muted">{t.cart.page.expiryNote}</p>

          <div className="sticky bottom-[calc(var(--bottom-tab-h,0px)+env(safe-area-inset-bottom,0px))] -mx-4 mt-4 border-t border-border bg-bg px-4 pt-3 pb-3">
            <Link
              to={ROUTES.checkout}
              aria-keyshortcuts={checkoutKeys}
              className={buttonClassName({ variant: 'primary', size: 'lg', fullWidth: true })}
            >
              <KeyHint action="checkout">
                {t.cart.checkoutWithTotal(
                  formatTWD(preview.checking ? cartSubtotal(lines) : subtotal),
                )}
              </KeyHint>
            </Link>
            <p className="mt-2 text-center text-sm leading-5 text-text-muted">
              {t.cart.noLoginNote}
            </p>
          </div>
        </>
      )}

      <LazyProductSheet />

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRemove(null);
        }}
        tone="danger"
        title={t.cart.confirmRemove.title}
        description={pendingRemove?.snapshot.name}
        confirmLabel={t.common.remove}
        onConfirm={() => {
          if (pendingRemove !== null) actions.removeNow(pendingRemove);
          setPendingRemove(null);
        }}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        tone="danger"
        title={t.cart.confirmClear.title}
        description={t.cart.confirmClear.description(lines.length)}
        confirmLabel={t.cart.confirmClear.confirm}
        onConfirm={() => actions.clearAll()}
      />
    </div>
  );
}
