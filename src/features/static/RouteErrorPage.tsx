// src/features/static/RouteErrorPage.tsx —— 路由錯誤邊界的畫面（PG-17）
//
// 用在資料路由器（createBrowserRouter / createHashRouter）的 `errorElement`；
// 路由器之外請改用 AppErrorBoundary。404 型錯誤（isRouteErrorResponse 且 status 404）改顯示找不到頁面。
import { useEffect } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { ROUTES } from '@/app/routes';
import { ErrorView } from './ErrorView';
import { NotFoundPage } from './NotFoundPage';

export interface RouteErrorPageProps {
  /** 獨立整頁（錯誤元件掛在根路由、沒有外殼）時為 true */
  standalone?: boolean;
  /** 自訂重試；預設重新整理頁面 */
  onRetry?: () => void;
}

export function RouteErrorPage({ standalone = false, onRetry }: RouteErrorPageProps) {
  const error = useRouteError();

  useEffect(() => {
    if (error !== undefined) console.error('[route-error]', error);
  }, [error]);

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;

  return (
    <ErrorView
      error={error}
      onRetry={onRetry}
      standalone={standalone}
      homeLink={(className, children) => (
        <Link to={ROUTES.home} className={className}>
          {children}
        </Link>
      )}
    />
  );
}
