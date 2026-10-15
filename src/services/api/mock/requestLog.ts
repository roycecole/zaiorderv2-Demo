// src/services/api/mock/requestLog.ts
import type { ErrorCode, ISODateTime } from '@/domain/types';

export type CreateOutcome = 'CREATED' | 'REPLAYED' | 'REJECTED' | 'FAILED_BEFORE' | 'RESPONSE_LOST';

/** 「最近送出紀錄」的一筆：不含個資；不屬 05 資料表 */
export interface CreateLogEntry {
  at: ISODateTime;
  idempotencyKey: string;
  outcome: CreateOutcome;
  code?: ErrorCode;
  orderNo?: string;
  /** 面板顯示用的一句摘要，不含個資；被拒時由 error.quote 組成（品名與原因，例如「古早味紅茶今日售完」，文案同 03 §9） */
  summary?: string;
}

/** 環形緩衝容量；Demo 面板顯示最近 5 筆，重置 Demo 資料時清除 */
export const CREATE_LOG_CAPACITY = 20;

export function appendCreateLog(
  log: ReadonlyArray<CreateLogEntry>,
  entry: CreateLogEntry,
): CreateLogEntry[] {
  return [...log, entry].slice(-CREATE_LOG_CAPACITY);
}

/** 最新的在前 */
export function recentCreateLog(log: ReadonlyArray<CreateLogEntry>, limit: number = 5): CreateLogEntry[] {
  if (!(limit > 0)) return [];
  return log.slice(-Math.floor(limit)).reverse();
}
