// src/features/kiosk/KioskDoneCountdown.tsx —— 完成畫面的 30 秒倒數（FLOW-21、BR-37；PG-06 觸控面板版型）
//
// 完成畫面（訂單成立後的追蹤頁）在觸控面板模式下顯示「{n} 秒後自動回到首頁」並於歸零時重置、回到首頁。
// 畫面上任何操作（含「再看一下」）都視為延長：重新計 30 秒；另提供「開始新訂單」（立即重置）與「再看一下」（延長）兩個按鈕。一般模式或 `active=false` 時不渲染也不掛監聽。
// 倒數文字每秒更新，但螢幕閱讀器只在剩 20 秒（polite）與剩 10 秒（assertive）通報，不逐秒播報。
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components';
import { doneCountdown, KIOSK_DONE_RETURN_SECONDS } from '@/domain/idle';
import { useAnnounce } from '@/features/a11y';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { useLatest } from '@/hooks/useLatest';
import { t } from '@/i18n/zh-TW';
import { useKioskReset } from './kioskReset';
import { useKioskActivity } from './useKioskActivity';

const TICK_MS = 1000;

export function KioskDoneCountdown({ active }: { active: boolean }) {
  const kiosk = useIsKioskUi();
  if (!kiosk || !active) return null;
  return <ActiveDoneCountdown />;
}

function ActiveDoneCountdown() {
  const { lastActivityRef, markActivity } = useKioskActivity(true);
  const resetKiosk = useKioskReset();
  const announce = useAnnounce();
  const [seconds, setSeconds] = useState<number>(KIOSK_DONE_RETURN_SECONDS);
  const announcedRef = useRef<number>(30);
  const actions = useLatest({ resetKiosk, announce });

  useEffect(() => {
    const timer = setInterval(() => {
      const left = doneCountdown(lastActivityRef.current, performance.now());
      setSeconds(left);
      if (left <= 0) {
        clearInterval(timer);
        actions.current.resetKiosk();
        return;
      }
      // 通報分段；使用者延長（秒數回升）時重新武裝
      const bucket = left > 20 ? 30 : left > 10 ? 20 : 10;
      if (bucket > announcedRef.current) announcedRef.current = bucket;
      else if (bucket < announcedRef.current) {
        announcedRef.current = bucket;
        if (bucket === 20) {
          actions.current.announce(t.kiosk.done.announceCountdown(left), 'polite');
        } else {
          actions.current.announce(t.kiosk.done.announceExtend(left), 'assertive');
        }
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [lastActivityRef, actions]);

  return (
    <>
      <p
        className="text-base leading-6 text-text-sub tabular-nums"
        data-testid="kiosk-done-countdown"
      >
        {t.kiosk.done.countdown(seconds)}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button size="lg" onClick={() => resetKiosk()}>
          {t.kiosk.done.startNew}
        </Button>
        {/* 任何操作都會重新計時（useKioskActivity 已監聽全域指標與鍵盤事件）；這裡明確標記一次，鍵盤觸發的 click 亦同 */}
        <Button size="lg" variant="secondary" onClick={markActivity}>
          {t.kiosk.done.keepLooking}
        </Button>
      </div>
    </>
  );
}
