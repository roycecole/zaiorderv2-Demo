// src/features/demo/DemoTrigger.tsx —— Demo 工具的頂部列入口（03 PG-18）
//
// 放在頂部列（ShellHeader 的右側群組、TaskHeader 的 ⌨ 旁），不浮動，所以不會蓋住商品卡、送出鈕或 CartBar。
// < 1024：僅圖示的圓形按鈕（44；觸控面板 56，即 --hit-size）；≥ 1024：「圖示 + Demo」膠囊（高 40，觸控面板 56）。
// 768–1023 仍用圓形：菜單頁的頂部列要放搜尋框，膠囊（95px）會把 768 的搜尋框從 251px 擠到 153px、placeholder 被截斷。
// 深色底（text / bg 反相，不使用品牌色），預覽主題色時仍保有辨識度。
// 垂直位置由頂部列的 `items-center` 決定，與其他圖示 / 按鈕同一條中線；< 768 的右緣補 8px，與內容區 16px 邊界對齊。
//
// 這個檔案會靜態匯入主 bundle：只可依賴輕量模組，不得匯入面板、DemoRoot 或 Radix（工具面板由 DemoRoot 延後載入）；
// 文案用獨立的 demoTrigger.ts，預備項數的計算用 armed.ts，不要改成匯入整份 demo.ts / scenario.ts。
// 面板開關的單一事實來源是 useInputModeStore.demoPanelOpen：DemoRoot 載入前被點了，載入後仍會開啟。
import clsx from 'clsx';
import { FlaskConical } from 'lucide-react';
import { useCallback, useSyncExternalStore } from 'react';
import { env } from '@/config/env';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { useDemoControl } from '@/hooks/useDemoControl';
import { demoTrigger as tTrigger } from '@/i18n/strings/demoTrigger';
import type { DemoControl } from '@/services/api/mock/demoControl';
import { armedItemCount } from './armed';
import { DEMO_PANEL_ID, DEMO_POLL_MS } from './constants';

/** 入口鈕只在 Demo 建置且為 Mock 模式（有 DemoControl）時出現；HTTP 模式與正式環境整個不渲染 */
export function DemoTrigger() {
  if (!env.demoMode) return null;
  return <DemoTriggerGate />;
}

function DemoTriggerGate() {
  const demo = useDemoControl();
  if (demo === null) return null;
  return <DemoTriggerButton demo={demo} />;
}

/**
 * 「下一次送出」預備項數。DemoControl 沒有訂閱機制：與 DemoRoot 相同每秒輪詢外部變更
 * （預備情境在送出時生效並清除、其他分頁修改…），面板寫入後則由 `notifyDemoStateChanged` 立即通知；
 * 初值同步讀取，網址參數預備的情境在第一次繪製就有圓點。
 */
function useArmedCount(demo: DemoControl): number {
  const subscribe = useCallback((onChange: () => void) => {
    const timer = setInterval(onChange, DEMO_POLL_MS);
    const unsubscribe = useInputModeStore.subscribe((state, previous) => {
      if (state.demoStateSeq !== previous.demoStateSeq) onChange();
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => armedItemCount(demo.getState()),
    () => 0,
  );
}

function DemoTriggerButton({ demo }: { demo: DemoControl }) {
  const open = useInputModeStore((s) => s.demoPanelOpen);
  const toggle = useInputModeStore((s) => s.toggleDemoPanel);
  const armed = useArmedCount(demo);
  const label = armed > 0 ? tTrigger.armed(armed) : tTrigger.label;

  return (
    <button
      type="button"
      data-demo-trigger=""
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? DEMO_PANEL_ID : undefined}
      onClick={toggle}
      className={clsx(
        'relative inline-flex shrink-0 items-center justify-center gap-2 rounded-pill select-none',
        // < 1024：正圓（--hit-size）；≥ 1024：高 40 的膠囊（觸控面板維持 --hit-size）
        'size-(--hit-size) lg:h-10 lg:w-auto lg:px-3.5 kiosk:lg:h-(--hit-size) kiosk:lg:px-5',
        // < 768：與購物車圖示的徽章留點距離；右緣補 8px（頂部列右內距 8px → 圓的右緣與內容區的 16px 邊界對齊）
        'max-md:ml-1 max-md:mr-2',
        // 觸控面板：任務型頁面的頂部列只有 56px 高，56px 的膠囊不能頂到上下緣（一般頁面的頂部列 88px，不受影響）
        'kiosk:my-1.5',
        // 面板展開時維持較淺的底色，作為「已開啟」的狀態（不只靠 aria-expanded）
        'bg-text text-bg transition-colors duration-150 hover:bg-text-sub aria-expanded:bg-text-sub',
        'forced-colors:border forced-colors:border-[ButtonText]',
      )}
    >
      <FlaskConical aria-hidden="true" className="size-(--icon-size) shrink-0" />
      <span aria-hidden="true" className="hidden text-sm font-semibold lg:inline">
        {tTrigger.short}
      </span>
      {armed > 0 ? (
        <span
          aria-hidden="true"
          className="absolute top-0 right-0 size-3.5 rounded-full bg-danger ring-2 ring-bg lg:-top-0.5 lg:-right-0.5"
          data-testid="demo-fab-dot"
        />
      ) : null}
    </button>
  );
}
