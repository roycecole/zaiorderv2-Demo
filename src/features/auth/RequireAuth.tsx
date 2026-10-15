// src/features/auth/RequireAuth.tsx —— 會員專屬路由的守衛（07 §8；BR-33：只用於歷史訂單、地址簿、最愛、優惠券等會員功能）
import { Navigate, Outlet, useLocation } from 'react-router';
import { buildLoginUrl } from './safeRedirect';
import { selectIsLoggedIn, useSessionStore } from './sessionStore';

/**
 * 以巢狀路由的 layout 使用：`<Route element={<RequireAuth />}> …子路由… </Route>`。
 * 未登入時導向 `/login?redirect=<原路徑>`（replace，返回鍵不會停在被擋下的頁面）。
 */
export function RequireAuth() {
  const isLoggedIn = useSessionStore(selectIsLoggedIn);
  const location = useLocation();
  if (!isLoggedIn) {
    return (
      <Navigate to={buildLoginUrl(`${location.pathname}${location.search}`)} replace />
    );
  }
  return <Outlet />;
}
