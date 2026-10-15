// src/services/api/http/clockSync.ts —— 以 StoreStatus.serverTime 校正本機時鐘偏差（07 §6.4 末段）
//
// 僅 HTTP 模式：使用者裝置時間錯誤會讓營業狀態、時段與付款倒數誤判。以 createOffsetClock 包裝後 setClock，
// 之後全站的 getClock().now() 即為「伺服器時間」。Mock 模式的時鐘由 DemoControl 管理，不經過這裡。
import { createOffsetClock, getClock, setClock, systemClock } from '@/services/clock';
import type { Clock } from '@/services/clock';

/** 偏差小於此值不調整（網路延遲與時鐘取整都在此量級內，調整只會製造抖動） */
export const CLOCK_SKEW_TOLERANCE_MS = 2_000;

export interface ClockSync {
  /**
   * 以剛收到的 `serverTime` 校正。以「回應抵達當下」的本機真實時間為比較基準，不含單程網路延遲補償
   * （延遲遠小於 2 秒門檻；GET 重試時也不會把退避等待算進去）。
   * 不處理格式錯誤的時間字串；時鐘已被他人覆寫（測試、Demo 時間穿梭）時不介入。
   */
  sync(serverTime: string | undefined): void;
}

export function createClockSync(): ClockSync {
  /** 此實例安裝的校正時鐘；用來辨識「現在的時鐘是不是我設的」 */
  let installed: Clock | null = null;

  return {
    sync(serverTime) {
      if (serverTime === undefined) return;
      const server = new Date(serverTime);
      if (Number.isNaN(server.getTime())) return;

      const current = getClock();
      if (current !== systemClock && current !== installed) return;

      const skew = server.getTime() - systemClock.now().getTime();
      if (Math.abs(skew) < CLOCK_SKEW_TOLERANCE_MS) {
        // 裝置時間已正確（例如使用者剛修正系統時間）：撤掉先前的校正，回到系統時鐘
        if (installed !== null && current === installed) setClock(systemClock);
        installed = null;
        return;
      }

      // 已校正且仍準確：不重設錨點，避免每次輪詢時間微幅跳動（甚至倒退）
      if (installed !== null && current === installed) {
        if (Math.abs(server.getTime() - current.now().getTime()) < CLOCK_SKEW_TOLERANCE_MS) return;
      }

      installed = createOffsetClock(server, systemClock);
      setClock(installed);
    },
  };
}
