// src/features/store/StorePage.tsx —— 店家資訊（PG-15）
//
// 店家名稱與簡介、地址（地圖連結）、電話（tel:）、營業時間表（今日強調）、特殊營業日、
// 取餐方式、外送範圍、付款方式與餐具政策。所有區塊在欄位缺漏時降級（BR-30）。
import { ArrowLeft, Check, ExternalLink, Mail, MapPin, Phone, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, Card, ErrorState, Skeleton } from '@/components';
import { ROUTES } from '@/app/routes';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { formatMonthDayWeek, formatTWD } from '@/domain/format';
import { dateOfMs, msOf, weekdayOf } from '@/domain/taipeiTime';
import type { BusinessHour, DeliveryZone, SpecialDay, StoreInfo, Weekday } from '@/domain/types';
import { useClockNow } from '@/hooks/useClockNow';
import { errorMessageOf } from '@/i18n/strings/errors';
import { t } from '@/i18n/zh-TW';
import { useDeliveryZones, useStoreInfo, useStoreStatus } from './queries';
import { StoreStatusBadge } from './StoreStatusBadge';
import { formatHoursSpan } from './storeStatusText';

/** 週一到週日（週日排最後，台灣習慣） */
const WEEK_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

const mapUrl = (info: StoreInfo): string => {
  const { latitude, longitude, city, district, line } = info.address;
  const query =
    latitude !== undefined && longitude !== undefined
      ? `${latitude},${longitude}`
      : `${city}${district}${line}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
};

const fullAddress = (info: StoreInfo): string =>
  `${info.address.city}${info.address.district}${info.address.line}`;

function hoursOf(hours: readonly BusinessHour[], weekday: Weekday): string[] {
  return hours
    .filter((h) => h.weekday === weekday)
    .sort((a, b) => a.open.localeCompare(b.open))
    .map((h) => formatHoursSpan(h.open, h.close));
}

function specialText(day: SpecialDay): string {
  const s = t.store.page.hours;
  if (day.type === 'CLOSED') return s.specialClosed;
  if (day.open !== undefined && day.close !== undefined) return s.specialHours(day.open, day.close);
  return s.specialClosed;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const headingId = `store-${id}`;
  return (
    <Card as="section" aria-labelledby={headingId} padding="lg">
      <h2 id={headingId} className="mb-3 text-h2 font-bold text-text">
        {title}
      </h2>
      {children}
    </Card>
  );
}

function StateIcon({ on }: { on: boolean }) {
  return on ? (
    <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
  ) : (
    <X aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
  );
}

function ServiceRow({
  label,
  on,
  detail,
}: {
  label: string;
  on: boolean;
  detail?: string | undefined;
}) {
  const s = t.store.page.services;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-base leading-6">
      <StateIcon on={on} />
      <span className="font-semibold text-text">{label}</span>
      <span className={on ? 'text-success' : 'text-text-muted'}>
        {on ? s.available : s.unavailable}
      </span>
      {on && detail !== undefined ? <span className="text-sm text-text-sub">{detail}</span> : null}
    </li>
  );
}

function DeliveryTable({ zones }: { zones: readonly DeliveryZone[] }) {
  const s = t.store.page.delivery;
  return (
    <div
      role="region"
      // 可捲動區塊必須可由鍵盤聚焦才能左右捲動（axe: scrollable-region-focusable）
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={s.scrollRegion}
      className="overflow-x-auto rounded-md border border-border"
    >
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm leading-5">
        <caption className="sr-only">{s.caption}</caption>
        <thead className="bg-bg-subtle text-text-sub">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">
              {s.district}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {s.fee}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {s.minOrder}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {s.freeThreshold}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {s.eta}
            </th>
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.zipCode} className="border-t border-border">
              <th scope="row" className="px-3 py-2 font-medium text-text">
                {z.city}
                {z.district}
              </th>
              <td className="px-3 py-2 text-right tabular-nums">
                {z.deliveryFee === 0 ? s.free : formatTWD(z.deliveryFee)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {z.minOrderAmount > 0 ? formatTWD(z.minOrderAmount) : s.none}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {z.freeDeliveryThreshold !== null ? formatTWD(z.freeDeliveryThreshold) : s.none}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {z.estimatedMinutes > 0 ? s.etaMinutes(z.estimatedMinutes) : s.none}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StorePage() {
  const page = t.store.page;
  usePageTitle(page.title);
  const info = useStoreInfo();
  const status = useStoreStatus();
  const now = useClockNow(60_000);
  const data = info.data;
  const zones = useDeliveryZones(data?.services.delivery === true);

  const backLink = (
    <Link
      to={ROUTES.home}
      className="hit-area inline-flex min-h-(--hit-size) items-center gap-2 text-base font-semibold text-brand-text underline underline-offset-4"
    >
      <ArrowLeft aria-hidden="true" className="size-5" />
      {page.backToMenu}
    </Link>
  );

  if (data === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
        {backLink}
        {info.isError ? (
          <ErrorState
            title={page.loadFailedTitle}
            message={errorMessageOf(info.error, page.loadFailedMessage)}
            onRetry={() => void info.refetch()}
            retrying={info.isFetching}
          />
        ) : (
          <div aria-busy="true" className="mt-6 space-y-4">
            <h1 className="sr-only">{page.title}</h1>
            <Skeleton width="60%" height={32} />
            <Skeleton height={20} />
            <Skeleton height={160} rounded="lg" />
          </div>
        )}
      </div>
    );
  }

  const todayDate = dateOfMs(now.getTime());
  const todayWeekday = weekdayOf(todayDate);
  const todaySpecial = data.specialDays.find((d) => d.date === todayDate);
  const specialDays = [...data.specialDays].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      {backLink}

      <header className="mt-2 mb-6">
        <h1
          id="store-name"
          tabIndex={-1}
          className="text-h1 font-bold text-text [overflow-wrap:anywhere]"
        >
          {data.name}
        </h1>
        {data.tagline !== undefined && data.tagline.length > 0 ? (
          <p className="mt-1 text-base leading-6 text-text-sub">{data.tagline}</p>
        ) : null}
        <div className="mt-3">
          <StoreStatusBadge status={status.data} />
        </div>
        {data.description !== undefined && data.description.length > 0 ? (
          <p className="mt-4 max-w-[65ch] text-base leading-6 text-text">{data.description}</p>
        ) : null}
      </header>

      <div className="space-y-4">
        <Section id="contact" title={page.contact.title}>
          <ul className="m-0 list-none space-y-1 p-0 text-base leading-6">
            <li className="flex items-start gap-3 py-1">
              <MapPin aria-hidden="true" className="mt-1 size-5 shrink-0 text-text-muted" />
              <div className="min-w-0">
                <span className="sr-only">{page.contact.address}：</span>
                <span className="[overflow-wrap:anywhere]">
                  {data.address.zipCode} {fullAddress(data)}
                </span>
                <a
                  href={mapUrl(data)}
                  aria-label={page.contact.mapLabel(fullAddress(data))}
                  className="mt-1 flex min-h-(--hit-size) items-center gap-1.5 font-semibold text-brand-text underline underline-offset-4"
                >
                  {page.contact.openMap}
                  <ExternalLink aria-hidden="true" className="size-4" />
                </a>
              </div>
            </li>
            <li className="flex items-center gap-3 py-1">
              <Phone aria-hidden="true" className="size-5 shrink-0 text-text-muted" />
              <span className="sr-only">{page.contact.phone}：</span>
              <a
                href={`tel:${data.phone}`}
                aria-label={page.contact.callLabel(data.phone)}
                className="inline-flex min-h-(--hit-size) items-center font-semibold text-brand-text underline underline-offset-4"
              >
                {data.phone}
              </a>
            </li>
            {data.email !== undefined && data.email.length > 0 ? (
              <li className="flex items-center gap-3 py-1">
                <Mail aria-hidden="true" className="size-5 shrink-0 text-text-muted" />
                <span className="sr-only">{page.contact.email}：</span>
                <a
                  href={`mailto:${data.email}`}
                  className="inline-flex min-h-(--hit-size) items-center text-brand-text underline underline-offset-4 [overflow-wrap:anywhere]"
                >
                  {data.email}
                </a>
              </li>
            ) : null}
          </ul>
        </Section>

        <Section id="hours" title={page.hours.title}>
          <table className="w-full border-collapse text-left text-base leading-6">
            <caption className="sr-only">{page.hours.caption}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">{page.hours.weekday}</th>
                <th scope="col">{page.hours.time}</th>
              </tr>
            </thead>
            <tbody>
              {WEEK_ORDER.map((weekday) => {
                const spans = hoursOf(data.businessHours, weekday);
                const isToday = weekday === todayWeekday;
                return (
                  <tr
                    key={weekday}
                    aria-current={isToday ? 'date' : undefined}
                    className={
                      isToday
                        ? 'border-t border-border bg-brand-soft font-semibold'
                        : 'border-t border-border first:border-t-0'
                    }
                  >
                    <th scope="row" className="w-28 px-3 py-2 align-top font-medium text-text">
                      {page.hours.weekdayNames[weekday]}
                      {isToday ? (
                        <Badge tone="brand" className="ml-2 align-middle">
                          {page.hours.today}
                        </Badge>
                      ) : null}
                    </th>
                    <td className="px-3 py-2 text-text">
                      {spans.length > 0 ? (
                        spans.join('、')
                      ) : (
                        <span className="text-text-muted">{page.hours.closed}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {todaySpecial !== undefined ? (
            <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm leading-5 font-semibold text-warning">
              {page.hours.todaySpecial(
                `${specialText(todaySpecial)}${todaySpecial.note ? `（${todaySpecial.note}）` : ''}`,
              )}
            </p>
          ) : null}

          <h3 className="mt-5 mb-2 text-h3 font-bold text-text">{page.hours.specialTitle}</h3>
          {specialDays.length === 0 ? (
            <p className="text-sm leading-5 text-text-muted">{page.hours.specialNone}</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-border p-0 text-base leading-6">
              {specialDays.map((d) => (
                <li key={`${d.date}-${d.type}`} className="flex flex-wrap gap-x-4 gap-y-1 py-2">
                  <span className="w-32 shrink-0 font-medium text-text">
                    {formatMonthDayWeek(msOf(d.date, '00:00'))}
                  </span>
                  <span className="min-w-0 text-text-sub">
                    {specialText(d)}
                    {d.note ? `・${d.note}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="services" title={page.services.title}>
          <ul className="m-0 list-none divide-y divide-border p-0">
            <ServiceRow
              label={page.services.pickup}
              on={data.services.pickup}
              detail={page.services.pickupLead(data.limits.pickupLeadMinutes)}
            />
            <ServiceRow
              label={page.services.delivery}
              on={data.services.delivery}
              detail={page.services.deliveryLead(data.limits.deliveryLeadMinutes)}
            />
            <ServiceRow label={page.services.dineIn} on={data.services.dineIn} />
          </ul>
          {data.limits.minOrderAmount > 0 ? (
            <p className="mt-3 text-sm leading-5 text-text-sub">
              {page.services.minOrder(formatTWD(data.limits.minOrderAmount))}
            </p>
          ) : null}
        </Section>

        {data.services.delivery ? (
          <Section id="delivery" title={page.delivery.title}>
            {zones.data !== undefined ? (
              zones.data.items.length > 0 ? (
                <DeliveryTable zones={zones.data.items} />
              ) : (
                <p className="text-sm leading-5 text-text-muted">{page.delivery.empty}</p>
              )
            ) : zones.isError ? (
              <p role="alert" className="text-sm leading-5 text-danger">
                {page.delivery.loadFailed}
              </p>
            ) : (
              <Skeleton height={96} rounded="lg" />
            )}
          </Section>
        ) : null}

        <Section id="payment" title={page.payment.title}>
          {data.paymentMethods.length > 0 ? (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {data.paymentMethods.map((m) => (
                <li key={m}>
                  <Badge tone="neutral" className="min-h-8 px-3 text-sm">
                    {page.payment.labels[m] ?? m}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm leading-5 text-text-muted">{page.payment.empty}</p>
          )}
        </Section>

        <Section id="utensils" title={page.utensils.title}>
          <p className="text-base leading-6 text-text-sub">{page.utensils.body}</p>
        </Section>
      </div>
    </div>
  );
}
