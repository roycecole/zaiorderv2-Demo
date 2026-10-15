// 會員專屬路由守衛：未登入導向 /login?redirect=…（保留路徑與查詢）
import { screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RequireAuth } from '../RequireAuth';
import { useSessionStore } from '../sessionStore';

function Probe() {
  const loc = useLocation();
  return <p data-testid="login-location">{`${loc.pathname}${loc.search}`}</p>;
}

function renderGuarded(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Probe />} />
      <Route element={<RequireAuth />}>
        <Route path="/account" element={<p>會員中心內容</p>} />
        <Route path="/account/coupons" element={<p>優惠券內容</p>} />
      </Route>
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  useSessionStore.getState().clear();
});

describe('RequireAuth', () => {
  it('未登入：導向登入頁並保留原路徑與查詢', () => {
    renderGuarded('/account/coupons?tab=used');
    expect(screen.queryByText('優惠券內容')).not.toBeInTheDocument();
    expect(screen.getByTestId('login-location')).toHaveTextContent(
      '/login?redirect=%2Faccount%2Fcoupons%3Ftab%3Dused',
    );
  });

  it('已登入：渲染子路由', () => {
    useSessionStore.getState().setSession(
      { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
      {
        id: 'usr_1',
        phone: '0912345678',
        marketingOptIn: false,
        createdAt: '2026-10-01T00:00:00+08:00',
      },
    );
    renderGuarded('/account');
    expect(screen.getByText('會員中心內容')).toBeInTheDocument();
  });
});
