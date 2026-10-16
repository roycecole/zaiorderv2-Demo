// src/features/menu/StoreActions.tsx —— 菜單頁店家資訊列的右側：取餐方式切換與預估時間 / 休息提示（03 PG-01）
import { useQuery } from '@tanstack/react-query';
import { OrderTypeSwitch } from '@/features/cart/OrderTypeSwitch';
import { useCartStore } from '@/features/cart/cartStore';
import { useQrTable } from '@/features/checkout/useQrTable';
import { useStoreStatus } from '@/features/store/queries';
import { useApi } from '@/hooks/useApi';
import { t } from '@/i18n/zh-TW';
import { qk } from '@/services/api/queryKeys';

/**
 * 立即單的預估時間（`asap.etaMinutes`）：自取 / 內用；外送要依郵遞區號計算，菜單頁不顯示。
 * 營業中才有值；休息或暫停時 `asap.available` 為 false，不顯示。
 */
function useAsapEta(orderType: 'PICKUP' | 'DELIVERY' | 'DINE_IN') {
  const api = useApi();
  const enabled = orderType !== 'DELIVERY';
  const query = useQuery({
    queryKey: qk.store.pickupSlots(orderType),
    queryFn: () => api.store.getPickupSlots({ orderType }),
    enabled,
    staleTime: 60_000,
  });
  const asap = query.data?.asap;
  return enabled && asap?.available === true ? (asap.etaMinutes ?? null) : null;
}

export function StoreActions() {
  const orderType = useCartStore((s) => s.orderType);
  const qr = useQrTable();
  const selected = qr.locked ? 'DINE_IN' : orderType;
  const eta = useAsapEta(selected);
  const status = useStoreStatus().data;

  // 營業中顯示預估時間；休息中提示仍可預約（營業狀態標籤已說明何時開始營業）。
  // 這一格固定保留寬度：提示晚幾百毫秒才出現也不會把旁邊的切換鈕推開（CLS）。
  const hint =
    status?.status === 'CLOSED'
      ? t.menu.closedHint
      : eta !== null
        ? t.menu.eta(eta.min, eta.max)
        : null;

  return (
    <>
      {/* QR 桌號鎖定時，頁面頂部的桌號提示已說明取餐方式固定為內用，不再顯示切換 */}
      {qr.locked ? null : <OrderTypeSwitch />}
      <span className="inline-block min-w-[5.5rem] text-sm leading-5 whitespace-nowrap text-text-sub">
        {hint}
      </span>
    </>
  );
}
