// src/features/demo/sections/StoreTimeSection.tsx —— 店家狀態與時間穿梭（FR-DM-04、FR-DM-05）
import { useMemo, useState } from 'react';
import { Button, TextField, useToast } from '@/components';
import { formatDateTime } from '@/domain/format';
import type { ISODate } from '@/domain/types';
import { useStoreInfo } from '@/features/store/queries';
import { demo as tDemo } from '@/i18n/strings/demo';
import { getClock } from '@/services/clock';
import { useDemoContext } from '../DemoContext';
import { ChoiceGroup, SubGroup } from '../parts';
import {
  DEFAULT_CALENDAR,
  localInputToIso,
  presetInstant,
  shiftInstant,
  TIME_PRESETS,
  toLocalInputValue,
} from '../timeTravel';
import type { BusinessCalendar, TimePresetKey } from '../timeTravel';

const STORE_CHOICES = (['AUTO', 'OPEN', 'CLOSED', 'PAUSED'] as const).map((value) => ({
  value,
  label: tDemo.storeTime.store[value],
}));

export function StoreTimeSection() {
  const { state, patchState } = useDemoContext();
  const { toast } = useToast();
  const info = useStoreInfo();
  const [custom, setCustom] = useState(() => toLocalInputValue(getClock().now().getTime()));
  const [customError, setCustomError] = useState<string | null>(null);

  const calendar = useMemo<BusinessCalendar>(() => {
    if (info.data === undefined) return DEFAULT_CALENDAR;
    return {
      openWeekdays: new Set(info.data.businessHours.map((h) => h.weekday)),
      closedDates: new Set<ISODate>(
        info.data.specialDays.filter((d) => d.type === 'CLOSED').map((d) => d.date),
      ),
    };
  }, [info.data]);

  const setClockOverride = (clockOverride: string | null): void => {
    patchState({ clockOverride });
    if (clockOverride === null) {
      toast({ message: tDemo.storeTime.backToReal, tone: 'info' });
    } else {
      toast({ message: tDemo.storeTime.applied(formatDateTime(clockOverride)), tone: 'success' });
    }
  };

  const nowMs = getClock().now().getTime();

  const applyCustom = (): void => {
    const iso = localInputToIso(custom);
    if (iso === null) {
      setCustomError(tDemo.storeTime.customError);
      return;
    }
    setCustomError(null);
    setClockOverride(iso);
  };

  return (
    <>
      <ChoiceGroup
        legend={tDemo.storeTime.storeLegend}
        choices={STORE_CHOICES}
        value={state.storeOverride}
        onChange={(storeOverride) => patchState({ storeOverride })}
      />
      <SubGroup legend={tDemo.storeTime.timeLegend}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setClockOverride(null)}>
            {tDemo.storeTime.presets.real}
          </Button>
          {TIME_PRESETS.map((p) => (
            <Button
              key={p.key}
              variant="secondary"
              onClick={() =>
                setClockOverride(presetInstant(p.key as TimePresetKey, nowMs, calendar))
              }
            >
              {tDemo.storeTime.presets[p.key]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setClockOverride(shiftInstant(nowMs, 15))}>
            {tDemo.storeTime.forward15}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setClockOverride(shiftInstant(nowMs, 24 * 60))}
          >
            {tDemo.storeTime.forward24h}
          </Button>
        </div>
        <p className="text-sm leading-5 text-text-muted">{tDemo.storeTime.hint}</p>
        <div className="flex items-start gap-2">
          <TextField
            containerClassName="flex-1"
            label={tDemo.storeTime.customLabel}
            type="datetime-local"
            value={custom}
            error={customError}
            onChange={(e) => setCustom(e.target.value)}
          />
          <Button variant="secondary" className="mt-7" onClick={applyCustom}>
            {tDemo.storeTime.customApply}
          </Button>
        </div>
      </SubGroup>
    </>
  );
}
