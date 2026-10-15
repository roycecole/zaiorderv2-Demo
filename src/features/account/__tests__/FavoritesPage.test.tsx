// PG-13 我的最愛 與 useFavorites：收藏清單搭配菜單資料、售完 / 下架標示、加入購物車、樂觀更新與回復
import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/components';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { ApiProvider } from '@/hooks/useApi';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { FavoritesPage } from '../FavoritesPage';
import { useFavorites } from '../useFavorites';
import { menuOf, product, profile, tokens } from './fixtures';

beforeEach(() => {
  useSessionStore.getState().setSession(tokens, profile);
  useCartStore.getState().clear();
});

const menu = menuOf(
  product({ id: 'p_lurou', name: '招牌滷肉飯', displayPrice: 35, basePrice: 35 }),
  product({ id: 'p_noodle', name: '紅燒牛肉麵', displayPrice: 120, basePrice: 100, isPriceFrom: true, hasRequiredOptions: true }),
  product({ id: 'p_sold', name: '控肉飯', displayPrice: 65, basePrice: 65, isSoldOut: true }),
);

describe('FavoritesPage', () => {
  it('以菜單資料顯示品名與價格；售完者標示並停用加入；含必選選項者改為選擇選項；已下架只能取消收藏', async () => {
    const api = createFakeApi({
      me: { favorites: { list: async () => ({ productIds: ['p_lurou', 'p_noodle', 'p_sold', 'p_gone'] }) } },
      store: { getMenu: async () => menu },
    });
    renderWithProviders(<FavoritesPage />, { api });
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(4);

    const lurou = cards[0] as HTMLElement;
    expect(within(lurou).getByText('招牌滷肉飯')).toBeInTheDocument();
    expect(within(lurou).getByText('NT$ 35')).toBeInTheDocument();
    expect(within(lurou).getByRole('button', { name: '將 招牌滷肉飯 加入購物車' })).toBeInTheDocument();

    const noodle = cards[1] as HTMLElement;
    expect(within(noodle).getByText('起')).toBeInTheDocument();
    expect(within(noodle).getByRole('link', { name: '選擇 紅燒牛肉麵 的選項' })).toHaveAttribute(
      'href',
      '/?product=p_noodle',
    );

    const sold = cards[2] as HTMLElement;
    expect(within(sold).getByText('今日售完')).toBeInTheDocument();
    expect(within(sold).queryByRole('button', { name: /加入購物車/ })).not.toBeInTheDocument();
    expect(within(sold).getByRole('button', { name: '取消收藏 控肉飯' })).toBeInTheDocument();

    const gone = cards[3] as HTMLElement;
    expect(within(gone).getByRole('heading', { name: '已下架' })).toBeInTheDocument();
    expect(within(gone).queryByRole('button', { name: /加入購物車/ })).not.toBeInTheDocument();
    expect(within(gone).getByRole('button', { name: /取消收藏/ })).toBeInTheDocument();
  });

  it('無選項商品可直接加入購物車（數量 1、無選項）', async () => {
    const u = userEvent.setup();
    const api = createFakeApi({
      me: { favorites: { list: async () => ({ productIds: ['p_lurou'] }) } },
      store: { getMenu: async () => menu },
    });
    renderWithProviders(<FavoritesPage />, { api });
    await u.click(await screen.findByRole('button', { name: '將 招牌滷肉飯 加入購物車' }));
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useCartStore.getState().lines[0]).toMatchObject({
      productId: 'p_lurou',
      quantity: 1,
      optionIds: [],
    });
    expect(await screen.findByText('已加入購物車：招牌滷肉飯')).toBeInTheDocument();
  });

  it('取消收藏：樂觀更新，立即從清單移除並呼叫 me.favorites.remove', async () => {
    const u = userEvent.setup();
    let ids = ['p_lurou', 'p_noodle'];
    const remove = vi.fn(async (id: string) => {
      ids = ids.filter((x) => x !== id);
    });
    const api = createFakeApi({
      me: { favorites: { list: async () => ({ productIds: [...ids] }), remove } },
      store: { getMenu: async () => menu },
    });
    renderWithProviders(<FavoritesPage />, { api });
    await u.click(await screen.findByRole('button', { name: '取消收藏 招牌滷肉飯' }));
    await waitFor(() => expect(screen.queryByText('招牌滷肉飯')).not.toBeInTheDocument());
    expect(remove).toHaveBeenCalledWith('p_lurou');
    expect(screen.getByText('紅燒牛肉麵')).toBeInTheDocument();
  });

  it('空狀態：還沒有收藏', async () => {
    const api = createFakeApi({
      me: { favorites: { list: async () => ({ productIds: [] }) } },
      store: { getMenu: async () => menu },
    });
    renderWithProviders(<FavoritesPage />, { api });
    expect(await screen.findByText('還沒有收藏')).toBeInTheDocument();
    expect(screen.getByText('點商品右上角的愛心加入')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '去逛菜單' })).toHaveAttribute('href', '/');
  });
});

function hookWrapper(api: ReturnType<typeof createFakeApi>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <ToastProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </ToastProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
  return { wrapper, queryClient };
}

describe('useFavorites', () => {
  it('訪客：isAvailable 為 false，不呼叫 API；toggle 只顯示登入提示 Toast', async () => {
    useSessionStore.getState().clear();
    const list = vi.fn();
    const add = vi.fn();
    const { wrapper } = hookWrapper(createFakeApi({ me: { favorites: { list, add } } }));
    const { result } = renderHook(() => useFavorites(), { wrapper });
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.productIds.size).toBe(0);
    await act(async () => {
      await result.current.toggle('p_lurou');
    });
    expect(list).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('會員：載入收藏清單，toggle 為樂觀更新並呼叫 add / remove', async () => {
    const list = vi.fn(async () => ({ productIds: ['p_a'] }));
    const add = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const { wrapper } = hookWrapper(createFakeApi({ me: { favorites: { list, add, remove } } }));
    const { result } = renderHook(() => useFavorites(), { wrapper });
    await waitFor(() => expect(result.current.isFavorite('p_a')).toBe(true));
    expect(result.current.isAvailable).toBe(true);

    await act(async () => {
      await result.current.toggle('p_b');
    });
    expect(add).toHaveBeenCalledWith('p_b');
    await act(async () => {
      await result.current.toggle('p_a');
    });
    expect(remove).toHaveBeenCalledWith('p_a');
  });

  it('更新失敗：回復原狀態', async () => {
    const list = vi.fn(async () => ({ productIds: ['p_a'] }));
    const add = vi.fn(async () => {
      throw new Error('network');
    });
    const { wrapper } = hookWrapper(
      createFakeApi({ me: { favorites: { list, add, remove: async () => undefined } } }),
    );
    const { result } = renderHook(() => useFavorites(), { wrapper });
    await waitFor(() => expect(result.current.isFavorite('p_a')).toBe(true));
    await act(async () => {
      await result.current.toggle('p_b');
    });
    await waitFor(() => expect(result.current.isFavorite('p_b')).toBe(false));
    expect(result.current.isFavorite('p_a')).toBe(true);
  });
});
