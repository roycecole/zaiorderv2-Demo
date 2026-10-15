import { describe, expect, it } from 'vitest';
import { describeNextOpen, describeStoreStatus, formatHoursSpan } from '../storeStatusText';
import { NOON_MS, makeStatus } from './fixtures';

const at = (iso: string): number => Date.parse(iso);

describe('describeStoreStatus（03 §6.3）', () => {
  it('OPEN：營業中・今日 {時段}；精簡版為今日 HH:mm 打烊', () => {
    const v = describeStoreStatus(makeStatus(), NOON_MS);
    expect(v.tone).toBe('success');
    expect(v.stateLabel).toBe('營業中');
    expect(v.text).toBe('營業中・今日 11:00–14:00、17:00–21:00');
    expect(v.shortText).toBe('營業中・今日 14:00 打烊');
  });

  it('OPEN：跨午夜時段標示次日打烊', () => {
    const v = describeStoreStatus(
      makeStatus({ todayHours: [{ open: '18:00', close: '02:00' }] }),
      at('2026-10-14T23:00:00+08:00'),
    );
    expect(v.text).toBe('營業中・今日 18:00–次日 02:00');
    expect(v.shortText).toBe('營業中・次日 02:00 打烊');
  });

  it('CLOSED / OUT_OF_HOURS：休息中・{下次營業時間} 開始營業', () => {
    const sameDay = describeStoreStatus(
      makeStatus({
        status: 'CLOSED',
        closedReason: 'OUT_OF_HOURS',
        nextOpenAt: '2026-10-14T17:00:00+08:00',
      }),
      at('2026-10-14T15:00:00+08:00'),
    );
    expect(sameDay.tone).toBe('warning');
    expect(sameDay.stateLabel).toBe('休息中');
    expect(sameDay.text).toBe('休息中・今日 17:00 開始營業');

    const tomorrow = describeStoreStatus(
      makeStatus({
        status: 'CLOSED',
        closedReason: 'OUT_OF_HOURS',
        nextOpenAt: '2026-10-15T11:00:00+08:00',
      }),
      at('2026-10-14T22:00:00+08:00'),
    );
    expect(tomorrow.text).toBe('休息中・明日 11:00 開始營業');
  });

  it('CLOSED / HOLIDAY：今日公休・{下次營業日} 營業', () => {
    const v = describeStoreStatus(
      makeStatus({
        status: 'CLOSED',
        closedReason: 'HOLIDAY',
        nextOpenAt: '2026-10-16T11:00:00+08:00',
      }),
      NOON_MS,
    );
    expect(v.icon).toBe('holiday');
    expect(v.text).toBe('今日公休・10/16（五） 11:00 營業');
  });

  it('CLOSED / LAST_ORDER_PASSED：已停止接單・可預約 {下次營業時間}', () => {
    const v = describeStoreStatus(
      makeStatus({
        status: 'CLOSED',
        closedReason: 'LAST_ORDER_PASSED',
        nextOpenAt: '2026-10-15T11:00:00+08:00',
      }),
      at('2026-10-14T20:50:00+08:00'),
    );
    expect(v.text).toBe('已停止接單・可預約 明日 11:00');
  });

  it('CLOSED 缺下次營業時間時降級，不顯示空白', () => {
    expect(
      describeStoreStatus(makeStatus({ status: 'CLOSED', closedReason: 'OUT_OF_HOURS' }), NOON_MS)
        .text,
    ).toBe('休息中');
    expect(
      describeStoreStatus(makeStatus({ status: 'CLOSED', closedReason: 'HOLIDAY' }), NOON_MS).text,
    ).toBe('今日公休');
  });

  it('PAUSED：無預計恢復時間為「暫停接單」；有則加註，60 分鐘內顯示「約 n 分鐘後恢復營業」', () => {
    expect(describeStoreStatus(makeStatus({ status: 'PAUSED' }), NOON_MS).text).toBe('暫停接單');

    const within = describeStoreStatus(
      makeStatus({ status: 'PAUSED', pausedUntil: '2026-10-14T12:30:00+08:00' }),
      NOON_MS,
    );
    expect(within.tone).toBe('danger');
    expect(within.text).toBe('暫停接單・預計 12:30 恢復（約 30 分鐘後）');
    expect(within.shortText).toBe('暫停接單・約 30 分鐘後恢復營業');

    const later = describeStoreStatus(
      makeStatus({ status: 'PAUSED', pausedUntil: '2026-10-14T15:00:00+08:00' }),
      NOON_MS,
    );
    expect(later.text).toBe('暫停接單・預計 15:00 恢復');
    expect(later.shortText).toBe('暫停接單・預計 15:00 恢復');

    const past = describeStoreStatus(
      makeStatus({ status: 'PAUSED', pausedUntil: '2026-10-14T11:00:00+08:00' }),
      NOON_MS,
    );
    expect(past.text).toBe('暫停接單・即將恢復營業');
  });
});

describe('describeNextOpen / formatHoursSpan', () => {
  it('相對日期：今日、明日、其他日期', () => {
    expect(describeNextOpen('2026-10-14T17:00:00+08:00', NOON_MS)).toBe('今日 17:00');
    expect(describeNextOpen('2026-10-15T11:00:00+08:00', NOON_MS)).toBe('明日 11:00');
    expect(describeNextOpen('2026-10-18T11:00:00+08:00', NOON_MS)).toBe('10/18（日） 11:00');
    expect(describeNextOpen(undefined, NOON_MS)).toBeNull();
  });

  it('時段顯示：跨午夜標示次日', () => {
    expect(formatHoursSpan('11:00', '14:00')).toBe('11:00–14:00');
    expect(formatHoursSpan('18:00', '02:00')).toBe('18:00–次日 02:00');
  });
});
