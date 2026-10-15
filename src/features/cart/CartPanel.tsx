// src/features/cart/CartPanel.tsx —— 桌機（≥ 1024）右側常駐「我的訂單」面板（CMP-31 `OrderPanel`）
//
// 標題（我的訂單 + 取餐方式）、品項列（縮圖可無；恆有「編輯」「移除」）、費用摘要、主要 CTA、小字「不需登入即可結帳」。
// 異動時依 CMP-17 標示並提供就地動作，「前往結帳」維持可用；阻擋與清單由結帳頁負責。
import clsx from 'clsx';
import { ShoppingCart } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ROUTES } from '@/app/routes';
import { ConfirmDialog, EmptyState, buttonClassName } from '@/components';
import type { CartLine } from '@/domain/cart';
import { formatTWD } from '@/domain/format';
import { KeyHint, useHotkeyScope, useKeyShortcuts } from '@/features/a11y';
import { useQrTable } from '@/features/checkout/useQrTable';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { t } from '@/i18n/zh-TW';
import { useProductSheetNav } from '@/features/menu/productSheetNav';
import { CartLineRow } from './CartLineRow';
import { CartSummary } from './CartSummary';
import { cartSubtotal } from './cartMath';
import { useCartStore } from './cartStore';
import { orderTypeLabel } from './OrderTypeSwitch';
import { useCartHotkeys } from './useCartHotkeys';
import { useCartLineActions } from './useCartLineActions';
import { useCartPreview } from './useCartPreview';

/** 跳過連結「跳到我的訂單」與 `c`（桌機）的目標（與設計原型一致） */
export const ORDER_PANEL_ID = 'orderpanel';

/**
 * `c`（桌機）：把焦點移到訂單面板——第一個品項行，沒有品項時為「前往結帳」或面板本身。
 * 回傳是否找到面板（找不到時，呼叫端改走購物車頁）。
 */
export function focusOrderPanel(): boolean {
  const panel = document.getElementById(ORDER_PANEL_ID);
  if (panel === null) return false;
  const target =
    panel.querySelector<HTMLElement>('[data-line-id]') ??
    panel.querySelector<HTMLElement>('a[href], button:not([aria-disabled="true"])') ??
    panel;
  target.focus();
  return true;
}

export interface CartPanelProps {
  /** 商品面板開啟時背景快速鍵失效 */
  hotkeysEnabled?: boolean | undefined;
  className?: string | undefined;
}

export function CartPanel({ hotkeysEnabled = true, className }: CartPanelProps) {
  const navigate = useNavigate();
  const nav = useProductSheetNav();
  const kiosk = useIsKioskUi();
  const qrTable = useQrTable();
  const checkoutKeys = useKeyShortcuts('checkout');
  const preview = useCartPreview();
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const [pendingRemove, setPendingRemove] = useState<CartLine | null>(null);
  const actions = useCartLineActions(listRef, pendingRemove !== null);
  const lines = preview.lines;
  const empty = lines.length === 0;
  const showThumb = lines.some((l) => !!l.snapshot.imageUrl);
  const subtotal = empty ? 0 : preview.subtotal;
  const snapshotTotal = cartSubtotal(lines);

  useHotkeyScope('cart');
  useCartHotkeys({
    rootRef,
    enabled: hotkeysEnabled,
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

  return (
    // 外層撐滿整列高度（左側分隔線貫穿菜單）；內層 sticky，貼在頂部列下方，內容過長時品項區自行捲動
    <div className={clsx('w-(--panel-w) flex-none self-stretch border-l border-border', className)}>
      <aside
        ref={rootRef}
        id={ORDER_PANEL_ID}
        tabIndex={-1}
        aria-label={t.cart.panel.title}
        className="sticky top-(--topbar-h) flex max-h-[calc(100dvh-var(--topbar-h))] min-h-[min(32rem,calc(100dvh-var(--topbar-h)))] flex-col bg-bg"
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h2 className="text-h2 font-bold">
            <KeyHint action="openCart">{t.cart.panel.title}</KeyHint>
          </h2>
          <span className="inline-flex h-7 items-center rounded-pill border border-brand bg-brand-soft px-3 text-xs leading-4 font-semibold text-brand-text">
            {qrTable.locked && qrTable.tableNo !== null
              ? t.cart.panel.dineInTable(qrTable.tableNo)
              : orderTypeLabel(preview.orderType, kiosk)}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {empty ? (
            <EmptyState
              icon={<ShoppingCart />}
              title={t.cart.empty.title}
              description={t.cart.panel.emptyHint}
              className="py-8"
            />
          ) : (
            <ul ref={listRef}>
              {lines.map((line) => {
                const max = maxFor(line);
                const remaining = preview.remainingOf(line.productId);
                return (
                  <CartLineRow
                    key={line.lineId}
                    line={line}
                    variant="panel"
                    showThumb={showThumb}
                    status={preview.availability.byLineId.get(line.lineId)}
                    maxQuantity={max}
                    maxReason={
                      typeof remaining === 'number' && max < 20
                        ? t.common.maxReachedToday(remaining)
                        : t.common.maxQuantityReached(20)
                    }
                    adjustedTo={actions.adjusted[line.lineId]?.to}
                    onRemove={actions.removeNow}
                    onEdit={(l) => nav.openEdit(l.lineId)}
                    onFit={actions.fit}
                    onUndoAdjust={actions.undoAdjust}
                  />
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border bg-bg px-5 pt-4 pb-5">
          {preview.failed ? (
            <p className="mb-3 text-xs leading-4 text-text-muted">{t.cart.precheckFailed}</p>
          ) : null}
          <CartSummary
            className="mb-4"
            subtotal={subtotal}
            orderType={preview.orderType}
            shortfall={preview.shortfall}
            loading={preview.checking}
          />
          {empty ? (
            <button
              type="button"
              aria-disabled="true"
              className={buttonClassName({ size: 'lg', fullWidth: true, inactive: true })}
            >
              {t.cart.checkout}
            </button>
          ) : (
            <Link
              to={ROUTES.checkout}
              aria-keyshortcuts={checkoutKeys}
              className={buttonClassName({ variant: 'primary', size: 'lg', fullWidth: true })}
            >
              <KeyHint action="checkout">
                {t.cart.checkoutWithTotal(formatTWD(preview.checking ? snapshotTotal : subtotal))}
              </KeyHint>
            </Link>
          )}
          {kiosk ? null : (
            <p className="mt-2 text-center text-sm leading-5 text-text-muted">
              {t.cart.noLoginNote}
            </p>
          )}
        </div>

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
      </aside>
    </div>
  );
}
