// src/features/checkout/useQrTable.ts —— QR 桌號在菜單 / 購物車端的狀態（03 PG-01、FR-CK-05、BR-22；08 S10）
//
// 桌位權杖來源：目前網址的 `?table=`，其次是外殼記在本分頁的權杖（站內導覽不帶查詢字串）。
// 以 `api.store.resolveTable` 驗證，結果用 TanStack Query 快取（與結帳頁共用同一把鍵，只打一次）：
//   辨識成功且店家開放內用 → locked：取餐方式鎖定為內用；
//   無法辨識（找不到 / 已停用）或店家未開放內用 → 提示並回退為一般取餐方式，不鎖定。
import { useQuery } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import { useCartStore } from '@/features/cart/cartStore';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { useStoreInfo } from '@/features/store/queries';
import { useApi } from '@/hooks/useApi';
import { qk } from '@/services/api/queryKeys';
import { qrTokenFromSearch, recalledQrTable, subscribeQrTable } from './qrTable';

export type QrTableStatus =
  /** 沒有掃 QR（網址與本分頁都沒有桌位權杖） */
  | 'none'
  /** 桌號或店家資訊確認中 */
  | 'checking'
  /** 辨識成功且店家開放內用：取餐方式鎖定為內用 */
  | 'locked'
  /** 桌號無法辨識：回退為一般取餐方式 */
  | 'notFound'
  /** 桌號有效但店家目前未開放內用：回退為一般取餐方式 */
  | 'dineInOff';

export interface QrTableState {
  status: QrTableStatus;
  /** 桌位權杖；null = 沒有掃 QR */
  token: string | null;
  /** 辨識成功的桌號（locked 與 dineInOff 時有值） */
  tableNo: string | null;
  /** 取餐方式是否被 QR 桌號鎖定為內用 */
  locked: boolean;
}

const NO_TOKEN = (): null => null;

export function useQrTable(): QrTableState {
  const api = useApi();
  const { search } = useLocation();
  const stored = useSyncExternalStore(subscribeQrTable, recalledQrTable, NO_TOKEN);
  // 觸控面板的內用單一律沒有桌號（桌號為選填，櫃檯依取餐號碼叫號）：不套用 QR 桌號
  const kiosk = useIsKioskUi();
  const token = kiosk ? null : (qrTokenFromSearch(search) ?? stored);

  const info = useStoreInfo();
  const table = useQuery({
    queryKey: qk.store.table(token ?? ''),
    queryFn: () => api.store.resolveTable(token ?? ''),
    enabled: token !== null,
    staleTime: Infinity,
    retry: false,
  });

  if (token === null) return { status: 'none', token, tableNo: null, locked: false };
  if (table.isError) return { status: 'notFound', token, tableNo: null, locked: false };
  const tableNo = table.data?.tableNo ?? null;
  if (tableNo === null) return { status: 'checking', token, tableNo, locked: false };
  // 店家資訊載入失敗時不擋：內用是否開放由送出訂單時的伺服器驗證把關
  if (info.data === undefined && !info.isError) {
    return { status: 'checking', token, tableNo, locked: false };
  }
  if (info.data !== undefined && !info.data.services.dineIn) {
    return { status: 'dineInOff', token, tableNo, locked: false };
  }
  return { status: 'locked', token, tableNo, locked: true };
}

/**
 * 有有效桌號時，把購物車的取餐方式寫成內用（結帳頁帶入桌號時同樣處理）。
 * 不寫入 `prefs.lastOrderType`：這是 QR 帶來的情境，不是顧客自己的偏好。
 */
export function useLockOrderTypeToQrTable(): QrTableState {
  const state = useQrTable();
  const orderType = useCartStore((s) => s.orderType);
  const { locked } = state;
  useEffect(() => {
    if (locked && orderType !== 'DINE_IN') useCartStore.getState().setOrderType('DINE_IN');
  }, [locked, orderType]);
  return state;
}
