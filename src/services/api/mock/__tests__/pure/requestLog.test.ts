// Demo「最近送出紀錄」環形緩衝（PG-18；不含個資）
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CREATE_LOG_CAPACITY, appendCreateLog, recentCreateLog } from '../../requestLog';
import type { CreateLogEntry } from '../../requestLog';

const entry = (i: number, o: Partial<CreateLogEntry> = {}): CreateLogEntry => ({
  at: `t${i}`,
  idempotencyKey: `k${i}`,
  outcome: 'CREATED',
  ...o,
});

describe('appendCreateLog / recentCreateLog', () => {
  it('環形緩衝保留最近 20 筆（最舊者被淘汰）', () => {
    expect(CREATE_LOG_CAPACITY).toBe(20);
    let log: CreateLogEntry[] = [];
    for (let i = 0; i < 25; i++) log = appendCreateLog(log, entry(i));
    expect(log).toHaveLength(20);
    expect(log[0]?.idempotencyKey).toBe('k5');
    expect(log[19]?.idempotencyKey).toBe('k24');
  });

  it('最近的在前；預設顯示 5 筆；limit 可調整', () => {
    let log: CreateLogEntry[] = [];
    for (let i = 0; i < 25; i++) log = appendCreateLog(log, entry(i));
    expect(recentCreateLog(log, 3).map((x) => x.idempotencyKey)).toEqual(['k24', 'k23', 'k22']);
    expect(recentCreateLog(log)).toHaveLength(5);
    expect(recentCreateLog(log)[0]?.idempotencyKey).toBe('k24');
  });

  it('不足 limit 時全部回傳；空紀錄為空陣列', () => {
    expect(recentCreateLog([])).toEqual([]);
    const log = appendCreateLog(appendCreateLog([], entry(1)), entry(2));
    expect(recentCreateLog(log, 5).map((x) => x.idempotencyKey)).toEqual(['k2', 'k1']);
  });

  it('limit 為 0 或負數時回傳空陣列', () => {
    const log = appendCreateLog(appendCreateLog([], entry(1)), entry(2));
    expect(recentCreateLog(log, 0)).toEqual([]);
    expect(recentCreateLog(log, -3)).toEqual([]);
  });

  it('不改動輸入陣列（append 回傳新陣列；recent 不反轉原陣列）', () => {
    const log = [entry(1), entry(2), entry(3)];
    const before = log.length;
    const next = appendCreateLog(log, entry(4, { outcome: 'REJECTED', code: 'ITEM_SOLD_OUT' }));
    expect(log).toHaveLength(before);
    expect(next).not.toBe(log);
    recentCreateLog(log, 3);
    expect(log.map((x) => x.idempotencyKey)).toEqual(['k1', 'k2', 'k3']);
  });

  it('PG-18：被拒紀錄附一句摘要（品名與原因，不含個資）；成功紀錄不帶摘要', () => {
    const rejected = appendCreateLog([], {
      at: 't',
      idempotencyKey: 'k',
      outcome: 'REJECTED',
      code: 'ITEM_SOLD_OUT',
      summary: '古早味紅茶今日售完',
    });
    expect(recentCreateLog(rejected)[0]?.summary).toBe('古早味紅茶今日售完');
    const created = appendCreateLog([], {
      at: 't',
      idempotencyKey: 'k',
      outcome: 'CREATED',
      orderNo: 'ZO1',
    });
    expect(recentCreateLog(created)[0]?.summary).toBeUndefined();
  });

  it('性質：長度 ≤ 容量；內容為最後 N 筆且順序保留', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), (n) => {
        let log: CreateLogEntry[] = [];
        for (let i = 0; i < n; i++) log = appendCreateLog(log, entry(i));
        expect(log.length).toBe(Math.min(n, CREATE_LOG_CAPACITY));
        expect(log.map((x) => x.at)).toEqual(
          Array.from({ length: n }, (_, i) => `t${i}`).slice(-CREATE_LOG_CAPACITY),
        );
      }),
    );
  });
});
