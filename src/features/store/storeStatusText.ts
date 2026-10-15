// src/features/store/storeStatusText.ts —— 營業狀態 → 顯示文案（03 §6.3；純函式，時間由參數傳入）
import { formatMonthDayWeek, formatTime } from '@/domain/format';
import { DAY_MS, MINUTE_MS, dateOfMs, diffDays, hhmmToMinutes, msOf } from '@/domain/taipeiTime';
import type { HHmm, StoreStatus } from '@/domain/types';
import { t } from '@/i18n/zh-TW';

export type StoreStatusTone = 'success' | 'warning' | 'danger';
export type StoreStatusIcon = 'open' | 'resting' | 'holiday' | 'paused';

export interface StoreStatusView {
  tone: StoreStatusTone;
  icon: StoreStatusIcon;
  /** 狀態名稱：營業中 / 休息中 / 暫停接單（不只靠顏色與圖示表達） */
  stateLabel: string;
  /** 完整文案（03 §6.3 對照表） */
  text: string;
  /** 精簡文案（頂部列等窄處）：營業中改為「今日 HH:mm 打烊」、暫停改為「約 n 分鐘後恢復營業」 */
  shortText: string;
}

/** 下次營業時間的相對說明：今日 HH:mm / 明日 HH:mm / M/D（週）HH:mm */
export function describeNextOpen(nextOpenAt: string | undefined, nowMs: number): string | null {
  if (nextOpenAt === undefined) return null;
  const next = Date.parse(nextOpenAt);
  if (Number.isNaN(next)) return null;
  const gap = diffDays(dateOfMs(nowMs), dateOfMs(next));
  const time = formatTime(next);
  if (gap === 0) return `${t.store.status.today} ${time}`;
  if (gap === 1) return `${t.store.status.tomorrow} ${time}`;
  return `${formatMonthDayWeek(next)} ${time}`;
}

/** 營業時段顯示：跨午夜（close ≤ open）的收店時間標示「次日」 */
export function formatHoursSpan(open: HHmm, close: HHmm): string {
  const overnight = hhmmToMinutes(close) <= hhmmToMinutes(open);
  return `${open}–${overnight ? `${t.store.status.nextDay} ${close}` : close}`;
}

/** 目前所在營業時段的打烊時間（含前一營業日跨午夜的延伸）；不在任何時段回傳 null */
function currentClosing(status: StoreStatus, nowMs: number): string | null {
  const today = dateOfMs(nowMs);
  for (const h of status.todayHours) {
    const overnight = hhmmToMinutes(h.close) <= hhmmToMinutes(h.open);
    const openMs = msOf(today, h.open);
    const closeMs = msOf(today, h.close) + (overnight ? DAY_MS : 0);
    if (openMs <= nowMs && nowMs < closeMs) {
      return `${overnight ? t.store.status.nextDay : t.store.status.today} ${h.close}`;
    }
  }
  return null;
}

/**
 * @param status `GET /store/status` 的結果
 * @param nowMs  目前時間（getClock().now()；Demo 時間穿梭會反映）
 */
export function describeStoreStatus(status: StoreStatus, nowMs: number): StoreStatusView {
  const s = t.store.status;
  switch (status.status) {
    case 'OPEN': {
      const hours = status.todayHours.map((h) => formatHoursSpan(h.open, h.close)).join('、');
      const closing = currentClosing(status, nowMs);
      const text = hours.length > 0 ? s.open(hours) : s.openNoHours;
      return {
        tone: 'success',
        icon: 'open',
        stateLabel: s.stateLabel.OPEN,
        text,
        shortText: closing !== null ? s.openUntil(closing) : text,
      };
    }
    case 'PAUSED': {
      const until = status.pausedUntil !== undefined ? Date.parse(status.pausedUntil) : Number.NaN;
      if (Number.isNaN(until)) {
        return {
          tone: 'danger',
          icon: 'paused',
          stateLabel: s.stateLabel.PAUSED,
          text: s.paused,
          shortText: s.paused,
        };
      }
      const minutes = Math.ceil((until - nowMs) / MINUTE_MS);
      if (minutes <= 0) {
        return {
          tone: 'danger',
          icon: 'paused',
          stateLabel: s.stateLabel.PAUSED,
          text: s.pausedSoon,
          shortText: s.pausedSoon,
        };
      }
      const time = formatTime(until);
      const within = minutes <= 60;
      return {
        tone: 'danger',
        icon: 'paused',
        stateLabel: s.stateLabel.PAUSED,
        text: within ? s.pausedUntilWithin(time, minutes) : s.pausedUntil(time),
        shortText: within ? s.pausedShort(minutes) : s.pausedUntil(time),
      };
    }
    case 'CLOSED': {
      const next = describeNextOpen(status.nextOpenAt, nowMs);
      switch (status.closedReason) {
        case 'HOLIDAY': {
          const text = next !== null ? s.holiday(next) : s.holidayNoNext;
          return {
            tone: 'warning',
            icon: 'holiday',
            stateLabel: s.stateLabel.CLOSED,
            text,
            shortText: text,
          };
        }
        case 'LAST_ORDER_PASSED': {
          const text = next !== null ? s.lastOrderPassed(next) : s.lastOrderPassedNoNext;
          return {
            tone: 'warning',
            icon: 'resting',
            stateLabel: s.stateLabel.CLOSED,
            text,
            shortText: text,
          };
        }
        default: {
          const text = next !== null ? s.outOfHours(next) : s.outOfHoursNoNext;
          return {
            tone: 'warning',
            icon: 'resting',
            stateLabel: s.stateLabel.CLOSED,
            text,
            shortText: text,
          };
        }
      }
    }
  }
}
