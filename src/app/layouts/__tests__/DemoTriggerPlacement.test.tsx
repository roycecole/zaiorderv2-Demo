// Demo 入口（DemoTrigger）在頂部列的位置：一般頁面、任務型頁面、觸控面板預覽；非 Demo 建置 / HTTP 模式不出現
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetA11yState } from '@/features/a11y/__tests__/helpers';
import { createFakeDemo } from '@/features/demo/__tests__/demoTestUtils';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { makeStatus, makeStoreInfo } from '@/features/store/__tests__/fixtures';
import type { ApiClient } from '@/services/api/ApiClient';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AppShell, TaskLayout, usePageTitle } from '../index';
import { pageTitleStore } from '../pageTitle';

// 可在測試中切換的 Demo 建置旗標（DemoTrigger 在渲染時才讀取 env.demoMode）
const flags = vi.hoisted(() => ({ demoMode: true }));
vi.mock('@/config/env', async (importOriginal) => {
  const actual = (await importOriginal<{ env: object }>()).env;
  return {
    env: new Proxy(actual, {
      get: (target, prop, receiver) =>
        prop === 'demoMode' ? flags.demoMode : Reflect.get(target, prop, receiver),
    }),
  };
});
// 外殼在 Demo 建置會動態載入 DemoRoot；這裡只關心頂部列的入口
vi.mock('@/features/demo/DemoRoot', () => ({ default: () => null }));

function Page({ title }: { title: string }) {
  usePageTitle(title);
  return <h1>{title}</h1>;
}

function Tree() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Page title="菜單" />} />
      </Route>
      <Route element={<TaskLayout />}>
        <Route path="checkout" element={<Page title="結帳" />} />
      </Route>
    </Routes>
  );
}

const storeApi = {
  store: {
    getInfo: async () => makeStoreInfo(),
    getStatus: async () => makeStatus(),
  },
};

/** Mock 模式：ApiClient 帶有 DemoControl */
const mockModeApi = (): ApiClient =>
  ({ ...storeApi, demo: createFakeDemo() }) as unknown as ApiClient;
/** HTTP 模式：沒有 DemoControl */
const httpModeApi = (): ApiClient => storeApi as unknown as ApiClient;

const TRIGGER = { name: /^Demo 工具/ };

beforeEach(() => {
  flags.demoMode = true;
  resetA11yState();
  pageTitleStore.setState({ title: null, storeName: null });
  document.documentElement.removeAttribute('style');
});
afterEach(() => {
  document.documentElement.removeAttribute('data-mode');
});

/** 頂部列內「可操作元件」的名稱（DOM 順序 = Tab 順序） */
const tabOrder = (header: HTMLElement): (string | null)[] =>
  within(header)
    .queryAllByRole('button')
    .concat(within(header).queryAllByRole('link'))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((el) => el.getAttribute('aria-label') ?? el.textContent);

describe('一般頁面（ShellHeader）', () => {
  it('入口在右側群組：登入之後、⌨ 之前（Tab 順序 = 視覺順序）', async () => {
    renderWithProviders(<Tree />, { api: mockModeApi() });
    await screen.findByRole('heading', { name: '菜單' });
    const header = screen.getByRole('banner');
    const names = tabOrder(header);
    const at = (name: string | RegExp): number =>
      names.findIndex((n) => (typeof name === 'string' ? n === name : n !== null && name.test(n)));
    expect(at(/^Demo 工具/)).toBeGreaterThan(at('登入'));
    expect(at(/^Demo 工具/)).toBe(at('鍵盤快速鍵與偏好') - 1);
    expect(within(header).getAllByRole('button', TRIGGER)).toHaveLength(1);
    // 購物車圖示仍在入口之前（< 768 為 購物車、Demo）
    expect(at(/^購物車/)).toBeLessThan(at(/^Demo 工具/));
  });

  it('入口只在頂部列：頁面其他地方沒有第二個入口', async () => {
    renderWithProviders(<Tree />, { api: mockModeApi() });
    await screen.findByRole('heading', { name: '菜單' });
    expect(screen.getAllByRole('button', TRIGGER)).toHaveLength(1);
    expect(within(screen.getByRole('main')).queryByRole('button', TRIGGER)).toBeNull();
  });

  it('點入口切換 useInputModeStore.demoPanelOpen，aria-expanded 同步', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Tree />, { api: mockModeApi() });
    await screen.findByRole('heading', { name: '菜單' });
    const trigger = screen.getByRole('button', TRIGGER);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(useInputModeStore.getState().demoPanelOpen).toBe(true);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(trigger);
    expect(useInputModeStore.getState().demoPanelOpen).toBe(false);
  });

  it('觸控面板預覽：入口仍在（才能用面板把輸入模式切回「自動」），位於「大字」之後；沒有 ⌨', async () => {
    renderWithProviders(<Tree />, { api: mockModeApi() });
    await screen.findByRole('heading', { name: '菜單' });
    act(() => useInputModeStore.getState().setInputMode('KIOSK'));
    const header = screen.getByRole('banner');
    const names = tabOrder(header);
    expect(names).toContain('大字');
    expect(names.indexOf('大字')).toBeLessThan(names.findIndex((n) => /^Demo 工具/.test(n ?? '')));
    expect(within(header).getAllByRole('button', TRIGGER)).toHaveLength(1);
    expect(within(header).queryByRole('button', { name: '鍵盤快速鍵與偏好' })).toBeNull();
  });
});

describe('任務型頁面（TaskHeader：結帳、付款、訂單詳情）', () => {
  it('入口在頁名之後、⌨ 之前；返回鈕仍是第一個', async () => {
    renderWithProviders(<Tree />, { api: mockModeApi(), route: '/checkout' });
    await screen.findByRole('heading', { name: '結帳' });
    const header = screen.getByRole('banner');
    const names = tabOrder(header);
    expect(names[0]).toBe('返回');
    expect(names.at(-2)).toMatch(/^Demo 工具/);
    expect(names.at(-1)).toBe('鍵盤快速鍵與偏好');
    expect(within(header).getAllByRole('button', TRIGGER)).toHaveLength(1);
  });

  it('觸控面板預覽：入口仍在，沒有 ⌨', async () => {
    renderWithProviders(<Tree />, { api: mockModeApi(), route: '/checkout' });
    await screen.findByRole('heading', { name: '結帳' });
    act(() => useInputModeStore.getState().setInputMode('KIOSK'));
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('button', TRIGGER)).toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: '鍵盤快速鍵與偏好' })).toBeNull();
  });
});

describe('不出現的情況', () => {
  it('非 Demo 建置（env.demoMode = false）：兩種頂部列都沒有入口', async () => {
    flags.demoMode = false;
    const first = renderWithProviders(<Tree />, { api: mockModeApi() });
    await screen.findByRole('heading', { name: '菜單' });
    expect(screen.queryByRole('button', TRIGGER)).toBeNull();
    first.unmount();

    renderWithProviders(<Tree />, { api: mockModeApi(), route: '/checkout' });
    await screen.findByRole('heading', { name: '結帳' });
    expect(screen.queryByRole('button', TRIGGER)).toBeNull();
  });

  it('HTTP 模式（沒有 DemoControl）：即使是 Demo 建置也沒有入口', async () => {
    renderWithProviders(<Tree />, { api: httpModeApi() });
    await screen.findByRole('heading', { name: '菜單' });
    expect(screen.queryByRole('button', TRIGGER)).toBeNull();
  });
});
