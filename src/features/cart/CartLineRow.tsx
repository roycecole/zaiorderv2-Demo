// src/features/cart/CartLineRow.tsx —— 購物車品項行（CMP-17 `CartLineItem`）：頁面（PG-03）與桌機訂單面板（CMP-31）共用
//
// 狀態只標示並提供就地動作，不阻擋前往結帳（阻擋與清單由結帳頁負責）：
// invalid（今日售完 / 已下架 / 選項暫無供應）、數量不足 / 超過單行上限、limited（今日剩 n 份）、reduced（已調整為 n 份）。
import clsx from 'clsx';
import { CircleX, Info, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Price, Stepper } from '@/components';
import type { CartLine } from '@/domain/cart';
import { formatTWD } from '@/domain/format';
import { KeyHint, useKeyShortcuts } from '@/features/a11y';
import { t } from '@/i18n/zh-TW';
import { lineMetaParts } from './cartMath';
import type { BlockingIssue, LineStatus } from './lineStatus';

export type CartLineVariant = 'page' | 'panel';

export interface CartLineRowProps {
  line: CartLine;
  variant: CartLineVariant;
  status?: LineStatus | undefined;
  /** 清單中有任一行有圖：無圖的行以首字塊補位（對齊文字左緣）；全部無圖則不保留縮圖欄（FR-CT-08） */
  showThumb: boolean;
  /** 步進器上限（`maxAddableFor` 的結果）；省略 = 20 */
  maxQuantity?: number | undefined;
  /** 達上限的原因（「今日只剩 n 份，已達上限」或「此品項已達上限 20 份」） */
  maxReason?: string | undefined;
  /** 剛以「改為 n 份」調整過（顯示「已調整為 n 份」與「復原」） */
  adjustedTo?: number | undefined;
  /** 目前正在重新計價：逐行動作停用，避免作用在已改變的內容（R-Y） */
  busy?: boolean | undefined;
  onQuantityChange?: ((line: CartLine, next: number) => void) | undefined;
  /** `−` 於 1 份時：請呼叫端詢問是否移除 */
  onRequestRemove?: ((line: CartLine) => void) | undefined;
  /** 「移除」：立即移除並提供「復原」Toast */
  onRemove: (line: CartLine) => void;
  onEdit: (line: CartLine) => void;
  onFit?: ((line: CartLine, quantity: number) => void) | undefined;
  onUndoAdjust?: ((line: CartLine) => void) | undefined;
  className?: string | undefined;
}

type NoticeTone = 'danger' | 'warning' | 'info';

const NOTICE_TONE: Record<NoticeTone, string> = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
};

const NOTICE_ICON: Record<NoticeTone, typeof Info> = {
  danger: CircleX,
  warning: TriangleAlert,
  info: Info,
};

function Notice({
  tone,
  children,
  actions,
}: {
  tone: NoticeTone;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = NOTICE_ICON[tone];
  return (
    <div className={clsx('mt-2 rounded-md px-3 py-2 text-sm leading-5', NOTICE_TONE[tone])}>
      <p className="flex items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{children}</span>
      </p>
      {actions !== undefined ? (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0">{actions}</div>
      ) : null}
    </div>
  );
}

function NoticeAction({
  label,
  ariaLabel,
  onClick,
  disabled,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={disabled ? true : undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className="hit-area relative inline-flex min-h-9 items-center text-sm leading-5 font-semibold text-text underline underline-offset-4"
    >
      {label}
    </button>
  );
}

function LineThumb({
  imageUrl,
  name,
  size,
}: {
  imageUrl?: string | undefined;
  name: string;
  size: 'sm' | 'md';
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const box = size === 'sm' ? 'size-10' : 'size-14';
  const showImage = typeof imageUrl === 'string' && imageUrl !== '' && failedUrl !== imageUrl;
  if (showImage) {
    return (
      <span className={clsx('relative block shrink-0 overflow-hidden rounded-sm bg-bg-muted', box)}>
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(imageUrl)}
          className="absolute inset-0 size-full object-cover"
        />
      </span>
    );
  }
  const glyph = Array.from(name.trim())[0] ?? '';
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'grid shrink-0 place-items-center rounded-sm bg-bg-muted font-semibold text-text-muted',
        'forced-colors:border forced-colors:border-[CanvasText]',
        box,
      )}
    >
      {glyph}
    </span>
  );
}

/** 阻擋原因的文案（PG-03 品項狀態表、03 §9） */
export function issueText(issue: BlockingIssue): string {
  switch (issue.kind) {
    case 'UNAVAILABLE':
      switch (issue.code) {
        case 'ITEM_SOLD_OUT':
          return t.common.soldOut;
        case 'ITEM_UNLISTED':
          return t.cart.line.unlisted;
        case 'OPTION_INVALID':
          return t.cart.line.optionInvalid;
        case 'OPTION_UNAVAILABLE':
          return t.cart.line.optionUnavailable;
      }
      return t.common.unavailable;
    case 'EXCEEDED':
      return t.errors.quantityExceededLine(issue.available);
    case 'INSUFFICIENT':
      if (issue.available === 0) return t.cart.line.occupied;
      if (issue.remaining === null) return t.cart.line.atMost(issue.available);
      return issue.groupSize > 1
        ? t.cart.line.groupInsufficient(issue.groupRequested, issue.remaining)
        : t.cart.line.insufficient(issue.remaining, issue.requested);
  }
}

export function CartLineRow({
  line,
  variant,
  status,
  showThumb,
  maxQuantity,
  maxReason,
  adjustedTo,
  busy = false,
  onQuantityChange,
  onRequestRemove,
  onRemove,
  onEdit,
  onFit,
  onUndoAdjust,
  className,
}: CartLineRowProps) {
  const editKeys = useKeyShortcuts('editLine');
  const removeKeys = useKeyShortcuts('removeLine');
  const name = line.snapshot.name;
  const issue = status?.issue;
  const unavailable = issue?.kind === 'UNAVAILABLE';
  const unit = status?.unitPrice ?? line.snapshot.unitPrice;
  const total = unit * line.quantity;
  const meta = lineMetaParts(line, t.cart.line.notePrefix);
  const stepMax = Math.max(maxQuantity ?? 20, line.quantity);
  const panel = variant === 'panel';

  const editButton = (
    <button
      type="button"
      aria-label={t.cart.line.editLabel(name)}
      aria-keyshortcuts={editKeys}
      aria-disabled={busy ? true : undefined}
      onClick={() => {
        if (!busy) onEdit(line);
      }}
      className="hit-area relative inline-flex h-7 items-center gap-1 text-sm leading-5 font-semibold text-brand-text kiosk:h-(--hit-size) kiosk:min-w-(--hit-size) kiosk:justify-center kiosk:text-base"
    >
      <Pencil aria-hidden="true" className="size-3.5" />
      <KeyHint action="editLine">{t.common.edit}</KeyHint>
    </button>
  );
  const removeButton = (
    <button
      type="button"
      aria-label={t.cart.line.removeLabel(name)}
      aria-keyshortcuts={removeKeys}
      aria-disabled={busy ? true : undefined}
      onClick={() => {
        if (!busy) onRemove(line);
      }}
      className="hit-area relative inline-flex h-7 items-center gap-1 text-sm leading-5 font-semibold text-text-sub kiosk:h-(--hit-size) kiosk:min-w-(--hit-size) kiosk:justify-center kiosk:text-base"
    >
      <Trash2 aria-hidden="true" className="size-3.5" />
      <KeyHint action="removeLine">{t.common.remove}</KeyHint>
    </button>
  );

  const notices = (
    <>
      {issue !== undefined ? (
        <Notice
          tone={unavailable ? 'danger' : 'warning'}
          actions={
            <>
              {(issue.kind === 'INSUFFICIENT' || issue.kind === 'EXCEEDED') &&
              issue.available >= 1 &&
              onFit !== undefined ? (
                <NoticeAction
                  label={t.cart.line.fitTo(issue.available)}
                  ariaLabel={t.cart.line.fitLabel(name, issue.available)}
                  disabled={busy}
                  onClick={() => onFit(line, issue.available)}
                />
              ) : null}
              {issue.kind === 'UNAVAILABLE' &&
              (issue.code === 'OPTION_UNAVAILABLE' || issue.code === 'OPTION_INVALID') ? (
                <NoticeAction
                  label={t.cart.line.reselect}
                  ariaLabel={t.cart.line.reselectLabel(name)}
                  disabled={busy}
                  onClick={() => onEdit(line)}
                />
              ) : null}
              <NoticeAction
                label={t.common.remove}
                ariaLabel={t.cart.line.removeLabel(name)}
                disabled={busy}
                onClick={() => onRemove(line)}
              />
            </>
          }
        >
          {issueText(issue)}
        </Notice>
      ) : null}
      {issue === undefined && adjustedTo !== undefined ? (
        <Notice
          tone="info"
          actions={
            onUndoAdjust !== undefined ? (
              <NoticeAction
                label={t.common.undo}
                ariaLabel={t.cart.line.undoAdjustLabel(name)}
                onClick={() => onUndoAdjust(line)}
              />
            ) : undefined
          }
        >
          {t.cart.line.adjusted(adjustedTo)}
        </Notice>
      ) : null}
      {issue === undefined && status?.limited !== undefined ? (
        <p className="mt-1 flex items-center gap-1.5 text-sm leading-5 font-medium text-warning">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          {t.cart.line.remainingToday(status.limited)}
        </p>
      ) : null}
      {panel && status?.price !== undefined ? (
        <Notice tone="info">
          {t.cart.line.priceUpdated(formatTWD(status.price.from), formatTWD(status.price.to))}
        </Notice>
      ) : null}
    </>
  );

  const metaBlock =
    meta.length > 0 ? (
      <div className="mt-0.5 text-sm leading-5 text-text-muted">
        {meta.map((part) => (
          <p key={part} className="[overflow-wrap:anywhere]">
            {part}
          </p>
        ))}
      </div>
    ) : null;

  const thumb = showThumb ? (
    <LineThumb imageUrl={line.snapshot.imageUrl} name={name} size={panel ? 'sm' : 'md'} />
  ) : null;

  if (panel) {
    return (
      <li
        data-line-id={line.lineId}
        tabIndex={-1}
        className={clsx(
          'flex items-start gap-3 border-b border-border py-4 last:border-b-0',
          className,
        )}
      >
        {thumb}
        <div className="min-w-0 flex-1">
          <p className="text-base leading-6 font-semibold [overflow-wrap:anywhere]">
            <span className="mr-1 font-medium text-text-sub tabular-nums">{line.quantity}×</span>
            {name}
          </p>
          {metaBlock}
          {notices}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Price amount={total} tone={unavailable ? 'muted' : 'default'} />
          <div className="flex flex-col items-end kiosk:gap-3">
            {editButton}
            {removeButton}
          </div>
        </div>
      </li>
    );
  }

  return (
    <li
      data-line-id={line.lineId}
      tabIndex={-1}
      className={clsx(
        'flex items-start gap-3 border-b border-border py-4 last:border-b-0',
        className,
      )}
    >
      {thumb}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          {/* 頁面 h1 之下直接是品項：以 h2 命名，標題層級不跳級（§10.4） */}
          <h2 className="min-w-0 text-base leading-6 font-semibold [overflow-wrap:anywhere]">
            {name}
          </h2>
          <Price amount={total} tone={unavailable ? 'muted' : 'default'} />
        </div>
        {metaBlock}
        {notices}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Stepper
            size="lg"
            label={t.common.stepper.quantityOf(name)}
            value={line.quantity}
            min={1}
            max={stepMax}
            maxReason={maxReason}
            disabled={busy || unavailable}
            announce={false}
            decreaseLabel={t.cart.line.decreaseLabel(name)}
            increaseLabel={t.cart.line.increaseLabel(name)}
            removeLabel={t.cart.line.removeLabel(name)}
            onChange={(next) => onQuantityChange?.(line, next)}
            onRemove={onRequestRemove !== undefined ? () => onRequestRemove(line) : undefined}
          />
          <div className="flex items-center gap-4">
            {editButton}
            {removeButton}
          </div>
        </div>
      </div>
    </li>
  );
}
