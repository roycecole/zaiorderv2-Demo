// PG-10 會員中心：個人摘要與入口、登出（確認 → auth.logout → 清除 Session）、刪除帳號（兩段確認）
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AccountPage } from '../AccountPage';
import { profile, tokens } from './fixtures';

function Probe() {
  const loc = useLocation();
  return <p data-testid="location">{loc.pathname}</p>;
}

function renderAccount(api = createFakeApi()) {
  return renderWithProviders(
    <Routes>
      <Route path="/account" element={<AccountPage />} />
      <Route path="*" element={<Probe />} />
    </Routes>,
    { api, route: '/account' },
  );
}

beforeEach(() => {
  useSessionStore.getState().setSession(tokens, profile);
  useCartStore.getState().clear();
});

describe('AccountPage', () => {
  it('顯示頭像字首、姓名、遮罩手機與各入口', () => {
    renderAccount();
    expect(screen.getByText('王小明')).toBeInTheDocument();
    expect(screen.getByText('0912***678')).toBeInTheDocument();
    expect(screen.queryByText('0912345678')).not.toBeInTheDocument();
    expect(screen.getByText('王')).toBeInTheDocument(); // 頭像字首
    const hrefOf = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href');
    expect(hrefOf(/歷史訂單/)).toBe('/orders');
    expect(hrefOf(/個人資料/)).toBe('/account/profile');
    expect(hrefOf(/地址簿/)).toBe('/account/addresses');
    expect(hrefOf(/我的最愛/)).toBe('/account/favorites');
    expect(hrefOf(/優惠券/)).toBe('/account/coupons');
    expect(hrefOf(/隱私權政策/)).toBe('/privacy');
  });

  it('尚未設定姓名時顯示說明與預設字首', () => {
    useSessionStore.getState().setSession(tokens, { ...profile, name: undefined });
    renderAccount();
    expect(screen.getByText('尚未設定姓名')).toBeInTheDocument();
    expect(screen.getByText('會')).toBeInTheDocument();
  });

  it('登出：確認後呼叫 auth.logout、清除 Session，購物車保留並回到首頁', async () => {
    const u = userEvent.setup();
    useCartStore.getState().addLine({
      productId: 'p1',
      quantity: 1,
      optionIds: [],
      snapshot: { name: '滷肉飯', unitPrice: 40, optionLabels: [] },
    });
    const logout = vi.fn().mockResolvedValue(undefined);
    renderAccount(createFakeApi({ auth: { logout } }));
    await u.click(screen.getByRole('button', { name: '登出' }));
    const dialog = await screen.findByRole('alertdialog', { name: '確定要登出嗎？' });
    // 預設焦點在較安全的「取消」
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus();
    await u.click(within(dialog).getByRole('button', { name: '登出' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(logout).toHaveBeenCalledWith('ref');
    expect(useSessionStore.getState().user).toBeNull();
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('取消登出：不呼叫 API', async () => {
    const u = userEvent.setup();
    const logout = vi.fn();
    renderAccount(createFakeApi({ auth: { logout } }));
    await u.click(screen.getByRole('button', { name: '登出' }));
    await u.click(await screen.findByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(logout).not.toHaveBeenCalled();
    expect(useSessionStore.getState().user).not.toBeNull();
  });

  it('刪除帳號需兩段確認：第二段須勾選「我了解」才會送出', async () => {
    const u = userEvent.setup();
    const remove = vi.fn().mockResolvedValue(undefined);
    renderAccount(createFakeApi({ me: { remove } }));
    await u.click(screen.getByRole('button', { name: '刪除帳號' }));

    const first = await screen.findByRole('alertdialog', { name: '確定要刪除帳號嗎？' });
    await u.click(within(first).getByRole('button', { name: '刪除帳號' }));

    const second = await screen.findByRole('alertdialog', { name: '最後確認' });
    await u.click(within(second).getByRole('button', { name: '確定刪除帳號' }));
    expect(remove).not.toHaveBeenCalled(); // 尚未勾選

    await u.click(within(second).getByRole('checkbox', { name: '我了解刪除後無法復原' }));
    await u.click(within(second).getByRole('button', { name: '確定刪除帳號' }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('刪除帳號失敗：保留 Session 並提示', async () => {
    const u = userEvent.setup();
    const remove = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { status: 500, code: 'INTERNAL_ERROR' }));
    renderAccount(createFakeApi({ me: { remove } }));
    await u.click(screen.getByRole('button', { name: '刪除帳號' }));
    await u.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '刪除帳號' }));
    const second = await screen.findByRole('alertdialog', { name: '最後確認' });
    await u.click(within(second).getByRole('checkbox'));
    await u.click(within(second).getByRole('button', { name: '確定刪除帳號' }));
    await waitFor(() => expect(remove).toHaveBeenCalled());
    expect(await screen.findByText('發生了一點問題，請稍後再試')).toBeInTheDocument();
    expect(useSessionStore.getState().user).not.toBeNull();
  });
});
