// src/services/api/mock/runtime.ts —— Mock 執行環境：db、DemoState、時鐘、延遲、失敗注入與臨界區的共用組裝
import type { FailNext } from './demoControl';
import type { DemoStateStore } from './demoState';
import type { MockDb } from './db';
import { InjectedFailure } from './errors';
import { withDbLock } from './lock';
import type { LockManagerLike } from './lock';
import { loadWorld } from './world';
import type { World } from './world';
import type { OrderCtx } from './orderModel';
import type { StaticSeed } from './seed';
import { getClock } from '@/services/clock';

/** 失敗注入可指定的端點名稱（FailNext.target 去掉 'any'） */
export type Endpoint = Exclude<FailNext['target'], 'any'> | 'other';

export interface MockRuntime {
  readonly storeSlug: string;
  readonly seed: StaticSeed;
  readonly db: MockDb;
  readonly demo: DemoStateStore;
  /** 目前時間（epoch ms）；臨界區內為進入時的固定值，使同一次請求的所有寫入共用同一個「現在」 */
  nowMs(): number;
  ctx(): OrderCtx;
  world(): World;
  /** 唯讀路徑：同步重讀 db 與 DemoState 後回傳 World；不寫入 */
  read(): World;
  /** 寫入路徑：withDbLock → reload → fn → 同步 flush（鎖內 fn 不得 await） */
  tx<T>(fn: (ctx: OrderCtx) => T): Promise<T>;
  /** 僅取得臨界區（呼叫端自行 reload / flush），供 createOrder 管線使用 */
  lock<T>(fn: () => T): Promise<T>;
  latency(): Promise<void>;
  /**
   * 命中 failNext 時丟出 503（不附 retryAfterSeconds，前端依 FLOW-24 視為結果未知）。
   * userTriggered：寫入類請求；'any' 只消耗使用者觸發的請求（輪詢與背景更新不消耗，07 §6.3）
   */
  failIf(endpoint: Endpoint, userTriggered: boolean): void;
  /** orders.create 專用：phase 與 FailNext.phase 相符才命中（省略視為 BEFORE） */
  failCreate(phase: 'BEFORE' | 'AFTER_COMMIT'): void;
  /** 一般請求的標準前置：延遲 → 失敗注入 */
  begin(endpoint: Endpoint, userTriggered: boolean): Promise<void>;
}

export interface RuntimeOptions {
  storeSlug: string;
  seed: StaticSeed;
  db: MockDb;
  demo: DemoStateStore;
  /** null = 強制不使用 Web Locks（測試）；undefined = 使用 navigator.locks（不支援則降級） */
  locks?: LockManagerLike | null;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createRuntime(o: RuntimeOptions): MockRuntime {
  const { db, demo, seed } = o;
  const sleep = o.sleep ?? defaultSleep;
  let frozen: number | null = null;

  const nowMs = (): number => frozen ?? getClock().now().getTime();
  const ctx = (): OrderCtx => ({ data: db.data, seed, demo: demo.get(), nowMs: nowMs() });
  const world = (): World => loadWorld({ seed, data: db.data, demo: demo.get(), nowMs: nowMs() });

  const lock = async <T>(fn: () => T): Promise<T> => {
    const run = (): T => {
      const outer = frozen;
      frozen = getClock().now().getTime();
      try {
        return fn();
      } finally {
        frozen = outer;
      }
    };
    if (o.locks === null) return run();
    return withDbLock(run, o.locks);
  };

  /** 命中 failNext 時扣一次並回傳 true */
  const consume = (match: (f: FailNext) => boolean): boolean => {
    const f = demo.get().failNext;
    if (f === null || f.remaining <= 0 || !match(f)) return false;
    const remaining = f.remaining - 1;
    demo.set({ failNext: remaining > 0 ? { ...f, remaining } : null });
    return true;
  };

  const latency = async (): Promise<void> => {
    const base = demo.get().latencyMs;
    if (base <= 0) return;
    const jitter = Math.round((Math.random() * 2 - 1) * 100);
    await sleep(Math.max(0, base + jitter));
  };

  const failIf = (endpoint: Endpoint, userTriggered: boolean): void => {
    if (consume((f) => f.target === endpoint || (f.target === 'any' && userTriggered))) {
      throw new InjectedFailure('OTHER', 503, 'SERVICE_UNAVAILABLE', '服務暫時無法使用，請稍後再試');
    }
  };

  const failCreate = (phase: 'BEFORE' | 'AFTER_COMMIT'): void => {
    const hit = consume(
      (f) => (f.target === 'orders.create' || f.target === 'any') && (f.phase ?? 'BEFORE') === phase,
    );
    if (!hit) return;
    if (phase === 'BEFORE') {
      // 請求未被處理：503 且不附 retryAfterSeconds（前端依 FLOW-24 視為結果未知）
      throw new InjectedFailure('BEFORE', 503, 'SERVICE_UNAVAILABLE', '服務暫時無法使用，請稍後再試');
    }
    // 訂單已建立並同步寫回後才丟網路層錯誤（回應遺失，EC-05）
    throw new InjectedFailure('AFTER_COMMIT', 0, 'SERVICE_UNAVAILABLE', '網路好像不太穩，請稍後再試');
  };

  return {
    storeSlug: o.storeSlug,
    seed,
    db,
    demo,
    nowMs,
    ctx,
    world,
    read() {
      db.reload();
      demo.reload();
      return world();
    },
    lock,
    tx<T>(fn: (c: OrderCtx) => T): Promise<T> {
      return lock(() => {
        db.reload();
        demo.reload();
        try {
          return fn(ctx());
        } finally {
          db.flush(); // 鎖內任何路徑結束前都同步寫回（含被拒與丟出錯誤）
        }
      });
    },
    latency,
    failIf,
    failCreate,
    begin: async (endpoint, userTriggered) => {
      await latency();
      failIf(endpoint, userTriggered);
    },
  };
}
