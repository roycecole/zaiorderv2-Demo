// src/app/router.tsx —— 路由表與守衛（03 §3.2、07 §8）
//
// 版面：AppShell（一般頁）與 TaskLayout（結帳 / 付款 / 訂單詳情）為兄弟版面；
// 頁面一律 lazy 載入（路由層級切分，非關鍵路徑不進首屏 bundle）。
import type { ComponentType } from 'react';
import { createBrowserRouter, createHashRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { env } from '@/config/env';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { NotFoundPage } from '@/features/static/NotFoundPage';
import { RouteErrorPage } from '@/features/static/RouteErrorPage';
import { AppShell } from './layouts/AppShell';
import { RouteFallback } from './layouts/RouteFallback';
import { TaskLayout } from './layouts/TaskLayout';
import { ROUTES } from './routes';

/** 把「具名匯出的頁面元件」轉成路由的 lazy 載入 */
function page<M extends Record<string, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
): NonNullable<RouteObject['lazy']> {
  return async () => ({ Component: (await load())[name] as ComponentType });
}

export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage standalone />,
    // 首次載入時等路由 chunk 的畫面；沒有它整頁會空白，React Router 也會在主控台警告
    HydrateFallback: RouteFallback,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, lazy: page(() => import('@/features/menu/MenuPage'), 'MenuPage') },
          { path: 'cart', lazy: page(() => import('@/features/cart/CartPage'), 'CartPage') },
          { path: 'store', lazy: page(() => import('@/features/store/StorePage'), 'StorePage') },
          { path: 'login', lazy: page(() => import('@/features/auth/LoginPage'), 'LoginPage') },
          {
            element: <RequireAuth />,
            children: [
              { path: 'account', lazy: page(() => import('@/features/account/AccountPage'), 'AccountPage') },
              {
                path: 'account/profile',
                lazy: page(() => import('@/features/account/ProfilePage'), 'ProfilePage'),
              },
              {
                path: 'account/addresses',
                lazy: page(() => import('@/features/account/AddressesPage'), 'AddressesPage'),
              },
              {
                path: 'account/favorites',
                lazy: page(() => import('@/features/account/FavoritesPage'), 'FavoritesPage'),
              },
              {
                path: 'account/coupons',
                lazy: page(() => import('@/features/account/CouponsPage'), 'CouponsPage'),
              },
            ],
          },
          { path: 'orders', lazy: page(() => import('@/features/orders/OrdersPage'), 'OrdersPage') },
          {
            path: 'orders/lookup',
            lazy: page(() => import('@/features/orders/OrderLookupPage'), 'OrderLookupPage'),
          },
          { path: 'privacy', lazy: page(() => import('@/features/static/PrivacyPage'), 'PrivacyPage') },
          { path: 'terms', lazy: page(() => import('@/features/static/TermsPage'), 'TermsPage') },
          { path: '*', Component: NotFoundPage },
        ],
      },
      {
        element: <TaskLayout backTo={ROUTES.cart} />,
        children: [
          {
            path: 'checkout',
            lazy: page(() => import('@/features/checkout/CheckoutPage'), 'CheckoutPage'),
          },
        ],
      },
      {
        element: <TaskLayout backTo={ROUTES.home} />,
        children: [
          {
            path: 'payment/:orderId',
            lazy: page(() => import('@/features/checkout/PaymentPage'), 'PaymentPage'),
          },
          {
            path: 'orders/:orderId',
            lazy: page(() => import('@/features/orders/OrderPage'), 'OrderPage'),
          },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  if (env.routerMode === 'hash') return createHashRouter(routes);
  const basename = env.basePath.replace(/\/+$/, '');
  return createBrowserRouter(routes, { basename: basename === '' ? undefined : basename });
}
