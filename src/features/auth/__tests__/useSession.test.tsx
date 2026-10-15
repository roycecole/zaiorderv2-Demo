// useSession：登出呼叫 auth.logout、清除 Session 與會員 Query 快取，購物車與訪客記錄保留
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCartStore } from '@/features/cart/cartStore';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { ApiProvider } from '@/hooks/useApi';
import { qk } from '@/services/api/queryKeys';
import { createFakeApi } from '@/test/fakeApi';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { useSessionStore } from '../sessionStore';
import { useSession } from '../useSession';

const tokens = { accessToken: 'acc', refreshToken: 'ref-1', expiresIn: 900 };
const user = {
  id: 'usr_1',
  phone: '0912345678',
  name: '王小明',
  marketingOptIn: false,
  createdAt: '2026-10-01T00:00:00+08:00',
};

beforeEach(() => {
  useSessionStore.getState().clear();
  useCartStore.getState().clear();
  useGuestOrdersStore.getState().clear();
});

function setup(logout = vi.fn().mockResolvedValue(undefined)) {
  const queryClient = createTestQueryClient();
  // gcTime: 0 的測試用 client 需要有觀察者才會保留；改用較長的 gcTime 以便斷言快取
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 60_000 } });
  const api = createFakeApi({ auth: { logout } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>{children}</ApiProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useSession(), { wrapper });
  return { ...hook, queryClient, logout };
}

describe('useSession', () => {
  it('未登入：user 為 null、isLoggedIn 為 false', () => {
    const { result } = setup();
    expect(result.current.user).toBeNull();
    expect(result.current.isLoggedIn).toBe(false);
  });

  it('登入後反映 Session', () => {
    useSessionStore.getState().setSession(tokens, user);
    const { result } = setup();
    expect(result.current.isLoggedIn).toBe(true);
    expect(result.current.user?.name).toBe('王小明');
  });

  it('logout：以 Refresh Token 呼叫 auth.logout，清除 Session 與會員快取', async () => {
    useSessionStore.getState().setSession(tokens, user);
    const { result, queryClient, logout } = setup();
    queryClient.setQueryData(qk.me.frequentItems(), { items: [{ productId: 'p1' }] });
    queryClient.setQueryData(qk.me.favorites(), { productIds: ['p1'] });
    queryClient.setQueryData(qk.orders.list('active'), { items: [], nextCursor: null });
    queryClient.setQueryData(qk.store.info(), { name: '店家' });

    await act(async () => {
      await result.current.logout();
    });

    expect(logout).toHaveBeenCalledWith('ref-1');
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().tokens).toBeNull();
    expect(queryClient.getQueryData(qk.me.frequentItems())).toBeUndefined();
    expect(queryClient.getQueryData(qk.me.favorites())).toBeUndefined();
    expect(queryClient.getQueryData(qk.orders.list('active'))).toBeUndefined();
    // 與會員無關的快取保留
    expect(queryClient.getQueryData(qk.store.info())).toEqual({ name: '店家' });
  });

  it('logout：購物車與訪客的本機訂單記錄保留（FR-AC-02）', async () => {
    useSessionStore.getState().setSession(tokens, user);
    useCartStore.getState().addLine({
      productId: 'p1',
      quantity: 2,
      optionIds: [],
      snapshot: { name: '滷肉飯', unitPrice: 40, optionLabels: [] },
    });
    useGuestOrdersStore.getState().upsert({
      orderId: 'ord_1',
      orderNo: 'ZO1',
      trackingToken: 'trk',
      placedAt: '2026-10-14T12:00:00+08:00',
    });
    const { result } = setup();
    await act(async () => {
      await result.current.logout();
    });
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useGuestOrdersStore.getState().orders).toHaveLength(1);
  });

  it('logout：API 失敗時仍清除本機 Session', async () => {
    useSessionStore.getState().setSession(tokens, user);
    const { result } = setup(vi.fn().mockRejectedValue(new Error('network')));
    await act(async () => {
      await result.current.logout();
    });
    expect(useSessionStore.getState().user).toBeNull();
  });
});
