// QR 桌號的菜單端狀態（03 PG-01、FR-CK-05）：none / checking / locked / notFound / dineInOff 與購物車取餐方式鎖定
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCartStore } from '@/features/cart/cartStore';
import { fakeApi, storeInfo } from '@/features/menu/__tests__/fixtures';
import { ApiProvider } from '@/hooks/useApi';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import { forgetQrTable, rememberQrTable } from '../qrTable';
import { useLockOrderTypeToQrTable, useQrTable } from '../useQrTable';

type Resolve = (qrToken: string) => Promise<{ tableNo: string; seats?: number }>;

function setup(options: { url: string; resolveTable?: Resolve; dineIn?: boolean }) {
  const resolveTable = vi.fn<Resolve>(options.resolveTable ?? (async () => ({ tableNo: 'A3' })));
  const api = fakeApi({
    resolveTable,
    info: storeInfo({
      services: { pickup: true, delivery: true, dineIn: options.dineIn ?? true },
    }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <MemoryRouter initialEntries={[options.url]}>{children}</MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>
  );
  return { resolveTable, wrapper };
}

beforeEach(() => {
  appSessionStorage.removeItem(STORAGE_KEYS.table);
  useCartStore.setState({ lines: [], orderType: 'PICKUP' });
});
afterEach(() => appSessionStorage.removeItem(STORAGE_KEYS.table));

describe('useQrTable', () => {
  it('沒有桌位權杖：none，不查詢桌號', () => {
    const { resolveTable, wrapper } = setup({ url: '/' });
    const { result } = renderHook(() => useQrTable(), { wrapper });
    expect(result.current).toEqual({ status: 'none', token: null, tableNo: null, locked: false });
    expect(resolveTable).not.toHaveBeenCalled();
  });

  it('網址 ?table= 優先：確認中 → locked 並帶出桌號', async () => {
    const { resolveTable, wrapper } = setup({ url: '/?table=A3' });
    const { result } = renderHook(() => useQrTable(), { wrapper });
    expect(result.current.status).toBe('checking');
    expect(result.current.token).toBe('A3');
    await waitFor(() => expect(result.current.status).toBe('locked'));
    expect(result.current).toMatchObject({ tableNo: 'A3', locked: true });
    expect(resolveTable).toHaveBeenCalledTimes(1);
  });

  it('沒有 ?table= 時沿用本分頁記下的權杖，且記下 / 清除會即時反映', async () => {
    const { wrapper } = setup({ url: '/cart' });
    const { result } = renderHook(() => useQrTable(), { wrapper });
    expect(result.current.status).toBe('none');

    act(() => rememberQrTable('A5'));
    expect(result.current.token).toBe('A5');
    await waitFor(() => expect(result.current.status).toBe('locked'));

    act(() => forgetQrTable());
    expect(result.current.status).toBe('none');
  });

  it('無法辨識：notFound，不鎖定', async () => {
    const { wrapper } = setup({
      url: '/?table=Z9',
      resolveTable: async () => {
        throw new Error('找不到桌號');
      },
    });
    const { result } = renderHook(() => useQrTable(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('notFound'));
    expect(result.current).toMatchObject({ tableNo: null, locked: false });
  });

  it('桌號有效但店家未開放內用：dineInOff，不鎖定', async () => {
    const { wrapper } = setup({ url: '/?table=A3', dineIn: false });
    const { result } = renderHook(() => useQrTable(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('dineInOff'));
    expect(result.current).toMatchObject({ tableNo: 'A3', locked: false });
  });
});

describe('useLockOrderTypeToQrTable', () => {
  it('locked 時把購物車取餐方式寫成內用', async () => {
    useCartStore.setState({ orderType: 'DELIVERY' });
    const { wrapper } = setup({ url: '/?table=A3' });
    renderHook(() => useLockOrderTypeToQrTable(), { wrapper });
    expect(useCartStore.getState().orderType).toBe('DELIVERY');
    await waitFor(() => expect(useCartStore.getState().orderType).toBe('DINE_IN'));
  });

  it('不是 locked（無法辨識 / 未開放內用 / 沒掃 QR）時不動購物車', async () => {
    useCartStore.setState({ orderType: 'DELIVERY' });
    const { wrapper } = setup({ url: '/?table=A3', dineIn: false });
    const { result } = renderHook(() => useLockOrderTypeToQrTable(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('dineInOff'));
    expect(useCartStore.getState().orderType).toBe('DELIVERY');
  });
});
