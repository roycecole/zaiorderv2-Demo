// src/features/kiosk/IdleGuard.tsx —— 觸控面板閒置警示與重置（CMP-37、FLOW-21、BR-37；WCAG 2.2.1）
//
// 60 秒無操作 → 「還在嗎？」alertdialog（30 秒倒數，可延長）；90 秒 → 清空購物車與暫存資料並回到首頁。
// 計時一律用 performance.now()（單調時鐘），不使用 Clock（時間穿梭）；每秒由 setInterval 評估 domain/idle.ts。
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, preloadDialog } from '@/components';
import { DialogDescription } from '@/components/overlay';
import { idleState } from '@/domain/idle';
import type { IdlePhase, IdleState } from '@/domain/idle';
import { useAnnounce } from '@/features/a11y';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { useLatest } from '@/hooks/useLatest';
import { t } from '@/i18n/zh-TW';
import { useKioskReset } from './kioskReset';
import { hasUnknownOrderResult } from './unknownResult';
import { useKioskActivity } from './useKioskActivity';

const TICK_MS = 1000;
const INITIAL: IdleState = { phase: 'ACTIVE', remainingSeconds: 90 };

/** 通報分段：進入警示（30）已由對話框開啟時朗讀；之後每 10 秒（20、10）以 assertive 通報，不逐秒播報 */
function announceBucket(remainingSeconds: number): 30 | 20 | 10 {
  if (remainingSeconds > 20) return 30;
  if (remainingSeconds > 10) return 20;
  return 10;
}

/**
 * 不在觸控面板模式（`useIsKioskUi()` 為 false）時不渲染任何東西，也不掛全域監聽。
 * 無 props；放在 AppShell 內（需 Router、QueryClient）。
 */
export function IdleGuard() {
  const kiosk = useIsKioskUi();
  if (!kiosk) return null;
  return <ActiveIdleGuard />;
}

function ActiveIdleGuard() {
  const { lastActivityRef, markActivity } = useKioskActivity(true);
  const resetKiosk = useKioskReset();
  const announce = useAnnounce();
  const [state, setState] = useState<IdleState>(INITIAL);
  const [unknownResult, setUnknownResult] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const announcedRef = useRef<number>(30);
  const phaseRef = useRef<IdlePhase>('ACTIVE');

  // 計時器內只讀 ref，避免因 announce / resetKiosk 參考變動而重建計時器
  const actions = useLatest({ announce, resetKiosk, markActivity });

  // 警示對話框的實作是延後載入的：先載入，閒置 60 秒時才能立刻顯示（店內網路中斷也不會漏掉警示）
  useEffect(() => {
    preloadDialog().catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = idleState(lastActivityRef.current, performance.now());
      if (next.phase === 'RESET') {
        actions.current.resetKiosk();
        actions.current.markActivity(); // 重置後狀態回到 ACTIVE，重新起算
        phaseRef.current = 'ACTIVE';
        announcedRef.current = 30;
        setUnknownResult(false);
        setState(INITIAL);
        return;
      }
      if (next.phase === 'WARNING') {
        if (phaseRef.current !== 'WARNING') announcedRef.current = 30;
        const bucket = announceBucket(next.remainingSeconds);
        if (bucket < announcedRef.current) {
          announcedRef.current = bucket;
          actions.current.announce(t.kiosk.idle.announce(bucket), 'assertive');
        }
        setUnknownResult(hasUnknownOrderResult());
      }
      phaseRef.current = next.phase;
      // ACTIVE 階段的剩餘秒數不影響畫面：只在階段改變時更新，避免每秒無謂重繪
      setState((prev) =>
        prev.phase === next.phase &&
        (next.phase !== 'WARNING' || prev.remainingSeconds === next.remainingSeconds)
          ? prev
          : next,
      );
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [lastActivityRef, actions]);

  const continueOrdering = (): void => {
    markActivity();
    phaseRef.current = 'ACTIVE';
    announcedRef.current = 30;
    setState(INITIAL);
  };

  const restartNow = (): void => {
    resetKiosk();
    markActivity();
    phaseRef.current = 'ACTIVE';
    announcedRef.current = 30;
    setUnknownResult(false);
    setState(INITIAL);
  };

  const warning = state.phase === 'WARNING';

  return (
    <Dialog
      open={warning}
      // Esc 與點擊遮罩 = 取消 = 繼續點餐（03 §10.2；任何操作皆視為延長）
      onOpenChange={(open) => {
        if (!open) continueOrdering();
      }}
      role="alertdialog"
      size="sm"
      title={t.kiosk.idle.title}
      showClose={false}
      initialFocusRef={continueRef}
    >
      <DialogDescription className="text-center">
        <span className="flex flex-wrap items-baseline justify-center gap-3">
          <strong className="text-[3rem] leading-none font-bold text-text tabular-nums">
            {state.remainingSeconds}
          </strong>
          <span>{t.kiosk.idle.countdownSuffix}</span>
        </span>
        {unknownResult ? (
          <span className="mt-4 block rounded-md bg-warning-soft px-3 py-2 text-sm leading-5 font-semibold text-warning">
            {t.kiosk.idle.unknownResult}
          </span>
        ) : null}
      </DialogDescription>
      <div className="mt-5 flex flex-col gap-3">
        <Button ref={continueRef} size="lg" fullWidth onClick={continueOrdering}>
          {t.kiosk.idle.continue}
        </Button>
        <Button size="lg" variant="secondary" fullWidth onClick={restartNow}>
          {t.kiosk.idle.restart}
        </Button>
      </div>
    </Dialog>
  );
}
