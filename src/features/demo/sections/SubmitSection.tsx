// src/features/demo/sections/SubmitSection.tsx —— 送出結果模擬與最近送出紀錄（FR-DM-13；觸控面板模式不顯示）
import { useMemo } from 'react';
import { demo as tDemo } from '@/i18n/strings/demo';
import type { CreateOutcome } from '@/services/api/mock/requestLog';
import type { CreateLogEntry } from '@/services/api/mock/requestLog';
import { useDemoContext } from '../DemoContext';
import { ChoiceGroup } from '../parts';

type CreateMode = 'NORMAL' | 'BEFORE' | 'AFTER_COMMIT';

const MODE_CHOICES: ReadonlyArray<{ value: CreateMode; label: string }> = [
  { value: 'NORMAL', label: tDemo.submit.normal },
  { value: 'BEFORE', label: tDemo.submit.before },
  { value: 'AFTER_COMMIT', label: tDemo.submit.afterCommit },
];

/** 紀錄時間（台北時間 HH:mm:ss）：ISO 字串 'YYYY-MM-DDTHH:mm:ss+08:00' 直接取時分秒 */
export function logTime(at: string): string {
  return /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})/.exec(at)?.[1] ?? at;
}

export function describeOutcome(entry: CreateLogEntry): string {
  const o = tDemo.submit.outcome;
  const map: Record<CreateOutcome, string> = {
    CREATED: o.CREATED(entry.orderNo),
    REPLAYED: o.REPLAYED(entry.orderNo),
    REJECTED: o.REJECTED(entry.summary),
    FAILED_BEFORE: o.FAILED_BEFORE,
    RESPONSE_LOST: o.RESPONSE_LOST(entry.orderNo),
  };
  return map[entry.outcome];
}

export function SubmitSection() {
  const { demo, state, revision, patchState } = useDemoContext();

  const mode: CreateMode =
    state.failNext?.target === 'orders.create' ? (state.failNext.phase ?? 'BEFORE') : 'NORMAL';

  const onChange = (next: CreateMode): void => {
    if (next === 'NORMAL') {
      // 只清除「送出訂單」的失敗注入；其他端點的注入維持原樣
      if (state.failNext?.target === 'orders.create') patchState({ failNext: null });
      return;
    }
    patchState({ failNext: { target: 'orders.create', remaining: 1, phase: next } });
  };

  const log = useMemo<CreateLogEntry[]>(() => {
    try {
      return demo.getCreateLog(5);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision 只用來觸發重讀
  }, [demo, revision, state]);

  return (
    <>
      <ChoiceGroup
        legend={tDemo.submit.legend}
        hint={tDemo.submit.hint}
        choices={MODE_CHOICES}
        value={mode}
        onChange={onChange}
      />
      <div>
        <h4 className="text-sm leading-5 font-semibold text-text">{tDemo.submit.logTitle}</h4>
        {log.length === 0 ? (
          <p className="mt-1 text-sm leading-5 text-text-muted">{tDemo.submit.logEmpty}</p>
        ) : (
          <ol className="mt-1 space-y-2" aria-live="polite">
            {log.map((entry, i) => (
              <li
                key={`${entry.at}-${entry.idempotencyKey}-${i}`}
                className="text-sm leading-5 text-text-sub"
              >
                <span className="tabular-nums text-text-muted">{logTime(entry.at)}</span>
                {'　'}
                {describeOutcome(entry)}
                <span className="block text-xs leading-4 text-text-muted">
                  {tDemo.submit.keyFragment(entry.idempotencyKey.slice(-8))}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
