// LoginPage 以 usePageTitle 宣告頁名；只有一個 h1
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { pageTitleStore } from '@/app/layouts/pageTitle';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { LoginPage } from '../LoginPage';
import { useSessionStore } from '../sessionStore';

beforeEach(() => {
  pageTitleStore.setState({ title: null });
  useSessionStore.getState().clear();
});

describe('usePageTitle：LoginPage', () => {
  it('頁名為「登入會員」，只有一個 h1', () => {
    renderWithProviders(<LoginPage />, { api: createFakeApi() });
    expect(pageTitleStore.getState().title).toBe('登入會員');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
