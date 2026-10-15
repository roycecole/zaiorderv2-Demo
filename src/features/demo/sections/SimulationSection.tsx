// src/features/demo/sections/SimulationSection.tsx —— 訂單模擬（FR-DM-01）：自動推進、速度、手動店家動作
import { useState } from 'react';
import { Button, Select, Switch, useToast } from '@/components';
import { t } from '@/i18n/zh-TW';
import { demo as tDemo } from '@/i18n/strings/demo';
import { errorMessageOf } from '@/i18n/strings/errors';
import type { StoreAction } from '@/services/api/mock/demoControl';
import { useDemoContext } from '../DemoContext';
import { ChoiceGroup, SubGroup } from '../parts';
import { legalStoreActions } from '../storeActions';
import { useActiveOrders } from '../useActiveOrders';

const SPEEDS = [
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 5, label: '5×' },
] as const;

export function SimulationSection() {
  const { state, patchState } = useDemoContext();
  return (
    <>
      <Switch
        label={tDemo.simulation.auto}
        description={tDemo.simulation.autoHint}
        checked={state.autoSimulate}
        onCheckedChange={(autoSimulate) => patchState({ autoSimulate })}
      />
      <ChoiceGroup
        legend={tDemo.simulation.speed}
        choices={SPEEDS}
        value={state.speed}
        onChange={(speed) => patchState({ speed })}
      />
      <StoreActions />
    </>
  );
}

function StoreActions() {
  const { demo, afterWrite } = useDemoContext();
  const { toast } = useToast();
  const orders = useActiveOrders(true);
  const [pickedId, setPickedId] = useState<string>('');
  const list = orders.data ?? [];
  // 預設最新進行中訂單；選取的訂單已結束時退回最新
  const target = list.find((o) => o.id === pickedId) ?? list[0];
  const actions = target === undefined ? [] : legalStoreActions(target.status, target.orderType);

  const run = async (action: StoreAction): Promise<void> => {
    if (target === undefined) return;
    try {
      await demo.act(target.id, action);
      toast({
        message: tDemo.simulation.done(tDemo.simulation.actions[action]),
        tone: 'success',
      });
    } catch (error) {
      toast({
        message: errorMessageOf(error, tDemo.simulation.failed),
        tone: 'error',
      });
    } finally {
      afterWrite();
      void orders.refetch();
    }
  };

  return (
    <SubGroup legend={tDemo.simulation.actionsLegend}>
      {orders.isPending ? (
        <p className="text-sm leading-5 text-text-muted">{tDemo.simulation.loading}</p>
      ) : target === undefined ? (
        <p className="text-sm leading-5 text-text-muted">{tDemo.simulation.noOrders}</p>
      ) : (
        <>
          {list.length > 1 ? (
            <Select
              label={tDemo.simulation.pickOrder}
              value={target.id}
              onChange={(e) => setPickedId(e.target.value)}
              options={list.map((o) => ({
                value: o.id,
                label: tDemo.simulation.orderLine(
                  o.label,
                  tDemo.simulation.status[o.status],
                  t.common.orderType[o.orderType],
                ),
              }))}
            />
          ) : (
            <p className="text-sm leading-5 font-semibold text-text" aria-live="polite">
              {tDemo.simulation.orderLine(
                target.label,
                tDemo.simulation.status[target.status],
                t.common.orderType[target.orderType],
              )}
            </p>
          )}
          {actions.length === 0 ? (
            <p className="text-sm leading-5 text-text-muted">{tDemo.simulation.noActions}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <Button
                  key={action}
                  variant={action === 'REJECT' ? 'danger' : 'secondary'}
                  onClick={() => run(action)}
                >
                  {tDemo.simulation.actions[action]}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </SubGroup>
  );
}
