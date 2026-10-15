// src/services/api/mock/demoState.ts —— DemoState 的持久化（zaiorder:v1:demo；07 §6.5）
// 「DemoState 新增欄位以預設值合併舊資料，不需升版」（07 §6.1）。
import { STORAGE_KEYS } from '@/services/storage/appStorage';
import { DEFAULT_DEMO_STATE } from './demoControl';
import type { DemoState } from './demoControl';
import type { MenuProfile } from './menuProfile';
import { SEED_SOLD_OUT_IDS } from './seed/menu';

export const DEMO_STORAGE_KEY = STORAGE_KEYS.demo;

const SPEEDS: ReadonlyArray<DemoState['speed']> = [1, 2, 5];
const LATENCIES: ReadonlyArray<DemoState['latencyMs']> = [0, 300, 1500];
const STORE_OVERRIDES: ReadonlyArray<DemoState['storeOverride']> = ['AUTO', 'OPEN', 'CLOSED', 'PAUSED'];
const PROFILES: ReadonlyArray<MenuProfile> = ['FULL', 'MIXED', 'NO_IMAGES', 'MINIMAL'];
const INPUT_MODES: ReadonlyArray<DemoState['inputMode']> = ['AUTO', 'KIOSK', 'KEYBOARD_HINTS'];
const PAYMENT_RESULTS: ReadonlyArray<DemoState['nextPaymentResult']> = ['MANUAL', 'SUCCESS', 'FAILED', 'TIMEOUT'];

/**
 * 全新環境的初始 DemoState：手動售完旗標由種子帶入（控肉飯今日售完，08 §3.4）。
 * 旗標只存在於 DemoState，面板「恢復上架」即可移除，重置 Demo 資料後回到此初值。
 */
export function initialDemoState(): DemoState {
  return { ...DEFAULT_DEMO_STATE, soldOutProductIds: [...SEED_SOLD_OUT_IDS] };
}

function pick<T>(value: unknown, allowed: ReadonlyArray<T>, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 以預設值補齊並過濾未知 / 型別錯誤的欄位 */
export function normalizeDemoState(raw: unknown, base: DemoState = initialDemoState()): DemoState {
  if (!isRecord(raw)) return base;
  const priceOverrides: Record<string, number> = {};
  if (isRecord(raw['priceOverrides'])) {
    for (const [k, v] of Object.entries(raw['priceOverrides'])) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) priceOverrides[k] = Math.round(v);
    }
  }
  const limitOverrides: Record<string, number | null> = {};
  if (isRecord(raw['limitOverrides'])) {
    for (const [k, v] of Object.entries(raw['limitOverrides'])) {
      if (v === null) limitOverrides[k] = null;
      else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) limitOverrides[k] = Math.floor(v);
    }
  }
  const failRaw = raw['failNext'];
  let failNext: DemoState['failNext'] = null;
  if (isRecord(failRaw) && typeof failRaw['target'] === 'string' && typeof failRaw['remaining'] === 'number') {
    failNext = {
      target: failRaw['target'] as NonNullable<DemoState['failNext']>['target'],
      remaining: failRaw['remaining'],
    };
    if (failRaw['phase'] === 'BEFORE' || failRaw['phase'] === 'AFTER_COMMIT') failNext.phase = failRaw['phase'];
  }
  const raceRaw = raw['raceOnNextCreate'];
  const race = isRecord(raceRaw) ? (raceRaw as unknown as DemoState['raceOnNextCreate']) : null;

  return {
    autoSimulate: typeof raw['autoSimulate'] === 'boolean' ? raw['autoSimulate'] : base.autoSimulate,
    speed: pick(raw['speed'], SPEEDS, base.speed),
    storeOverride: pick(raw['storeOverride'], STORE_OVERRIDES, base.storeOverride),
    clockOverride:
      typeof raw['clockOverride'] === 'string' && Number.isFinite(Date.parse(raw['clockOverride']))
        ? raw['clockOverride']
        : null,
    soldOutProductIds: Array.isArray(raw['soldOutProductIds'])
      ? raw['soldOutProductIds'].filter((x): x is string => typeof x === 'string')
      : base.soldOutProductIds,
    priceOverrides,
    limitOverrides,
    menuProfile: pick(raw['menuProfile'], PROFILES, base.menuProfile),
    themeOverride:
      typeof raw['themeOverride'] === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw['themeOverride'])
        ? raw['themeOverride']
        : null,
    inputMode: pick(raw['inputMode'], INPUT_MODES, base.inputMode),
    nextPaymentResult: pick(raw['nextPaymentResult'], PAYMENT_RESULTS, base.nextPaymentResult),
    latencyMs: pick(raw['latencyMs'], LATENCIES, base.latencyMs),
    failNext,
    raceOnNextCreate: race,
  };
}

function clone(state: DemoState): DemoState {
  return JSON.parse(JSON.stringify(state)) as DemoState;
}

export interface DemoStateStore {
  /** 目前狀態的拷貝 */
  get(): DemoState;
  /** 合併 patch 並同步寫回；回傳新狀態的拷貝 */
  set(patch: Partial<DemoState>): DemoState;
  /** 自 storage 重讀（其他分頁的變更）；回傳是否有變動 */
  reload(): boolean;
  /** 還原為初始狀態並寫回 */
  reset(): DemoState;
  subscribe(listener: (next: DemoState, prev: DemoState) => void): () => void;
  /** 停止寫回（resetAll 清除儲存後、頁面重新載入前） */
  suspend(): void;
}

export function createDemoStateStore(
  storage: Storage,
  key: string = DEMO_STORAGE_KEY,
): DemoStateStore {
  let state = initialDemoState();
  let lastRaw: string | null = null;
  const listeners = new Set<(next: DemoState, prev: DemoState) => void>();

  let suspended = false;

  const persist = (): void => {
    if (suspended) return;
    const raw = JSON.stringify(state);
    lastRaw = raw;
    storage.setItem(key, raw);
  };

  const read = (): DemoState => {
    const raw = storage.getItem(key);
    lastRaw = raw;
    if (raw === null) return initialDemoState();
    try {
      return normalizeDemoState(JSON.parse(raw));
    } catch {
      return initialDemoState();
    }
  };

  state = read();

  const emit = (next: DemoState, prev: DemoState): void => {
    for (const l of listeners) l(clone(next), clone(prev));
  };

  return {
    get: () => clone(state),
    set(patch) {
      const prev = state;
      state = normalizeDemoState({ ...state, ...patch }, state);
      persist();
      emit(state, prev);
      return clone(state);
    },
    reload() {
      const raw = storage.getItem(key);
      if (raw === lastRaw) return false;
      const prev = state;
      state = read();
      emit(state, prev);
      return true;
    },
    reset() {
      const prev = state;
      state = initialDemoState();
      persist();
      emit(state, prev);
      return clone(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    suspend() {
      suspended = true;
    },
  };
}
