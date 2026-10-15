// src/features/checkout/PageParts.tsx —— 結帳頁的狀態列、店家狀態說明、送出結果提示、訂單明細與送出鈕
import clsx from 'clsx';
import { Check, Info, Phone, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode, Ref } from 'react';
import { Button, InlineAlert, Skeleton, Spinner, buttonClassName } from '@/components';
import { disclosedRemaining } from '@/domain/availability';
import type { CartLine } from '@/domain/cart';
import { formatTWD } from '@/domain/format';
import type { OrderType, QuoteResponse } from '@/domain/types';
import { checkout as tCheckout } from '@/i18n/strings/checkout';
import type { IssueAction, IssueCard } from './issueViews';
import { SectionCard } from './SectionCard';

// ───────── 狀態列（預留 min-height，內容切換不位移版面） ─────────

export type StatusBarState = 'confirming' | 'ok' | 'issues' | 'priceOnly' | 'precheckFailed';

export interface StatusBarProps {
  state: StatusBarState;
  /** 還有 n 項需要調整 */
  blocking: number;
  /** 價格更新項數 k */
  priceCount: number;
  onView: () => void;
}

export function StatusBar({ state, blocking, priceCount, onView }: StatusBarProps) {
  const T = tCheckout.statusBar;
  let content: ReactNode;
  switch (state) {
    case 'confirming':
      content = (
        <span className="inline-flex items-center gap-2 text-text-muted">
          <Spinner size="sm" decorative />
          {T.confirming}
        </span>
      );
      break;
    case 'ok':
      content = (
        <span className="inline-flex items-center gap-2 text-text-muted">
          <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
          {T.ok}
        </span>
      );
      break;
    case 'issues':
      content = (
        <span className="inline-flex items-center gap-2 font-medium text-warning">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          {T.issues(blocking)}
        </span>
      );
      break;
    case 'priceOnly':
      content = (
        <span className="inline-flex items-center gap-2 font-medium text-info">
          <Info aria-hidden="true" className="size-4 shrink-0" />
          {T.priceOnly(priceCount)}
        </span>
      );
      break;
    case 'precheckFailed':
      content = (
        <span className="inline-flex items-center gap-2 text-text-muted">
          <Info aria-hidden="true" className="size-4 shrink-0" />
          {T.precheckFailed}
        </span>
      );
      break;
  }
  const withView = state === 'issues' || state === 'priceOnly';
  return (
    <div
      data-testid="checkout-status-bar"
      data-state={state}
      className={clsx(
        'flex min-h-14 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm leading-5',
        state === 'issues'
          ? 'border-warning/30 bg-warning-soft'
          : state === 'priceOnly'
            ? 'border-info/25 bg-info-soft'
            : 'border-border bg-bg-subtle',
      )}
    >
      {content}
      {withView ? (
        <button
          type="button"
          onClick={onView}
          aria-label={T.viewAria}
          className="hit-area inline-flex min-h-(--hit-size) shrink-0 items-center px-2 font-semibold text-brand-text underline underline-offset-4"
        >
          {T.view}
        </button>
      ) : null}
    </div>
  );
}

// ───────── 店家狀態說明槽（營業中為空白佔位；不進異動清單） ─────────

export interface StoreNoticeProps {
  kind: 'PAUSED' | 'CLOSED' | null;
  /** 送出被退回或預檢才發現：「店家剛剛…」 */
  justNow: boolean;
  /** 已格式化的 HH:mm */
  pausedUntil: string | undefined;
  nextOpenAt: string | undefined;
  storeName: string;
  phone: string;
  /** 觸控面板不提供 tel: 連結 */
  kiosk: boolean;
  canSchedule: boolean;
  onSwitchToScheduled: () => void;
  noticeRef: Ref<HTMLDivElement>;
}

export function StoreNotice({
  kind,
  justNow,
  pausedUntil,
  nextOpenAt,
  storeName,
  phone,
  kiosk,
  canSchedule,
  onSwitchToScheduled,
  noticeRef,
}: StoreNoticeProps) {
  const T = tCheckout.storeNotice;
  let text: string | null = null;
  if (kind === 'PAUSED') {
    text = justNow
      ? T.pausedJustNow
      : pausedUntil !== undefined
        ? T.pausedUntil(pausedUntil)
        : T.paused;
  } else if (kind === 'CLOSED') {
    text = justNow
      ? T.closedJustNow(nextOpenAt ?? '')
      : nextOpenAt !== undefined
        ? T.closed(nextOpenAt)
        : T.closedNoTime;
  }
  return (
    <div
      ref={noticeRef}
      tabIndex={-1}
      data-testid="store-notice"
      className="min-h-11 outline-offset-4"
    >
      {text !== null ? (
        <InlineAlert
          tone="warning"
          role="status"
          action={
            <>
              {kind === 'CLOSED' && canSchedule ? (
                <Button variant="secondary" onClick={onSwitchToScheduled}>
                  {T.switchToScheduled}
                </Button>
              ) : null}
              {kind === 'PAUSED' && !kiosk ? (
                <a
                  href={tCheckout.alert.callStoreHref(phone)}
                  className={buttonClassName({ variant: 'secondary' })}
                >
                  <Phone aria-hidden="true" className="size-4" />
                  {T.callStore(storeName, phone)}
                </a>
              ) : null}
            </>
          }
        >
          {text}
        </InlineAlert>
      ) : null}
    </div>
  );
}

// ───────── 送出結果提示（頁首 Alert） ─────────

export type SubmitAlertKind = 'UNKNOWN' | 'RATE_LIMITED' | 'LOCK_TIMEOUT' | 'ERROR' | 'VALIDATION';

export interface SubmitAlertProps {
  kind: SubmitAlertKind;
  message: string;
  kiosk: boolean;
  storeName: string;
  phone: string;
  /** 冷卻中的剩餘秒數（429 / 503 附 retryAfterSeconds）；0 = 可重試 */
  coolingSeconds: number;
  retrying: boolean;
  onRetry: () => void;
  retryRef: Ref<HTMLButtonElement>;
}

export function SubmitAlert({
  kind,
  message,
  kiosk,
  storeName,
  phone,
  coolingSeconds,
  retrying,
  onRetry,
  retryRef,
}: SubmitAlertProps) {
  const T = tCheckout.alert;
  const showRetry = kind !== 'VALIDATION';
  const cooling = coolingSeconds > 0;
  return (
    <InlineAlert
      tone="error"
      title={kind === 'UNKNOWN' ? T.unknownTitle : undefined}
      action={
        <>
          {showRetry ? (
            <Button
              ref={retryRef}
              variant="secondary"
              aria-disabled={cooling ? true : undefined}
              loading={retrying}
              onClick={onRetry}
            >
              {cooling ? T.retryCooling(coolingSeconds) : T.retry}
            </Button>
          ) : null}
          {kind === 'UNKNOWN' && !kiosk ? (
            <a href={T.callStoreHref(phone)} className={buttonClassName({ variant: 'ghost' })}>
              <Phone aria-hidden="true" className="size-4" />
              {T.callStore(storeName)}
            </a>
          ) : null}
        </>
      }
    >
      <p>{message}</p>
    </InlineAlert>
  );
}

// ───────── ⑨ 訂單明細（CMP-17 狀態槽 + CMP-18 費用明細） ─────────

export interface OrderSummaryPanelProps {
  lines: ReadonlyArray<CartLine>;
  quote: QuoteResponse | null;
  lineIds: ReadonlyArray<string>;
  /** 計價中（debounce 或重新計價） */
  pricing: boolean;
  cards: ReadonlyArray<IssueCard>;
  busy: boolean;
  orderType: OrderType;
  /** 外送是否已選定可配送的行政區：未選時運費顯示「—」而非「免運」（03 §6.2） */
  deliveryZoneChosen?: boolean;
  onAction: (action: IssueAction) => void;
}

function lineStatus(
  lineId: string,
  cards: ReadonlyArray<IssueCard>,
): { text: string; tone: IssueCard['tone']; actions: IssueAction[] } | null {
  for (const card of cards) {
    if (!card.lineIds.includes(lineId)) continue;
    if (card.rows !== undefined) {
      const row = card.rows.find((r) => r.lineId === lineId);
      if (row !== undefined) {
        return { text: `${card.body}（${row.body}）`, tone: card.tone, actions: row.actions };
      }
      continue;
    }
    return { text: card.body, tone: card.tone, actions: card.actions };
  }
  return null;
}

export function OrderSummaryPanel({
  lines,
  quote,
  lineIds,
  pricing,
  cards,
  busy,
  orderType,
  deliveryZoneChosen = true,
  onAction,
}: OrderSummaryPanelProps) {
  const T = tCheckout.summary;
  const headingId = useId();
  const itemByLineId = new Map<string, QuoteResponse['items'][number]>();
  if (quote !== null) {
    for (const q of quote.items) {
      const id = lineIds[q.index];
      if (id !== undefined) itemByLineId.set(id, q);
    }
  }
  const hasLimited = lines.some((l) => {
    const q = itemByLineId.get(l.lineId);
    return q !== undefined && disclosedRemaining(q.remaining) !== null;
  });
  const snapshotSubtotal = lines.reduce((s, l) => s + l.snapshot.unitPrice * l.quantity, 0);
  const subtotal = quote?.subtotal ?? snapshotSubtotal;

  return (
    <SectionCard
      index={9}
      title={tCheckout.section.summary}
      headingId={headingId}
      aside={T.items(lines.length)}
    >
      <ul className="flex flex-col divide-y divide-border">
        {lines.map((line) => {
          const q = itemByLineId.get(line.lineId);
          const status = lineStatus(line.lineId, cards);
          const remaining = q !== undefined ? disclosedRemaining(q.remaining) : null;
          const unavailable = q !== undefined && q.availableQuantity === 0;
          const lineTotal = q !== undefined ? q.lineTotal : line.snapshot.unitPrice * line.quantity;
          const options = line.snapshot.optionLabels.join('・');
          return (
            <li key={line.lineId} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3 text-sm leading-5">
                <p className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="text-text-sub">{line.quantity}×</span>{' '}
                  <span className="font-medium text-text">{line.snapshot.name}</span>
                  {options !== '' ? <span className="ml-1 text-text-muted">{options}</span> : null}
                </p>
                <span
                  className={clsx(
                    'shrink-0 font-medium tabular-nums',
                    // 售完品項的原價是資訊文字（不是停用的控制項），對比須 ≥ 4.5:1，不用 text-text-disabled
                    unavailable ? 'text-text-muted line-through' : 'text-text',
                  )}
                >
                  {formatTWD(unavailable ? line.snapshot.unitPrice * line.quantity : lineTotal)}
                </span>
              </div>
              {/* 預留高度的狀態槽：無狀態時空白佔位，行高不因狀態改變（CMP-17） */}
              <div className="mt-1 flex min-h-11 flex-wrap items-center gap-2 text-xs leading-4">
                {status !== null ? (
                  <>
                    <span
                      className={clsx(
                        'rounded-sm px-2 py-1 font-medium',
                        status.tone === 'danger'
                          ? 'bg-danger-soft text-danger'
                          : status.tone === 'warning'
                            ? 'bg-warning-soft text-warning'
                            : 'bg-info-soft text-info',
                      )}
                    >
                      {status.text}
                    </span>
                    {status.actions.map((a) => (
                      <Button
                        key={`${a.spec.type}:${a.label}`}
                        variant="secondary"
                        aria-label={a.ariaLabel}
                        aria-disabled={busy ? true : undefined}
                        onClick={() => onAction(a)}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </>
                ) : remaining !== null ? (
                  <span className="rounded-sm bg-warning-soft px-2 py-1 font-medium text-warning">
                    {T.limitedLine(remaining)}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm leading-5">
        <div className="flex justify-between">
          <dt className="text-text-sub">{T.subtotal}</dt>
          <dd className="tabular-nums">
            {pricing && quote === null ? <Skeleton width={64} height={16} /> : formatTWD(subtotal)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-text-sub">{T.deliveryFee}</dt>
          <dd className="tabular-nums">
            {quote === null
              ? T.none
              : orderType !== 'DELIVERY' || !deliveryZoneChosen
                ? T.none
                : quote.deliveryFee === 0
                  ? T.free
                  : formatTWD(quote.deliveryFee)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-text-sub">{T.discount}</dt>
          <dd className="tabular-nums text-success">
            {quote === null || quote.discount === 0 ? T.none : formatTWD(-quote.discount)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <dt className="font-semibold text-text">{T.total}</dt>
          <dd
            className="text-h3 font-bold tabular-nums text-text"
            aria-busy={pricing ? true : undefined}
          >
            {quote === null ? T.estimating : formatTWD(quote.total)}
          </dd>
        </div>
      </dl>
      {hasLimited ? (
        <p className="mt-2 flex items-start gap-1 text-xs leading-4 text-text-muted">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {T.limitedNote}
        </p>
      ) : null}
    </SectionCard>
  );
}

// ───────── 送出鈕與鎖定說明 ─────────

export type SubmitBarState = 'idle' | 'submitting' | 'repricing' | 'locked' | 'cooling' | 'paused';

export interface SubmitBarProps {
  state: SubmitBarState;
  label: string;
  /** 鎖定 / 冷卻 / 暫停的說明（以 aria-describedby 關聯；預留兩行高） */
  helpText: string | undefined;
  /** 桌機常駐「Ctrl/⌘ + Enter」小字（觸控面板不顯示） */
  showShortcut: boolean;
  sticky: boolean;
  buttonRef: Ref<HTMLButtonElement>;
  onClick: () => void;
}

export function SubmitBar({
  state,
  label,
  helpText,
  showShortcut,
  sticky,
  buttonRef,
  onClick,
}: SubmitBarProps) {
  const helpId = useId();
  const hardDisabled = state === 'paused';
  const soft = state === 'locked' || state === 'cooling' || state === 'submitting';
  const busy = state === 'submitting';
  return (
    <div
      className={clsx(
        sticky &&
          'sticky bottom-0 z-30 -mx-4 border-t border-border bg-bg/95 px-4 pt-2 pb-[max(0.75rem,var(--safe-bottom,0px))] backdrop-blur [@media(max-height:480px)]:static',
      )}
    >
      <p
        id={helpId}
        className="min-h-10 text-sm leading-5 font-medium text-warning [@media(max-height:480px)]:min-h-0"
      >
        {helpText}
      </p>
      <div className="flex items-center gap-3">
        <button
          ref={buttonRef}
          type="button"
          disabled={hardDisabled}
          aria-disabled={soft ? true : undefined}
          aria-busy={busy ? true : undefined}
          aria-describedby={helpText !== undefined ? helpId : undefined}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          onClick={onClick}
          className={buttonClassName({
            variant: 'primary',
            size: 'lg',
            fullWidth: true,
            inactive: state === 'locked' || state === 'cooling' || hardDisabled,
            className: 'flex-1',
          })}
        >
          {busy || state === 'repricing' ? <Spinner size="sm" decorative /> : null}
          {label}
        </button>
        {showShortcut ? (
          <span className="shrink-0 text-xs leading-4 text-text-muted">
            {tCheckout.submit.shortcut}
          </span>
        ) : null}
      </div>
    </div>
  );
}
