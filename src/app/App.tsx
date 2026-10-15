// src/app/App.tsx —— 應用程式根：資料來源啟動 → Provider → 路由
import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { Spinner } from '@/components';
import { env } from '@/config/env';
import { useSessionBootstrap } from '@/features/auth/useSessionBootstrap';
import { AppErrorBoundary } from '@/features/static/AppErrorBoundary';
import { ErrorView } from '@/features/static/ErrorView';
import { t } from '@/i18n/zh-TW';
import { AppProviders, useApiBootstrap } from './providers';
import { createAppRouter } from './router';

function AppRoutes() {
  // 啟動時還原會員 Session（07 §7.1）；訪客直接視為完成，不阻擋畫面
  useSessionBootstrap();
  const [router] = useState(createAppRouter);
  return <RouterProvider router={router} />;
}

export function App() {
  const boot = useApiBootstrap();

  if (boot.status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <Spinner size="lg" label={t.common.loading} />
      </div>
    );
  }
  if (boot.status === 'error') {
    return (
      <ErrorView
        error={boot.error}
        standalone
        onRetry={() => window.location.reload()}
        homeLink={(className, children) => (
          <a href={env.basePath} className={className}>
            {children}
          </a>
        )}
      />
    );
  }
  return (
    <AppErrorBoundary>
      <AppProviders client={boot.client}>
        <AppRoutes />
      </AppProviders>
    </AppErrorBoundary>
  );
}
