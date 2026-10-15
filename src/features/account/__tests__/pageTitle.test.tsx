// 會員中心各頁以 usePageTitle 宣告頁名；每頁只有一個 h1
import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { pageTitleStore } from '@/app/layouts/pageTitle';
import { useSessionStore } from '@/features/auth/sessionStore';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AccountPage } from '../AccountPage';
import { AddressesPage } from '../AddressesPage';
import { CouponsPage } from '../CouponsPage';
import { FavoritesPage } from '../FavoritesPage';
import { ProfilePage } from '../ProfilePage';
import { menuOf, profile, tokens } from './fixtures';

const api = createFakeApi({
  me: {
    get: async () => profile,
    addresses: { list: async () => ({ items: [] }) },
    favorites: { list: async () => ({ productIds: [] }) },
    coupons: { list: async () => ({ items: [] }) },
  },
  store: { getDeliveryZones: async () => ({ items: [] }), getMenu: async () => menuOf() },
});

beforeEach(() => {
  pageTitleStore.setState({ title: null });
  useSessionStore.getState().setSession(tokens, profile);
});

const CASES: Array<[string, ReactElement, string]> = [
  ['AccountPage', <AccountPage />, '會員中心'],
  ['ProfilePage', <ProfilePage />, '個人資料'],
  ['AddressesPage', <AddressesPage />, '地址簿'],
  ['FavoritesPage', <FavoritesPage />, '我的最愛'],
  ['CouponsPage', <CouponsPage />, '我的優惠券'],
];

describe('usePageTitle：會員中心各頁', () => {
  it.each(CASES)('%s 的頁名為「%s」且只有一個 h1', async (_name, element, title) => {
    renderWithProviders(element, { api });
    await waitFor(() => expect(pageTitleStore.getState().title).toBe(title));
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1));
  });
});
