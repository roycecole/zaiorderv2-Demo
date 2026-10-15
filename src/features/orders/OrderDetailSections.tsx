// src/features/orders/OrderDetailSections.tsx —— 訂單頁的資訊區塊（PG-06）：取餐 / 外送資訊、訂單明細（可收合）、付款與發票
import { ChevronDown, Clock, MapPin, Phone, Store as StoreIcon, Truck, Utensils } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Card, Divider, Price } from '@/components';
import { formatDate, formatDateTime, formatPhone, formatTime, formatTWD } from '@/domain/format';
import type { InvoiceStatus, Order, StoreInfo } from '@/domain/types';
import { t } from '@/i18n/zh-TW';
import { orders as tOrders } from '@/i18n/strings/orders';
import { getClock } from '@/services/clock';

const s = tOrders.tracking;

function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-base leading-6 text-text">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted [&>svg]:size-5">
        {icon}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </li>
  );
}

/** 預約時間：今天只顯示 HH:mm，其他日期含月日 */
export function formatScheduledWhen(iso: string): string {
  const today = formatDate(getClock().now());
  return formatDate(iso) === today ? formatTime(iso) : formatDateTime(iso);
}

// ───────── 取餐資訊 / 外送資訊 / 內用資訊 ─────────

export function FulfillmentSection({ order, store }: { order: Order; store: StoreInfo | undefined }) {
  const headingId = useId();
  const { orderType } = order;
  const title =
    orderType === 'DELIVERY' ? s.sectionDelivery : orderType === 'DINE_IN' ? s.sectionDineIn : s.sectionPickup;
  const address =
    store !== undefined
      ? `${store.address.city}${store.address.district}${store.address.line}`
      : null;
  const contactName = order.customer?.name;
  const contactPhone = order.customer?.phone;

  return (
    <Card as="section" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-h3 font-bold text-text">
        {title}
      </h2>
      <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
        {orderType === 'DELIVERY' ? (
          <>
            <InfoRow icon={<Truck />}>
              <span className="font-semibold">{tOrders.orderType.DELIVERY}</span>
              {order.scheduledAt !== null ? (
                <>
                  {'・'}
                  {s.scheduled.DELIVERY(formatScheduledWhen(order.scheduledAt))}
                </>
              ) : (
                <>
                  {'・'}
                  {s.asap}
                </>
              )}
            </InfoRow>
            {order.delivery !== undefined ? (
              <InfoRow icon={<MapPin />}>
                {order.delivery.city}
                {order.delivery.district}
                {order.delivery.line}
                {order.delivery.note !== undefined && order.delivery.note !== '' ? (
                  <span className="block text-sm leading-5 text-text-sub">
                    {s.deliveryNote(order.delivery.note)}
                  </span>
                ) : null}
              </InfoRow>
            ) : null}
            {contactName !== undefined || contactPhone !== undefined ? (
              <InfoRow icon={<Phone />}>
                {[contactName, contactPhone !== undefined ? formatPhone(contactPhone) : undefined]
                  .filter((x): x is string => x !== undefined && x !== '')
                  .join('・')}
              </InfoRow>
            ) : null}
          </>
        ) : (
          <>
            <InfoRow icon={orderType === 'DINE_IN' ? <Utensils /> : <StoreIcon />}>
              <span className="font-semibold">
                {orderType === 'DINE_IN'
                  ? store !== undefined
                    ? s.dineInAt(store.name)
                    : tOrders.orderType.DINE_IN
                  : store !== undefined
                    ? s.pickupAt(store.name)
                    : tOrders.orderType.PICKUP}
              </span>
              {orderType === 'DINE_IN' && order.table !== undefined ? (
                <>
                  {'・'}
                  {s.tableNo(order.table.tableNo)}
                </>
              ) : null}
            </InfoRow>
            {orderType === 'PICKUP' ? (
              <InfoRow icon={<Clock />}>
                {order.scheduledAt !== null
                  ? s.scheduled.PICKUP(formatScheduledWhen(order.scheduledAt))
                  : s.asap}
              </InfoRow>
            ) : null}
            {address !== null ? <InfoRow icon={<MapPin />}>{address}</InfoRow> : null}
          </>
        )}
        {store !== undefined ? (
          <InfoRow icon={<Phone />}>
            <span className="text-text-sub">{s.storePhone}</span>
            {'　'}
            {store.phone}
          </InfoRow>
        ) : null}
      </ul>
    </Card>
  );
}

// ───────── 訂單明細（可收合） ─────────

function AmountRow({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? 'flex items-baseline justify-between gap-3 text-base leading-6 font-bold text-text'
          : 'flex items-baseline justify-between gap-3 text-sm leading-5 text-text-sub'
      }
    >
      <dt>{label}</dt>
      <dd className="m-0 tabular-nums">{children}</dd>
    </div>
  );
}

export function ItemsSection({ order, defaultOpen = false }: { order: Order; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const headingId = useId();
  const panelId = useId();
  const count = order.items.reduce((sum, i) => sum + i.quantity, 0);
  const { amounts } = order;

  return (
    <Card as="section" aria-labelledby={headingId} padding="none">
      <h2 id={headingId} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-(--hit-size) w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left"
        >
          <span className="text-h3 font-bold text-text">{s.sectionItems}</span>
          <span className="flex items-center gap-2 text-base leading-6 text-text-sub tabular-nums">
            {s.itemsSummary(count, formatTWD(amounts.total))}
            <ChevronDown
              aria-hidden="true"
              className={`size-5 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            />
          </span>
          <span className="sr-only">{open ? s.collapse : s.expand}</span>
        </button>
      </h2>
      {open ? (
        <div id={panelId} className="border-t border-border px-4 py-4">
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base leading-6 font-semibold text-text [overflow-wrap:anywhere]">
                    {item.name}
                    <span className="ml-2 font-normal text-text-sub">{s.itemQuantity(item.quantity)}</span>
                  </p>
                  {item.options.length > 0 ? (
                    <p className="text-sm leading-5 text-text-sub">
                      {item.options.map((o) => o.name).join('・')}
                    </p>
                  ) : null}
                  {item.note !== undefined && item.note !== '' ? (
                    <p className="text-sm leading-5 text-text-sub [overflow-wrap:anywhere]">
                      {s.itemNote(item.note)}
                    </p>
                  ) : null}
                </div>
                <Price amount={item.lineTotal} size="md" className="shrink-0" />
              </li>
            ))}
          </ul>
          <Divider className="my-4" />
          <dl className="m-0 flex flex-col gap-1.5">
            <AmountRow label={s.subtotal}>{formatTWD(amounts.subtotal)}</AmountRow>
            <AmountRow label={s.deliveryFee}>
              {order.orderType !== 'DELIVERY'
                ? t.common.noValue
                : amounts.deliveryFee === 0
                  ? s.free
                  : formatTWD(amounts.deliveryFee)}
            </AmountRow>
            {amounts.discount > 0 ? (
              <AmountRow
                label={order.couponCode !== undefined ? s.discountWithCode(order.couponCode) : s.discount}
              >
                <span className="text-success">{formatTWD(-amounts.discount)}</span>
              </AmountRow>
            ) : null}
            <AmountRow label={s.total} emphasis>
              {formatTWD(amounts.total)}
            </AmountRow>
          </dl>
          <p className="mt-3 text-sm leading-5 text-text-sub">
            {order.needUtensils ? s.utensils.yes : s.utensils.no}
          </p>
          {order.note !== undefined && order.note !== '' ? (
            <p className="mt-1 text-sm leading-5 text-text-sub [overflow-wrap:anywhere]">
              {s.orderNote(order.note)}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

// ───────── 付款與發票 ─────────

function invoiceDetail(order: Order): string[] {
  const inv = order.invoice;
  const parts: string[] = [];
  if (inv.carrierCode !== undefined && inv.carrierCode !== '') parts.push(s.invoiceCarrier(inv.carrierCode));
  if (inv.taxId !== undefined && inv.taxId !== '') parts.push(s.invoiceTaxId(inv.taxId));
  if (inv.buyerName !== undefined && inv.buyerName !== '') parts.push(inv.buyerName);
  if (inv.donateCode !== undefined && inv.donateCode !== '') parts.push(s.invoiceDonate(inv.donateCode));
  if (inv.invoiceNo !== undefined && inv.invoiceNo !== '') parts.push(s.invoiceNo(inv.invoiceNo));
  return parts;
}

export function PaymentSection({ order }: { order: Order }) {
  const headingId = useId();
  const { payment, invoice } = order;
  const statusText =
    payment.method === 'CASH' && payment.status === 'UNPAID'
      ? order.status === 'CANCELLED'
        ? s.cashUnpaidCancelled
        : s.cashOnPickup
      : s.paymentStatusLabel[payment.status];
  const invoiceStatus: InvoiceStatus = invoice.status;
  const detail = invoiceDetail(order);

  return (
    <Card as="section" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-h3 font-bold text-text">
        {s.sectionPayment}
      </h2>
      <dl className="m-0 mt-3 flex flex-col gap-2 text-base leading-6">
        <div className="flex justify-between gap-3">
          <dt className="text-text-sub">{s.paymentMethod}</dt>
          <dd className="m-0 text-right font-semibold text-text">
            {s.paymentMethodLabel[payment.method]}・{statusText}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-sub">{s.invoice}</dt>
          <dd className="m-0 text-right text-text [overflow-wrap:anywhere]">
            {s.invoiceType[invoice.type]}
            <span className="block text-sm leading-5 text-text-sub">
              {[s.invoiceStatus[invoiceStatus], ...detail].join('・')}
            </span>
          </dd>
        </div>
        <div className="flex justify-between gap-3 text-sm leading-5">
          <dt className="text-text-muted">{s.placedAt}</dt>
          <dd className="m-0 text-text-muted tabular-nums">{formatDateTime(order.placedAt)}</dd>
        </div>
      </dl>
    </Card>
  );
}
