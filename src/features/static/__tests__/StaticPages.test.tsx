import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageTitleStore } from '@/app/layouts/pageTitle';
import { AppErrorBoundary } from '../AppErrorBoundary';
import { NotFoundPage } from '../NotFoundPage';
import { PrivacyPage } from '../PrivacyPage';
import { RouteErrorPage } from '../RouteErrorPage';
import { TermsPage } from '../TermsPage';

beforeEach(() => {
  pageTitleStore.setState({ title: null, storeName: null });
});

describe('PrivacyPage / TermsPage（PG-16）', () => {
  it('隱私權政策：一個 h1、章節為 h2、涵蓋個資法要項、標示為示範用', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: '隱私權政策' })).toBeInTheDocument();
    expect(screen.getByText('示範用內容，非正式條款')).toBeInTheDocument();
    expect(screen.getByText(/不構成法律文件/)).toBeInTheDocument();
    for (const heading of [
      '蒐集之目的',
      '個人資料之類別',
      '利用期間、地區、對象及方式',
      '當事人權利行使方式',
    ]) {
      expect(
        screen.getByRole('heading', { level: 2, name: new RegExp(heading) }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(pageTitleStore.getState().title).toBe('隱私權政策');
  });

  it('服務條款：標示為示範用，回菜單連結', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: '服務條款' })).toBeInTheDocument();
    expect(screen.getByText('示範用內容，非正式條款')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回菜單' })).toHaveAttribute('href', '/');
  });

  it('章節目錄不改變網址 hash，並把焦點移到該章節標題', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('link', { name: /二、訂單與價格/ }));
    expect(screen.getByRole('heading', { level: 2, name: /二、訂單與價格/ })).toHaveFocus();
    expect(window.location.hash).toBe('');
  });
});

describe('NotFoundPage（PG-17）', () => {
  it('「找不到這個頁面」與「回到菜單」', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: '找不到這個頁面' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到菜單' })).toHaveAttribute('href', '/');
  });
});

describe('AppErrorBoundary', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  function Boom({ error }: { error: unknown }): never {
    throw error;
  }

  it('沒有錯誤時原樣渲染子元素', () => {
    render(
      <AppErrorBoundary>
        <p>正常內容</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText('正常內容')).toBeInTheDocument();
  });

  it('根部錯誤：「發生了一點問題」+ 重新整理 + 回首頁；不暴露技術細節', () => {
    const onError = vi.fn();
    render(
      <AppErrorBoundary onError={onError}>
        <Boom error={new TypeError("Cannot read properties of undefined (reading 'x')")} />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '發生了一點問題' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新整理' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回首頁' })).toBeInTheDocument();
    expect(screen.queryByText(/Cannot read/)).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('具有 requestId 的 API 錯誤：顯示參考編號與已知錯誤碼的文案', () => {
    const apiError = Object.assign(new Error('boom'), {
      code: 'SERVICE_UNAVAILABLE',
      body: { requestId: 'req-123' },
    });
    render(
      <AppErrorBoundary>
        <Boom error={apiError} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText('req-123')).toBeInTheDocument();
    expect(screen.getByText('網路好像不太穩，請稍後再試')).toBeInTheDocument();
  });
});

describe('RouteErrorPage', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  function Thrower(): never {
    throw new Error('內部錯誤');
  }

  it('路由元件擲錯：顯示錯誤畫面、重試與回首頁', async () => {
    const router = createMemoryRouter(
      [
        { path: '/', element: <p>首頁</p> },
        { path: '/bad', element: <Thrower />, errorElement: <RouteErrorPage /> },
      ],
      { initialEntries: ['/bad'] },
    );
    const user = userEvent.setup();
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: '發生了一點問題' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新整理' })).toBeInTheDocument();
    expect(screen.queryByText('內部錯誤')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '回首頁' }));
    expect(await screen.findByText('首頁')).toBeInTheDocument();
  });

  it('404 型路由錯誤改顯示找不到頁面', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <p>首頁</p>,
          errorElement: <RouteErrorPage />,
          children: [
            {
              path: 'x',
              loader: () => {
                throw new Response('Not Found', { status: 404 });
              },
              element: <p>不會顯示</p>,
            },
          ],
        },
      ],
      { initialEntries: ['/x'] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: '找不到這個頁面' })).toBeInTheDocument();
    expect(within(document.body).getByRole('link', { name: '回到菜單' })).toBeInTheDocument();
  });
});
