// src/features/checkout/OrderTypeSection.tsx —— ① 取餐方式（CMP-11 OrderTypeSwitch）
import { useId } from 'react';
import { RadioCard, RadioGroup } from '@/components';
import type { OrderType } from '@/domain/types';
import { checkout as tCheckout } from '@/i18n/strings/checkout';
import { SectionCard } from './SectionCard';

export interface OrderTypeSectionProps {
  /** 店家開放且此裝置可用的取餐方式（觸控面板不含外送） */
  available: ReadonlyArray<OrderType>;
  value: OrderType;
  /** 目前選的方式已被店家關閉（SERVICE_NOT_AVAILABLE）：保留顯示並標示不可用 */
  currentUnavailable: boolean;
  /** QR 桌號帶入後鎖定為內用 */
  lockedTo: OrderType | null;
  lockedHint?: string | undefined;
  kiosk: boolean;
  onChange: (next: OrderType) => void;
  /** 取餐點地址（標題右側） */
  aside?: string | undefined;
}

export function OrderTypeSection({
  available,
  value,
  currentUnavailable,
  lockedTo,
  lockedHint,
  kiosk,
  onChange,
  aside,
}: OrderTypeSectionProps) {
  const headingId = useId();
  const labels = kiosk ? tCheckout.kioskOrderTypeLabel : tCheckout.orderTypeLabel;
  const options: OrderType[] = [...available];
  if (!options.includes(value)) options.push(value);

  return (
    <SectionCard index={1} title={tCheckout.section.orderType} headingId={headingId} aside={aside}>
      <RadioGroup
        name="orderType"
        legend={tCheckout.orderType.legend}
        hideLegend
        columns={options.length >= 3 ? 3 : 2}
        value={value}
        onChange={(v) => onChange(v as OrderType)}
        hint={lockedHint}
      >
        {options.map((o) => {
          const disabledByLock = lockedTo !== null && o !== lockedTo;
          const disabledByStore = o === value && currentUnavailable;
          return (
            <RadioCard
              key={o}
              value={o}
              label={labels[o]}
              disabled={disabledByLock || disabledByStore}
              {...(disabledByStore ? { disabledReason: tCheckout.orderType.unavailable } : {})}
            />
          );
        })}
      </RadioGroup>
    </SectionCard>
  );
}
