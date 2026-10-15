// src/features/static/index.ts —— 靜態頁與錯誤頁（PG-16、PG-17）
// 頁面元件為具名 export；路由器請以 lazy 直接引用各檔案以分割 chunk。
export { AppErrorBoundary, homeHref } from './AppErrorBoundary';
export type { AppErrorBoundaryProps } from './AppErrorBoundary';
export { ErrorView, requestIdOf } from './ErrorView';
export { NotFoundPage } from './NotFoundPage';
export { PrivacyPage } from './PrivacyPage';
export { RouteErrorPage } from './RouteErrorPage';
export type { RouteErrorPageProps } from './RouteErrorPage';
export { TermsPage } from './TermsPage';
