// src/features/static/AppErrorBoundary.tsx —— 根部錯誤邊界（PG-17「全域錯誤邊界」）
//
// 放在整個 app 最外層（路由器與 Provider 之外也可），因此不使用任何 router / query hook：
// 「回首頁」是一般連結（含 basePath 與 hash 路由模式）。顯示「發生了一點問題」+ 重新整理 + 參考編號。
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { env } from '@/config/env';
import { ErrorView } from './ErrorView';

export interface AppErrorBoundaryProps {
  children: ReactNode;
  /** 回報錯誤（例如事件追蹤，FR-SY-10）；不得含個資 */
  onError?: (error: unknown, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: unknown;
}

/** 首頁網址：含部署基底路徑；hash 路由模式為 `#/` */
export function homeHref(): string {
  const base = env.basePath.endsWith('/') ? env.basePath : `${env.basePath}/`;
  return env.routerMode === 'hash' ? `${base}#/` : base;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, State> {
  override state: State = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[app-error]', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <ErrorView
        error={this.state.error}
        standalone
        homeLink={(className, children) => (
          <a href={homeHref()} className={className}>
            {children}
          </a>
        )}
      />
    );
  }
}
