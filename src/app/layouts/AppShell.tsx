// src/app/layouts/AppShell.tsx —— 一般頁面的外殼（菜單、購物車、店家資訊、會員中心、靜態頁…）
import { ShellFrame } from './ShellFrame';

/**
 * 路由器的根版面（`<Outlet />` 渲染子路由）。包含：頂部列、跳過連結、鍵盤提醒、公告橫幅、
 * `<main id="main">`、頁尾、手機底部 Tab、主題、快速鍵與即時通報；觸控面板模式渲染 IdleGuard，Demo 模式載入 DemoRoot。
 * 需在 `ToastProvider`、`QueryClientProvider`、`ApiProvider` 與路由器之內。
 */
export function AppShell() {
  return <ShellFrame variant="app" />;
}
