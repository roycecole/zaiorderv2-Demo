// src/features/demo/sections/NetworkSection.tsx —— 付款結果、網路延遲與指定端點失敗（FR-DM-03、FR-DM-06）
//
// 送出訂單的失敗 / 回應遺失在獨立的「送出結果」區塊（FR-DM-13）；此處只處理其他端點，
// 但「已預備」狀態會顯示所有 failNext（含網址參數 demo_fail 預備者），並可取消。
import { useState } from 'react';
import { Button, Select, useToast } from '@/components';
import { demo as tDemo } from '@/i18n/strings/demo';
import type { DemoState, FailNext } from '@/services/api/mock/demoControl';
import { FAIL_CONTINUOUS } from '../constants';
import { useDemoContext } from '../DemoContext';
import { ChoiceGroup, SubGroup } from '../parts';
import { describeFailNext } from '../scenario';

type FailTarget = Exclude<FailNext['target'], 'orders.create'>;

const TARGETS: ReadonlyArray<FailTarget> = [
  'any',
  'orders.quote',
  'orders.pay',
  'auth.verifyOtp',
  'store.getMenu',
];

const PAYMENT_CHOICES = (['MANUAL', 'SUCCESS', 'FAILED', 'TIMEOUT'] as const).map((value) => ({
  value,
  label: tDemo.network.payment[value],
}));

const LATENCY_CHOICES = ([0, 300, 1500] as const).map((value) => ({
  value,
  label: tDemo.network.latencyOption(value),
}));

/** 0 表示持續失敗 */
const COUNT_CHOICES = [
  { value: 1, label: tDemo.network.failCountOption(1) },
  { value: 2, label: tDemo.network.failCountOption(2) },
  { value: 3, label: tDemo.network.failCountOption(3) },
  { value: 5, label: tDemo.network.failCountOption(5) },
  { value: 0, label: tDemo.network.failContinuous },
] as const;

/** GET 內建自動重試 2 次，載入菜單預設 3 次才會呈現錯誤（07 §6.3） */
const defaultCount = (target: FailTarget): number => (target === 'store.getMenu' ? 3 : 1);

export function NetworkSection() {
  const { state, patchState } = useDemoContext();
  const { toast } = useToast();
  const [target, setTarget] = useState<FailTarget>('any');
  const [count, setCount] = useState<number | null>(null);
  const effectiveCount = count ?? defaultCount(target);

  const arm = (): void => {
    const failNext: DemoState['failNext'] = {
      target,
      remaining: effectiveCount === 0 ? FAIL_CONTINUOUS : effectiveCount,
    };
    patchState({ failNext });
    toast({ message: tDemo.network.armedToast, tone: 'info' });
  };

  const disarm = (): void => {
    patchState({ failNext: null });
    toast({ message: tDemo.network.disarmedToast, tone: 'info' });
  };

  return (
    <>
      <ChoiceGroup
        legend={tDemo.network.paymentLegend}
        hint={tDemo.network.paymentHint}
        choices={PAYMENT_CHOICES}
        value={state.nextPaymentResult}
        onChange={(nextPaymentResult) => patchState({ nextPaymentResult })}
      />
      <ChoiceGroup
        legend={tDemo.network.latencyLegend}
        choices={LATENCY_CHOICES}
        value={state.latencyMs}
        onChange={(latencyMs) => patchState({ latencyMs })}
      />
      <SubGroup legend={tDemo.network.failLegend}>
        <Select
          label={tDemo.network.failTarget}
          value={target}
          onChange={(e) => {
            setTarget(e.target.value as FailTarget);
            setCount(null);
          }}
          options={TARGETS.map((value) => ({ value, label: tDemo.network.failTargets[value] }))}
        />
        <ChoiceGroup
          legend={tDemo.network.failCount}
          hint={target === 'store.getMenu' ? tDemo.network.failCountHint : undefined}
          choices={COUNT_CHOICES}
          value={effectiveCount}
          onChange={setCount}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={arm}>
            {tDemo.network.failArm}
          </Button>
          {state.failNext !== null ? (
            <Button variant="ghost" onClick={disarm}>
              {tDemo.network.failDisarm}
            </Button>
          ) : null}
        </div>
        <p className="text-sm leading-5 text-text-sub" aria-live="polite">
          {state.failNext !== null
            ? tDemo.network.failArmed(describeFailNext(state.failNext))
            : tDemo.network.failNone}
        </p>
      </SubGroup>
    </>
  );
}
