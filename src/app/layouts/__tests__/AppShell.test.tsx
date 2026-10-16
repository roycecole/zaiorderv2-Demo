import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetA11yState, stubViewportWidth } from '@/features/a11y/__tests__/helpers';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { makeStatus, makeStoreInfo } from '@/features/store/__tests__/fixtures';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AppShell, TaskLayout, TopbarSlot, usePageTitle } from '../index';
import { pageTitleStore } from '../pageTitle';

function Page({ title, children }: { title: string; children?: ReactNode }) {
  usePageTitle(title);
  return (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

function Tree() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <Page title="菜單">
              <TopbarSlot>
                <input type="search" aria-label="搜尋菜單" />
              </TopbarSlot>
              <Link to="/store">前往店家</Link>
              <Link to="/checkout">前往結帳</Link>
            </Page>
          }
        />
        <Route path="store" element={<Page title="店家資訊" />} />
      </Route>
      <Route element={<TaskLayout />}>
        <Route path="checkout" element={<Page title="結帳" />} />
      </Route>
    </Routes>
  );
}

const api = createFakeApi({
  store: {
    getInfo: async () => makeStoreInfo(),
    getStatus: async () => makeStatus(),
  },
});

function renderTree(route = '/') {
  return renderWithProviders(<Tree />, { api, route });
}

const html = document.documentElement;

beforeEach(() => {
  resetA11yState();
  useSessionStore.getState().clear();
  pageTitleStore.setState({ title: null, storeName: null });
  html.removeAttribute('style');
});
afterEach(() => {
  html.removeAttribute('data-mode');
  html.removeAttribute('data-textscale');
  html.removeAttribute('data-motion');
});

describe('AppShell：<html> 屬性（03 §5.6、§10.5）', () => {
  it('預設沒有 data-mode / data-textscale / data-motion；偏好改變即時寫入', async () => {
    renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    expect(html).not.toHaveAttribute('data-mode');
    expect(html).not.toHaveAttribute('data-textscale');
    expect(html).not.toHaveAttribute('data-motion');

    act(() => usePrefsStore.getState().patch({ largeText: true, reduceMotion: true }));
    expect(html).toHaveAttribute('data-textscale', '1');
    expect(html).toHaveAttribute('data-motion', 'on');

    act(() => useInputModeStore.getState().setInputMode('KIOSK'));
    expect(html).toHaveAttribute('data-mode', 'kiosk');

    act(() => {
      useInputModeStore.getState().setInputMode('AUTO');
      usePrefsStore.getState().patch({ largeText: false, reduceMotion: false });
    });
    expect(html).not.toHaveAttribute('data-mode');
    expect(html).not.toHaveAttribute('data-textscale');
    expect(html).not.toHaveAttribute('data-motion');
  });

  it('品牌色寫入 :root；Demo 預覽色（themeOverride）優先', async () => {
    renderTree();
    await waitFor(() => expect(html.style.getPropertyValue('--color-brand')).toBe('#D93A22'));
    act(() => useInputModeStore.getState().setThemeOverride('#1D4ED8'));
    await waitFor(() => expect(html.style.getPropertyValue('--color-brand')).toBe('#1D4ED8'));
  });
});

describe('AppShell：結構與入口', () => {
  it('地標：banner、main（id=main，含 h1）、contentinfo；店名與營業狀態', async () => {
    renderTree();
    const main = await screen.findByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(within(main).getByRole('heading', { level: 1, name: '菜單' })).toBeInTheDocument();
    const banner = screen.getByRole('banner');
    expect(
      await within(banner).findByRole('link', { name: '店家資訊：巷仔內小吃部' }),
    ).toHaveAttribute('href', '/store');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('營業狀態徽章：首頁由頁內的店家資訊列呈現（頂部列不重複），其他頁在頂部列（≥ 768）', async () => {
    const first = renderTree('/');
    await screen.findByRole('heading', { name: '菜單' });
    await within(screen.getByRole('banner')).findByRole('link', { name: '店家資訊：巷仔內小吃部' });
    expect(within(screen.getByRole('banner')).queryByText(/營業中/)).not.toBeInTheDocument();
    first.unmount();

    renderTree('/store');
    await screen.findByRole('heading', { name: '店家資訊' });
    expect(await within(screen.getByRole('banner')).findByText(/營業中/)).toBeInTheDocument();
  });

  it('手機寬度：跳過連結為「跳到主要內容」「鍵盤快速鍵與偏好」；有底部 Tab', async () => {
    renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    const links = screen.getAllByRole('link', { name: /跳到|鍵盤快速鍵與偏好/ });
    expect(links.map((l) => l.textContent)).toEqual(['跳到主要內容', '鍵盤快速鍵與偏好']);
    const tabs = screen.getByRole('navigation', { name: '主要導覽' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['菜單', '訂單', '我的']);
    expect(within(tabs).getByRole('link', { name: '菜單' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('≥ 1024 的菜單頁多一個「跳到購物車」，順序為 主要內容 → 購物車 → 快速鍵與偏好；其他頁面沒有', async () => {
    const restore = stubViewportWidth(1280);
    try {
      const { unmount } = renderTree('/');
      await screen.findByRole('heading', { name: '菜單' });
      const names = (): (string | null)[] =>
        screen.getAllByRole('link', { name: /^跳到|^鍵盤快速鍵與偏好$/ }).map((l) => l.textContent);
      expect(names()).toEqual(['跳到主要內容', '跳到購物車', '鍵盤快速鍵與偏好']);
      unmount();

      renderTree('/store');
      await screen.findByRole('heading', { name: '店家資訊' });
      expect(names()).toEqual(['跳到主要內容', '鍵盤快速鍵與偏好']);
    } finally {
      restore();
    }
  });

  it('「跳到主要內容」把焦點移到 main；「鍵盤快速鍵與偏好」開啟 PG-19', async () => {
    const user = userEvent.setup();
    renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    await user.click(screen.getByRole('link', { name: '跳到主要內容' }));
    expect(screen.getByRole('main')).toHaveFocus();

    await user.click(screen.getByRole('link', { name: '鍵盤快速鍵與偏好' }));
    expect(await screen.findByRole('dialog', { name: '鍵盤快速鍵與偏好' })).toBeInTheDocument();
  });

  it('頂部 ⌨ 按鈕開啟 PG-19；提醒收起後顯示小圓點並補「，有新提示」', async () => {
    const user = userEvent.setup();
    renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    const banner = screen.getByRole('banner');
    const help = within(banner).getByRole('button', { name: '鍵盤快速鍵與偏好' });
    await user.click(help);
    expect(await screen.findByRole('dialog', { name: '鍵盤快速鍵與偏好' })).toBeInTheDocument();
  });

  it('訪客顯示「查詢訂單」「登入」（ghost 連結）；會員顯示「我的訂單」與姓名', async () => {
    const { unmount } = renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: '查詢訂單' })).toHaveAttribute(
      'href',
      '/orders/lookup',
    );
    expect(within(banner).getByRole('link', { name: '登入' })).toHaveAttribute('href', '/login');
    unmount();

    act(() =>
      useSessionStore
        .getState()
        .setSession({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 } as never, {
          id: 'u1',
          phone: '0912345678',
          name: '小怡',
          marketingOptIn: false,
          createdAt: '2026-01-01T00:00:00+08:00',
        }),
    );
    renderTree();
    const banner2 = await screen.findByRole('banner');
    expect(within(banner2).getByRole('link', { name: '我的訂單' })).toHaveAttribute(
      'href',
      '/orders',
    );
    expect(within(banner2).getByRole('link', { name: '小怡' })).toHaveAttribute('href', '/account');
  });

  it('頁尾：店家資訊、隱私權、條款、鍵盤快速鍵、偏好設定；點「鍵盤快速鍵」開啟 PG-19', async () => {
    const user = userEvent.setup();
    renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: '隱私權政策' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(within(footer).getByRole('link', { name: '服務條款' })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(within(footer).getByRole('link', { name: '店家資訊' })).toHaveAttribute(
      'href',
      '/store',
    );
    expect(within(footer).getByRole('button', { name: '偏好設定' })).toBeInTheDocument();
    await user.click(within(footer).getByRole('button', { name: '鍵盤快速鍵' }));
    expect(await screen.findByRole('dialog', { name: '鍵盤快速鍵與偏好' })).toBeInTheDocument();
  });

  it('外殼不顯示店家公告：公告只放在首頁，與整頁內容一起出現（避免事後把內容往下推，CLS）', async () => {
    renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    expect(screen.queryByRole('region', { name: '店家公告' })).not.toBeInTheDocument();
  });

  it('TopbarSlot：頁面內容被傳送到頂部列', async () => {
    renderTree();
    const input = await screen.findByLabelText('搜尋菜單');
    expect(screen.getByRole('banner')).toContainElement(input);
  });

  it('鍵盤提醒在 DOM 中位於跳過連結之後、頂部列之前', async () => {
    renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' });
    // 合成事件預設不可信（isTrusted = false），不應出現提醒
    expect(screen.queryByRole('group', { name: '鍵盤快速鍵提醒' })).not.toBeInTheDocument();
    const skip = screen.getByRole('link', { name: '跳到主要內容' });
    const banner = screen.getByRole('banner');
    expect(skip.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('AppShell：路由變更（03 §10.2、§10.4）', () => {
  it('更新 document.title、焦點移到新頁面 h1、播報頁名', async () => {
    const user = userEvent.setup();
    renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    await waitFor(() => expect(document.title).toBe('菜單｜巷仔內小吃部'));

    await user.click(screen.getByRole('link', { name: '前往店家' }));
    const h1 = await screen.findByRole('heading', { level: 1, name: '店家資訊' });
    await waitFor(() => expect(h1).toHaveFocus());
    await waitFor(() => expect(document.title).toBe('店家資訊｜巷仔內小吃部'));
    await waitFor(() =>
      expect(
        document.querySelector('[data-zo-live-announcer] [role="status"]')?.textContent,
      ).toContain('已前往：店家資訊'),
    );
  });

  it('首次載入不搶焦點', async () => {
    renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    expect(screen.getByRole('heading', { name: '菜單' })).not.toHaveFocus();
  });
});

describe('AppShell：外殼的快速鍵後備', () => {
  it('啟用後在店家頁按 m 回菜單', async () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    renderTree('/store');
    await screen.findByRole('heading', { name: '店家資訊' });
    fireEvent.keyDown(document.body, { key: 'm' });
    expect(await screen.findByRole('heading', { name: '菜單' })).toBeInTheDocument();
  });

  it('未啟用時單鍵不導覽', async () => {
    renderTree('/store');
    await screen.findByRole('heading', { name: '店家資訊' });
    fireEvent.keyDown(document.body, { key: 'm' });
    expect(screen.getByRole('heading', { name: '店家資訊' })).toBeInTheDocument();
  });
});

describe('AppShell：觸控面板模式（03 §5.6）', () => {
  it('隱藏登入、查詢訂單、⌨、鍵盤入口與底部 Tab；提供「大字」切換', async () => {
    act(() => useInputModeStore.getState().setInputMode('KIOSK'));
    const user = userEvent.setup();
    renderTree();
    await screen.findByRole('heading', { name: '菜單' });
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByRole('link', { name: '登入' })).not.toBeInTheDocument();
    expect(within(banner).queryByRole('link', { name: '查詢訂單' })).not.toBeInTheDocument();
    expect(
      within(banner).queryByRole('button', { name: /鍵盤快速鍵與偏好/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '鍵盤快速鍵與偏好' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('contentinfo')).queryByRole('button', { name: '鍵盤快速鍵' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '主要導覽' })).not.toBeInTheDocument();

    const large = within(banner).getByRole('button', { name: '大字' });
    expect(large).toHaveAttribute('aria-pressed', 'false');
    await user.click(large);
    expect(usePrefsStore.getState().largeText).toBe(true);
    expect(html).toHaveAttribute('data-textscale', '1');
  });
});

describe('TaskLayout（03 §3.3）', () => {
  it('精簡頂部列：返回、頁名、⌨；沒有登入 / 查詢訂單 / 底部 Tab；保留跳過連結與頁尾入口', async () => {
    renderTree('/checkout');
    await screen.findByRole('heading', { name: '結帳' });
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('button', { name: '返回' })).toBeInTheDocument();
    expect(within(banner).getByText('結帳')).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: '鍵盤快速鍵與偏好' })).toBeInTheDocument();
    expect(within(banner).queryByRole('link', { name: '登入' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '主要導覽' })).not.toBeInTheDocument();

    const names = screen
      .getAllByRole('link', { name: /^跳到|^鍵盤快速鍵與偏好$/ })
      .map((l) => l.textContent);
    expect(names).toEqual(['跳到主要內容', '鍵盤快速鍵與偏好']);
    expect(
      within(screen.getByRole('contentinfo')).getByRole('button', { name: '鍵盤快速鍵' }),
    ).toBeInTheDocument();
  });

  it('返回鈕回到上一頁；沒有站內歷史時前往 backTo', async () => {
    const user = userEvent.setup();
    renderTree('/');
    await screen.findByRole('heading', { name: '菜單' });
    await user.click(screen.getByRole('link', { name: '前往結帳' }));
    await screen.findByRole('heading', { name: '結帳' });
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: '返回' }));
    expect(await screen.findByRole('heading', { name: '菜單' })).toBeInTheDocument();
  });

  it('直接開啟任務頁（沒有歷史）時返回鈕回菜單', async () => {
    const user = userEvent.setup();
    renderTree('/checkout');
    await screen.findByRole('heading', { name: '結帳' });
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: '返回' }));
    expect(await screen.findByRole('heading', { name: '菜單' })).toBeInTheDocument();
  });
});
