// src/features/demo/scenario.ts —— 面板頂部「目前情境」摘要（網址參數 demo_* 預備的情境也會出現在這裡）
import { formatDateTime } from '@/domain/format';
import { DEFAULT_DEMO_STATE } from '@/services/api/mock/demoControl';
import type { DemoState, FailNext } from '@/services/api/mock/demoControl';
import { demo as tDemo } from '@/i18n/strings/demo';
import { armedItemCount } from './armed';
import { FAIL_CONTINUOUS } from './constants';

// 預備項數的計算放在輕量的 armed.ts（頂部列入口屬於主 bundle）；這裡重新匯出，維持原本的匯入路徑
export { armedItemCount };

export function describeFailNext(failNext: FailNext): string {
  const target = tDemo.network.failTargets[failNext.target];
  const phase =
    failNext.target === 'orders.create'
      ? tDemo.network.failPhase[failNext.phase ?? 'BEFORE']
      : undefined;
  const remaining = failNext.remaining >= FAIL_CONTINUOUS ? 'continuous' : failNext.remaining;
  return tDemo.network.failDescribe(target, remaining, phase);
}

/**
 * 與預設值不同的設定摘要（一行一項）。種子預設的手動售完（控肉飯）不算情境，
 * 因此不比對 soldOutProductIds；售完旗標在「庫存與時段情境」區塊逐商品顯示。
 */
export function describeScenario(state: DemoState): string[] {
  const d = tDemo.scenario;
  const out: string[] = [];
  if (state.clockOverride !== null) {
    out.push(d.clock(formatDateTime(state.clockOverride)));
  }
  if (state.storeOverride !== DEFAULT_DEMO_STATE.storeOverride) {
    out.push(d.store(tDemo.storeTime.store[state.storeOverride]));
  }
  if (state.menuProfile !== DEFAULT_DEMO_STATE.menuProfile) {
    out.push(d.menuProfile(tDemo.menu.profile[state.menuProfile]));
  }
  if (state.themeOverride !== null) out.push(d.theme(state.themeOverride));
  if (state.inputMode !== DEFAULT_DEMO_STATE.inputMode) {
    out.push(d.inputMode(tDemo.menu.inputMode[state.inputMode]));
  }
  if (state.nextPaymentResult !== DEFAULT_DEMO_STATE.nextPaymentResult) {
    out.push(d.payment(tDemo.network.payment[state.nextPaymentResult]));
  }
  if (state.latencyMs !== DEFAULT_DEMO_STATE.latencyMs) out.push(d.latency(state.latencyMs));
  if (state.failNext !== null) out.push(d.failNext(describeFailNext(state.failNext)));
  const armed = armedItemCount(state);
  if (state.raceOnNextCreate !== null && armed > 0) out.push(d.race(armed));
  const limits = Object.keys(state.limitOverrides).length;
  if (limits > 0) out.push(d.limits(limits));
  const prices = Object.keys(state.priceOverrides).length;
  if (prices > 0) out.push(d.prices(prices));
  if (!state.autoSimulate) out.push(d.autoOff);
  if (state.speed !== DEFAULT_DEMO_STATE.speed) out.push(d.speed(state.speed));
  return out;
}
