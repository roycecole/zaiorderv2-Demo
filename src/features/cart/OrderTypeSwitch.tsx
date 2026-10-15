// src/features/cart/OrderTypeSwitch.tsx —— 取餐方式切換（CMP-11）：原生 radio 組成的分段控制，← → 切換
import clsx from 'clsx';
import { useId } from 'react';
import type { OrderType } from '@/domain/types';
import { useQrTable } from '@/features/checkout/useQrTable';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useStoreInfo } from '@/features/store/queries';
import { t } from '@/i18n/zh-TW';
import { useCartStore } from './cartStore';

const ALL: ReadonlyArray<OrderType> = ['PICKUP', 'DELIVERY', 'DINE_IN'];

export interface OrderTypeSwitchProps {
  className?: string;
  /** 變更後的回呼（例如重新計價前的 live region 通報） */
  onChange?: (next: OrderType) => void;
}

/** 觸控面板的店內用語：PICKUP 為「外帶」（03 §5.6） */
export function orderTypeLabel(type: OrderType, kiosk: boolean): string {
  return kiosk && type === 'PICKUP' ? t.cart.orderType.kioskPickup : t.common.orderType[type];
}

/**
 * 依店家設定隱藏不可用的取餐方式（`services`）；觸控面板不提供外送。
 * 變更寫入購物車並記住上次選擇（`prefs.lastOrderType`，PG-01）。
 * 以 QR 桌號進入（`?table=`，FR-CK-05）且桌號有效時固定為內用，其餘方式停用並說明原因（03 PG-01）。
 */
export function OrderTypeSwitch({ className, onChange }: OrderTypeSwitchProps) {
  const groupName = useId();
  const hintId = useId();
  const orderType = useCartStore((s) => s.orderType);
  const setOrderType = useCartStore((s) => s.setOrderType);
  const patchPrefs = usePrefsStore((s) => s.patch);
  const services = useStoreInfo().data?.services;
  const kiosk = useIsKioskUi();
  const qr = useQrTable();
  // 桌號確認中也先停用：確認後取餐方式會被固定為內用，不讓顧客在這段時間改到一半又被改回
  const frozen = qr.locked || qr.status === 'checking';
  const lockedHint = qr.locked
    ? qr.tableNo !== null
      ? t.cart.orderType.lockedByTable(qr.tableNo)
      : null
    : qr.status === 'checking'
      ? t.cart.orderType.tableChecking
      : null;
  const selected: OrderType = qr.locked ? 'DINE_IN' : orderType;

  const serviceOn = (type: OrderType): boolean => {
    if (kiosk && type === 'DELIVERY') return false;
    if (services === undefined) return true;
    return type === 'PICKUP'
      ? services.pickup
      : type === 'DELIVERY'
        ? services.delivery
        : services.dineIn;
  };
  // 目前選取者即使店家剛關閉該服務也保留顯示（由結帳頁的異動清單處理），避免選取狀態憑空消失
  const options = ALL.filter((type) => type === selected || serviceOn(type));

  return (
    <fieldset
      aria-describedby={lockedHint !== null ? hintId : undefined}
      className={clsx('m-0 min-w-0 border-0 p-0', className)}
    >
      <legend className="sr-only">{t.cart.orderType.legend}</legend>
      <div className="inline-flex max-w-full rounded-pill bg-bg-muted p-1">
        {options.map((type) => (
          <label key={type} className="relative min-w-0">
            <input
              type="radio"
              name={groupName}
              value={type}
              checked={selected === type}
              disabled={frozen && type !== selected}
              onChange={() => {
                setOrderType(type);
                patchPrefs({ lastOrderType: type });
                onChange?.(type);
              }}
              className="peer sr-only"
            />
            <span
              className={clsx(
                'flex min-h-[calc(var(--hit-size)-8px)] min-w-16 cursor-pointer items-center justify-center rounded-pill px-4 text-sm leading-5 font-medium whitespace-nowrap text-text-sub select-none',
                'transition-colors duration-150 hover:text-text',
                'peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-disabled:hover:text-text-sub',
                'peer-checked:bg-bg peer-checked:font-semibold peer-checked:text-brand-text peer-checked:shadow-sm',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-text',
                'kiosk:min-w-24 kiosk:px-6 kiosk:text-base kiosk:leading-6',
              )}
            >
              {orderTypeLabel(type, kiosk)}
            </span>
          </label>
        ))}
      </div>
      {lockedHint !== null ? (
        <p id={hintId} className="mt-2 text-sm leading-5 text-text-sub">
          {lockedHint}
        </p>
      ) : null}
    </fieldset>
  );
}
