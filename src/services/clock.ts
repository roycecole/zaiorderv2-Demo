// src/services/clock.ts
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * 以固定起點「繼續走時」的時鐘：設定 12:00 後，每過 1 秒顯示時間也前進 1 秒。
 */
export function createOffsetClock(anchor: Date, base: Clock = systemClock): Clock {
  const startedAt = base.now().getTime();
  return {
    now: () => new Date(anchor.getTime() + (base.now().getTime() - startedAt)),
  };
}

let current: Clock = systemClock;

/** 全站唯一的「現在」來源；Demo 時間穿梭與測試以 setClock 覆寫 */
export const getClock = (): Clock => current;
export const setClock = (clock: Clock): void => {
  current = clock;
};
