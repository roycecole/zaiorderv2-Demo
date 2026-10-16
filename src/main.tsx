import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app/App';
import { startApiBootstrap } from './app/providers';

// 在 React 開始渲染之前就啟動資料來源與預取：下載與請求跟首次渲染平行進行（NFR-03）
void startApiBootstrap();

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
