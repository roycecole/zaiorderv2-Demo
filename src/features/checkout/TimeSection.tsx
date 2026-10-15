// src/features/checkout/TimeSection.tsx —— ② 取餐時間：盡快 / 預約（CMP-19 TimeSlotPicker）
import { useId, useState } from 'react';
import type { Ref } from 'react';
import clsx from 'clsx';
import { Chip, RadioCard, RadioGroup } from '@/components';
import { formatTime } from '@/domain/format';
import type { OrderType, PickupSlotsResponse, Slot } from '@/domain/types';
import { checkout as tCheckout } from '@/i18n/strings/checkout';
import { FieldErrorText } from './FieldErrorText';
import { SectionCard } from './SectionCard';

const T = tCheckout.time;

export interface TimeSectionProps {
  orderType: OrderType;
  slots: PickupSlotsResponse | undefined;
  loading: boolean;
  failed: boolean;
  /** 外送尚未選擇地址（郵遞區號必填才能取得時段，06 §5.6） */
  waitingForZip: boolean;
  /** 盡快不可用時的原因（休息中、暫停接單、外送來不及） */
  asapUnavailableText: string | undefined;
  mode: 'ASAP' | 'SCHEDULED';
  scheduledAt: string;
  error: string | undefined;
  /** 外送「盡快」的預估分鐘（配送區 estimatedMinutes 優先） */
  deliveryMinutes: number | undefined;
  /** 時段選擇區第一個可選項（時段額滿被退回時焦點落此，EC-07） */
  firstSlotRef: Ref<HTMLInputElement>;
  onModeChange: (mode: 'ASAP' | 'SCHEDULED') => void;
  onSelectSlot: (startAt: string) => void;
}

export function TimeSection({
  orderType,
  slots,
  loading,
  failed,
  waitingForZip,
  asapUnavailableText,
  mode,
  scheduledAt,
  error,
  deliveryMinutes,
  firstSlotRef,
  onModeChange,
  onSelectSlot,
}: TimeSectionProps) {
  const headingId = useId();
  const errorId = useId();
  const title =
    orderType === 'DELIVERY'
      ? tCheckout.section.timeDelivery
      : orderType === 'DINE_IN'
        ? tCheckout.section.timeDineIn
        : tCheckout.section.time;

  const days = slots?.days ?? [];
  const asap = slots?.asap;
  const [activeDate, setActiveDate] = useState<string | null>(null);
  // 所選時段由外部改變（改選最近時段、預約明天…）時，顯示該時段所屬的日期
  const [seenSelection, setSeenSelection] = useState(scheduledAt);
  if (seenSelection !== scheduledAt) {
    setSeenSelection(scheduledAt);
    setActiveDate(null);
  }

  const selectedDay = days.find((d) => d.slots.some((s) => s.startAt === scheduledAt));
  const shownDate =
    activeDate !== null && days.some((d) => d.date === activeDate)
      ? activeDate
      : (selectedDay?.date ?? days[0]?.date);
  const day = days.find((d) => d.date === shownDate);

  const asapEta = ((): string | undefined => {
    if (asap?.available !== true) return undefined;
    if (orderType === 'DELIVERY' && deliveryMinutes !== undefined) {
      return T.asapEtaDelivery(deliveryMinutes, deliveryMinutes + 5);
    }
    const eta = asap.etaMinutes;
    return eta === undefined ? undefined : T.asapEta(eta.min, eta.max);
  })();

  // 內用只有「盡快」，不提供預約（06 §5.6：DINE_IN 不回傳時段）
  if (orderType === 'DINE_IN') {
    return (
      <SectionCard index={2} title={title} headingId={headingId}>
        <p className="text-sm leading-5 text-text-sub">
          {T.asap}
          {asapEta !== undefined ? `・${asapEta}` : ''}
        </p>
        {asap?.available === false && asapUnavailableText !== undefined ? (
          <p className="mt-1 text-sm leading-5 text-warning">{asapUnavailableText}</p>
        ) : null}
      </SectionCard>
    );
  }

  const noDays = !loading && !waitingForZip && days.length === 0;
  const asapDisabled = asap?.available === false || waitingForZip;
  const scheduledDisabled = waitingForZip || noDays;

  return (
    <SectionCard index={2} title={title} headingId={headingId}>
      <RadioGroup
        name="scheduleMode"
        legend={title}
        hideLegend
        columns={2}
        value={mode}
        onChange={(v) => onModeChange(v as 'ASAP' | 'SCHEDULED')}
      >
        <RadioCard
          value="ASAP"
          label={T.asap}
          description={asapEta ?? (loading ? T.loading : undefined)}
          disabled={asapDisabled}
          {...(asapDisabled
            ? {
                disabledReason: waitingForZip
                  ? T.needAddressShort
                  : (asapUnavailableText ?? T.asapUnavailable),
              }
            : {})}
        />
        <RadioCard
          value="SCHEDULED"
          label={T.scheduled}
          description={noDays ? T.noSlots : T.scheduledHint}
          disabled={scheduledDisabled}
        />
      </RadioGroup>

      {waitingForZip ? (
        <p className="mt-2 text-sm leading-5 text-text-muted">{T.needAddress}</p>
      ) : null}
      {failed ? <p className="mt-2 text-sm leading-5 text-danger">{T.loadFailed}</p> : null}
      {asap?.available === false && asapUnavailableText !== undefined && !waitingForZip ? (
        <p className="mt-2 text-sm leading-5 text-warning">{asapUnavailableText}</p>
      ) : null}

      {mode === 'SCHEDULED' && !waitingForZip && days.length > 0 ? (
        <div className="mt-4">
          <div role="group" aria-label={T.dateLegend} className="flex flex-wrap gap-2">
            {days.map((d) => (
              <Chip
                key={d.date}
                selected={d.date === shownDate}
                onClick={() => setActiveDate(d.date)}
              >
                {d.label}
              </Chip>
            ))}
          </div>
          {day !== undefined ? (
            <SlotGrid
              slots={day.slots}
              value={scheduledAt}
              describedBy={error !== undefined ? errorId : undefined}
              firstSlotRef={firstSlotRef}
              onSelect={onSelectSlot}
            />
          ) : null}
        </div>
      ) : null}

      {error !== undefined && mode === 'SCHEDULED' ? (
        <FieldErrorText id={errorId}>{error}</FieldErrorText>
      ) : null}
    </SectionCard>
  );
}

function SlotGrid({
  slots,
  value,
  describedBy,
  firstSlotRef,
  onSelect,
}: {
  slots: ReadonlyArray<Slot>;
  value: string;
  describedBy: string | undefined;
  firstSlotRef: Ref<HTMLInputElement>;
  onSelect: (startAt: string) => void;
}) {
  const firstAvailable = slots.findIndex((s) => s.status === 'AVAILABLE');
  return (
    <fieldset className="m-0 mt-3 min-w-0 border-0 p-0" aria-describedby={describedBy}>
      <legend className="sr-only">{T.slotLegend}</legend>
      <div className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-4 kiosk:gap-3">
        {slots.map((s, i) => {
          const full = s.status === 'FULL';
          const time = formatTime(s.startAt);
          const checked = s.startAt === value;
          return (
            <label
              key={s.startAt}
              className={clsx(
                'relative flex min-h-(--hit-size) flex-col items-center justify-center rounded-md border px-2 py-1 text-sm leading-5 tabular-nums',
                full
                  ? 'cursor-not-allowed border-border bg-bg-muted text-text-disabled'
                  : 'cursor-pointer border-border-strong bg-bg text-text hover:bg-bg-subtle',
                'has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:font-semibold has-[:checked]:text-brand-text',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-text',
              )}
            >
              <input
                ref={i === firstAvailable ? firstSlotRef : undefined}
                type="radio"
                name="slot"
                value={s.startAt}
                checked={checked}
                aria-disabled={full ? true : undefined}
                aria-label={full ? T.slotFullAria(time) : time}
                onChange={() => {
                  if (!full) onSelect(s.startAt);
                }}
                className="absolute inset-0 m-0 size-full cursor-[inherit] opacity-0"
              />
              <span aria-hidden="true">{time}</span>
              {full ? (
                <span aria-hidden="true" className="text-xs leading-4">
                  {T.slotFull}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
