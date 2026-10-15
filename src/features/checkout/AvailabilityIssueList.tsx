// src/features/checkout/AvailabilityIssueList.tsx —— 結帳異動清單（CMP-40、FLOW-23）
//
// 非 modal、就地展開：`section[aria-labelledby]` → `h2`（tabindex -1，焦點落此）→ 說明 → 「全部套用建議」→ 異動項 `ul`。
// 標題以 aria-describedby 指向視覺隱藏的摘要節點（朗讀一次，不另用 role="alert"）。
import clsx from 'clsx';
import { ArrowUp, Check, Clock, TriangleAlert, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { Button, VisuallyHidden } from '@/components';
import { t } from '@/i18n/zh-TW';
import { checkout as tCheckout } from '@/i18n/strings/checkout';
import type { ApplyAllPlan, IssueAction, IssueCard, IssueRow } from './issueViews';

const T = tCheckout.issues;

export interface AvailabilityIssueListProps {
  cards: ReadonlyArray<IssueCard>;
  /** 還有 n 項需要處理（只計阻擋項，價格更新不計） */
  blockingCount: number;
  /** rejected：送出被退回（含按下送出後預檢發現異動）；peek：背景偵測後由「查看」展開 */
  mode: 'rejected' | 'peek';
  /** 重新計價中：逐行動作停用，避免連續點擊作用在已改變的購物車（FLOW-23） */
  busy: boolean;
  /** 全部套用建議；沒有可自動處理的項目為 null */
  plan: ApplyAllPlan | null;
  headingRef: Ref<HTMLHeadingElement>;
  onAction: (action: IssueAction) => void;
  onApplyAll: () => void;
  onBackToCart: () => void;
  /** 清單後緊接的內容（單項移除的「復原」，須在 Tab 順序中緊接清單之後） */
  after?: ReactNode;
}

const TONE_BOX = {
  danger: 'border-danger/25 bg-danger-soft',
  warning: 'border-warning/30 bg-warning-soft',
  info: 'border-info/25 bg-info-soft',
} as const;

const TONE_TEXT = {
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
} as const;

function ToneIcon({ tone, kind }: { tone: IssueCard['tone']; kind: IssueCard['kind'] }) {
  const cls = clsx('mt-0.5 size-5 shrink-0', TONE_TEXT[tone]);
  if (kind === 'PRICE') return <ArrowUp aria-hidden="true" className={cls} />;
  if (tone === 'danger') return <X aria-hidden="true" className={cls} />;
  if (kind === 'SLOT') return <Clock aria-hidden="true" className={cls} />;
  return <TriangleAlert aria-hidden="true" className={cls} />;
}

function ActionButtons({
  actions,
  busy,
  onAction,
}: {
  actions: ReadonlyArray<IssueAction>;
  busy: boolean;
  onAction: (a: IssueAction) => void;
}) {
  if (actions.length === 0) return null;
  return (
    // 320px 時直向堆疊；動作鈕間距 ≥ 8
    <div className="mt-3 flex flex-col gap-2 min-[400px]:flex-row min-[400px]:flex-wrap kiosk:gap-3">
      {actions.map((a) => (
        <Button
          key={`${a.spec.type}:${a.label}`}
          variant="secondary"
          aria-label={a.ariaLabel}
          aria-disabled={busy ? true : undefined}
          leadingIcon={a.destructive ? <Trash2 aria-hidden="true" className="size-4" /> : undefined}
          onClick={() => onAction(a)}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}

function Row({
  row,
  busy,
  onAction,
}: {
  row: IssueRow;
  busy: boolean;
  onAction: (a: IssueAction) => void;
}) {
  return (
    <li className="rounded-md border border-warning/20 bg-bg/60 p-3">
      <p className="text-sm leading-5 font-medium text-text">
        {row.label}
        <span className="ml-2 text-text-sub">{row.body}</span>
      </p>
      <ActionButtons actions={row.actions} busy={busy} onAction={onAction} />
    </li>
  );
}

export function AvailabilityIssueList({
  cards,
  blockingCount,
  mode,
  busy,
  plan,
  headingRef,
  onAction,
  onApplyAll,
  onBackToCart,
  after,
}: AvailabilityIssueListProps) {
  const headingId = useId();
  const descId = useId();

  const hasCondition = cards.some((c) => c.kind === 'CONDITION' && c.blocking);
  const title =
    blockingCount > 0
      ? hasCondition
        ? T.titleMixed(blockingCount)
        : T.titleItems(blockingCount)
      : T.titlePriceOnly;
  const description = mode === 'rejected' ? T.descRejected : T.descPeek;
  const srSummary = `${mode === 'rejected' ? T.descRejectedSr : T.descPeek}${cards
    .map((c) => c.summary)
    .join('；')}`;

  return (
    <>
      <section
        aria-labelledby={headingId}
        data-testid="availability-issue-list"
        className="rounded-lg border border-border bg-bg p-4 shadow-sm kiosk:p-6"
      >
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          aria-describedby={descId}
          className="text-h3 font-semibold text-text outline-offset-4"
        >
          {title}
        </h2>
        <VisuallyHidden>
          <span id={descId}>{srSummary}</span>
        </VisuallyHidden>
        <p aria-hidden="true" className="mt-1 text-sm leading-5 text-text-sub">
          {description}
        </p>

        {plan !== null && blockingCount > 0 ? (
          <div className="mt-3 flex flex-col items-start gap-2 min-[480px]:flex-row min-[480px]:items-center">
            <Button
              variant="secondary"
              aria-disabled={busy ? true : undefined}
              onClick={onApplyAll}
            >
              {T.applyAll}
            </Button>
            <span className="text-sm leading-5 text-text-sub">{plan.summary}</span>
          </div>
        ) : null}

        <ul className="mt-4 flex flex-col gap-3" aria-busy={busy ? true : undefined}>
          {cards.map((card) => (
            <li
              key={card.key}
              className={clsx('rounded-md border p-3 kiosk:p-4', TONE_BOX[card.tone])}
              data-kind={card.kind}
            >
              <div className="flex items-start gap-3">
                <ToneIcon tone={card.tone} kind={card.kind} />
                <div className="min-w-0 flex-1">
                  <p className="text-base leading-6 font-semibold text-text [overflow-wrap:anywhere]">
                    <VisuallyHidden>{T.kindLabel[card.kind]}：</VisuallyHidden>
                    {card.heading}
                  </p>
                  {card.sub !== undefined ? (
                    <p className="text-sm leading-5 text-text-sub [overflow-wrap:anywhere]">
                      {card.sub}
                    </p>
                  ) : null}
                  <p className="text-sm leading-5 text-text">{card.body}</p>
                  {card.note !== undefined ? (
                    <p className="mt-1 text-xs leading-4 text-text-muted">{card.note}</p>
                  ) : null}
                  {card.rows !== undefined ? (
                    <ul className="mt-3 flex flex-col gap-2">
                      {card.rows.map((row) => (
                        <Row key={row.key} row={row} busy={busy} onAction={onAction} />
                      ))}
                    </ul>
                  ) : null}
                  <ActionButtons actions={card.actions} busy={busy} onAction={onAction} />
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <button
            type="button"
            onClick={onBackToCart}
            className="hit-area min-h-(--hit-size) text-sm font-medium text-brand-text underline underline-offset-4"
          >
            {T.backToCart}
          </button>
        </div>
      </section>
      {after}
    </>
  );
}

// ───────── 單項移除後的「復原」（6 秒，hover / 焦點暫停） ─────────

export interface UndoNoticeProps {
  /** 用於重新計時：相同訊息再次出現時也要重新倒數 */
  nonce: number;
  message: string;
  onUndo: () => void;
  onExpire: () => void;
  durationMs?: number;
}

/**
 * 行內「復原」提示（比照 Toast：6 秒、hover / 焦點進入即暫停）。
 * 放在 DOM 中緊接異動清單之後，鍵盤使用者可在逾時前以 Tab 到達（全域 Toast 位於文件尾端，無法滿足此順序）。
 */
export function UndoNotice({
  nonce,
  message,
  onUndo,
  onExpire,
  durationMs = 6000,
}: UndoNoticeProps) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(durationMs);
  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  });

  // 新的提示：重設倒數
  useEffect(() => {
    remaining.current = durationMs;
  }, [nonce, durationMs]);

  useEffect(() => {
    if (paused) return;
    const startedAt = performance.now();
    const timer = setTimeout(() => expireRef.current(), Math.max(0, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - startedAt;
    };
  }, [paused, nonce]);

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="mt-3 flex items-center justify-between gap-3 rounded-md bg-text px-4 py-3 text-sm leading-5 font-medium text-bg"
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="hit-area -my-1 inline-flex min-h-(--hit-size) shrink-0 items-center rounded-sm px-2 font-bold underline underline-offset-4 focus-visible:outline-bg"
      >
        {T.undo}
      </button>
    </div>
  );
}

// ───────── 處理完成後的「已調整：…（復原）」摘要 ─────────

export interface AdjustedSummaryProps {
  text: string;
  onUndo: () => void;
  headingRef?: Ref<HTMLParagraphElement>;
}

export function AdjustedSummary({ text, onUndo, headingRef }: AdjustedSummaryProps) {
  return (
    <div
      data-testid="adjusted-summary"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/25 bg-success-soft px-3 py-2"
    >
      <p
        ref={headingRef}
        tabIndex={-1}
        className="flex min-w-0 items-center gap-2 text-sm leading-5 font-medium text-text outline-offset-4"
      >
        <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
        <VisuallyHidden>{t.common.tone.success}：</VisuallyHidden>
        <span>{text}</span>
      </p>
      <Button variant="ghost" onClick={onUndo}>
        {T.undo}
      </Button>
    </div>
  );
}
