// src/features/a11y/KeyboardNotice.tsx —— 鍵盤偵測提醒卡（CMP-41、FLOW-25、03 §10.3）
//
// 非 modal 的浮動卡：position: fixed、不佔流、不搶焦點（顯示時不呼叫 focus()）、不位移版面。
// ≥ 768 錨定於頂部 ⌨ 按鈕下方；< 768 與 Toast 同一浮動槽（共用 --toast-offset-bottom，Toast 優先、本卡讓位）。
// 不監聽鍵盤：Esc 由 HotkeyProvider 依 closeTarget 處理；階段與計時在 useKeyboardNotice。
// DOM 位置請放在 SkipLinks 之後、header 之前（Tab 可立即到達）。
import clsx from 'clsx';
import { Keyboard } from 'lucide-react';
import { useCallback, useEffect, useId, useRef } from 'react';
import type { FocusEvent, MouseEvent } from 'react';
import { Button, Kbd } from '@/components';
import { isNoticeShown } from '@/domain/kbdNotice';
import { t } from '@/i18n/zh-TW';
import { useKeyboardNotice } from './useKeyboardNotice';

export function KeyboardNotice() {
  const notice = useKeyboardNotice();
  const { phase, registerCard, hold, release, focusViewAllSeq } = notice;
  const shown = isNoticeShown(phase);
  const confirmed = phase === 'CONFIRMED';
  const cardRef = useRef<HTMLDivElement | null>(null);
  const viewAllRef = useRef<HTMLButtonElement | null>(null);
  const lastSeq = useRef(focusViewAllSeq);
  const ids = useId();
  const titleId = `${ids}-title`;
  const bodyId = `${ids}-body`;
  const openHintId = `${ids}-open-hint`;
  const declineHintId = `${ids}-decline-hint`;

  const setCard = useCallback(
    (el: HTMLDivElement | null) => {
      cardRef.current = el;
      registerCard(el);
    },
    [registerCard],
  );

  // FOCUS_VIEW_ALL：僅由鍵盤（Enter / Space）啟動「開啟」時，焦點由「開啟」移到「查看全部」
  useEffect(() => {
    if (focusViewAllSeq === lastSeq.current) return;
    lastSeq.current = focusViewAllSeq;
    if (confirmed) viewAllRef.current?.focus({ preventScroll: true });
  }, [focusViewAllSeq, confirmed]);

  // 提示 → 確認時按鈕元素會被替換：焦點若已不在卡內（元素被移除不會觸發 blur），解除「焦點暫停」
  useEffect(() => {
    if (!shown) return;
    const card = cardRef.current;
    if (card !== null && !card.contains(document.activeElement)) release('FOCUS');
  }, [shown, phase, release]);

  // 卡片收起時解除 hover / 焦點暫停，避免殘留到下一次顯示
  useEffect(() => {
    if (!shown) return;
    return () => {
      release('HOVER');
      release('FOCUS');
    };
  }, [shown, release]);

  if (!shown) return null;

  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) release('FOCUS');
  };

  // detail === 0：由鍵盤（Enter / Space）觸發的 click
  const viaKeyboard = (event: MouseEvent<HTMLButtonElement>): boolean => event.detail === 0;

  return (
    <div
      ref={setCard}
      role="group"
      aria-label={t.a11y.notice.groupLabel}
      data-zo-keyboard-notice=""
      data-state={confirmed ? 'confirmed' : 'prompt'}
      onMouseEnter={() => hold('HOVER')}
      onMouseLeave={() => release('HOVER')}
      onFocus={() => hold('FOCUS')}
      onBlur={handleBlur}
      className={clsx(
        'fixed z-60 animate-zo-fade-in',
        // < 768：與 Toast 同槽（左右 16px，置中）
        'inset-x-0 bottom-(--toast-offset-bottom) mx-auto w-[min(360px,calc(100vw-2rem))]',
        // ≥ 768：錨定於頂部 ⌨ 按鈕下方
        'md:inset-x-auto md:top-[calc(var(--topbar-h)-0.5rem)] md:right-6 md:bottom-auto md:mx-0 lg:right-8',
        // Demo 模式：浮動槽整體上移到 Demo 浮動按鈕之上（features/demo 於 :root 公布 --demo-fab-clearance）
        'max-md:bottom-[calc(var(--toast-offset-bottom)+var(--demo-fab-clearance,0px))]',
        'rounded-md border border-border-strong bg-bg px-3 pb-2 text-text shadow-lg',
        'forced-colors:border-[CanvasText] print:hidden',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute -top-1.5 right-[17px] hidden size-2.5 rotate-45 border-t border-l border-border-strong bg-bg md:block"
      />
      <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 py-1">
        <Keyboard aria-hidden="true" className="size-5 shrink-0 text-text-sub" />
        <p id={titleId} className="min-w-0 flex-1 text-sm leading-5 font-semibold">
          {confirmed ? t.a11y.notice.confirmedTitle : t.a11y.notice.title}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {confirmed ? (
            <>
              <Button
                key="view-all"
                ref={viewAllRef}
                variant="secondary"
                onClick={() => notice.viewAll()}
              >
                {t.a11y.notice.viewAll}
              </Button>
              <Button key="undo" variant="ghost" onClick={() => notice.undo()}>
                {t.a11y.notice.undo}
              </Button>
            </>
          ) : (
            <>
              <Button
                key="accept"
                variant="primary"
                aria-describedby={openHintId}
                onClick={(event) => notice.accept(viaKeyboard(event))}
              >
                {t.a11y.notice.accept}
              </Button>
              <Button
                key="decline"
                variant="ghost"
                aria-describedby={declineHintId}
                onClick={() => notice.decline()}
              >
                {t.a11y.notice.decline}
              </Button>
            </>
          )}
        </div>
      </div>
      <p id={bodyId} className="min-h-8 text-xs leading-4 text-text-sub">
        {confirmed ? (
          <>
            {t.a11y.notice.confirmedBodyBefore} <Kbd>{t.a11y.notice.confirmedBodyKey}</Kbd>{' '}
            {t.a11y.notice.confirmedBodyAfter}
          </>
        ) : notice.variant === 'hit' && notice.hitKey !== null ? (
          t.a11y.notice.bodyHit(notice.hitKey)
        ) : (
          t.a11y.notice.body
        )}
      </p>
      {!confirmed ? (
        <>
          <span id={openHintId} className="sr-only">
            {t.a11y.notice.screenReaderHint}
          </span>
          <span id={declineHintId} className="sr-only">
            {t.a11y.notice.declineHint}
          </span>
        </>
      ) : null}
    </div>
  );
}
