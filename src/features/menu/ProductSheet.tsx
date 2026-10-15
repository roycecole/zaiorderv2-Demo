// src/features/menu/ProductSheet.tsx —— 商品客製化面板（PG-02、CMP-14）
//
// 由網址驅動：`?product=<id>`（新增）或 `?edit=<lineId>`（編輯購物車行）。返回鍵優先關閉面板（FR-PD-01，見 productSheetNav）。
// 預設值優先序（FR-PD-09）：編輯中的品項行 ＞ 點餐記憶（BR-35）＞ 商品預設選項。
import { Heart } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useSearchParams } from 'react-router';
import {
  Badge,
  Button,
  ErrorState,
  IconButton,
  ImageOrPlaceholder,
  Price,
  ProductTagBadge,
  Skeleton,
  Stepper,
  TextArea,
  VisuallyHidden,
  buttonClassName,
  useToast,
} from '@/components';
import { Sheet, SheetDescription } from '@/components/overlay';
import { disclosedRemaining } from '@/domain/availability';
import { MAX_QTY_PER_LINE } from '@/domain/cart';
import { formatTWD } from '@/domain/format';
import type { ID } from '@/domain/types';
import {
  KeyHint,
  useAnnounce,
  useHotkeyAction,
  useKeyShortcuts,
  useOverlayScope,
} from '@/features/a11y';
import { useCartStore } from '@/features/cart/cartStore';
import { cartSubtotal } from '@/features/cart/cartMath';
import { itemLabel, useCartFeedback } from '@/features/cart/useCartFeedback';
import { useMenu, useProduct } from '@/features/store/queries';
import { t } from '@/i18n/zh-TW';
import { errorMessageOf } from '@/i18n/strings/errors';
import { OptionGroupField } from './OptionGroupField';
import { EDIT_PARAM, PRODUCT_PARAM, useProductSheetNav } from './productSheetNav';
import {
  NOTE_MAX,
  buildInitialForm,
  firstGroupError,
  flattenSelected,
  groupErrors,
  noteLength,
  restoreDefaults,
  selectedLabels,
  selectedUnitPrice,
} from './sheetModel';
import type { SheetForm } from './sheetModel';
import { useFavorites } from './useFavorites';
import { useRememberedChoices } from './useRememberedChoices';

export interface ProductSheetProps {
  /** 關閉後還原焦點的元素（觸發的商品卡）；省略則還原開啟當下的焦點 */
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  /** 暫時不可加入的原因（例如店家暫停接單）；有值時「加入購物車」停用並說明原因 */
  addBlockedReason?: string | null | undefined;
}

function ProductSheetSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-4 grid gap-4">
      <VisuallyHidden>{t.common.loading}</VisuallyHidden>
      <Skeleton height={20} width="70%" />
      <Skeleton height={16} width="90%" />
      <Skeleton height={96} rounded="lg" />
      <Skeleton height={72} rounded="lg" />
    </div>
  );
}

export function ProductSheet({ returnFocusRef, addBlockedReason = null }: ProductSheetProps) {
  const [params] = useSearchParams();
  const nav = useProductSheetNav();
  const { toast } = useToast();
  const announce = useAnnounce();
  const feedback = useCartFeedback();
  const favorites = useFavorites();
  const remembered = useRememberedChoices();
  const confirmKeys = useKeyShortcuts('confirmAdd');
  const restoreKeys = useKeyShortcuts('restoreDefault');

  const productParam = params.get(PRODUCT_PARAM);
  const editParam = params.get(EDIT_PARAM);
  const editLine = useCartStore((s) =>
    editParam === null ? undefined : s.lines.find((l) => l.lineId === editParam),
  );
  const editing = editLine !== undefined;
  const productId: ID | null = editParam !== null ? (editLine?.productId ?? null) : productParam;
  const open = productId !== null;

  // 關閉動畫期間保留內容：記下最後一個非 null 的商品
  const [viewId, setViewId] = useState<ID | null>(productId);
  if (productId !== null && productId !== viewId) setViewId(productId);

  // 每次開啟為一個「工作階段」：重新開啟同一商品時選取狀態重新計算
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((n) => n + 1);
  }

  const productQuery = useProduct(viewId);
  const detail = productQuery.data;
  const menu = useMenu();
  const summary = useMemo(() => {
    if (viewId === null) return undefined;
    for (const category of menu.data?.categories ?? []) {
      const hit = category.products.find((p) => p.id === viewId);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }, [menu.data, viewId]);

  const excludeLineId = editLine?.lineId;
  const maxQty = useCartStore((s) =>
    detail === undefined
      ? MAX_QTY_PER_LINE
      : s.maxAddableFor(detail.id, detail.remainingToday, excludeLineId),
  );

  // 初始選取：資料到齊後計算；使用者操作後以 `edited`（綁定工作階段）覆寫，不在渲染中 setState
  const rememberedChoice = detail === undefined ? undefined : remembered.map[detail.id];
  const initialForm = useMemo<SheetForm | null>(
    () =>
      detail === undefined
        ? null
        : buildInitialForm({
            detail,
            editing:
              editLine === undefined
                ? undefined
                : {
                    optionIds: editLine.optionIds,
                    note: editLine.note,
                    quantity: editLine.quantity,
                  },
            remembered: rememberedChoice,
            maxQuantity: maxQty,
          }),
    [detail, editLine, rememberedChoice, maxQty],
  );
  const seedKey = detail === undefined ? null : `${session}:${detail.id}`;
  const [edited, setEdited] = useState<{ key: string; form: SheetForm } | null>(null);
  const form: SheetForm | null =
    edited !== null && edited.key === seedKey ? edited.form : initialForm;

  const update = (change: (current: SheetForm) => SheetForm): void => {
    if (seedKey === null || initialForm === null) return;
    setEdited((prev) => {
      const base = prev !== null && prev.key === seedKey ? prev.form : initialForm;
      return { key: seedKey, form: change(base) };
    });
  };

  const bodyRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // 第一個錯誤群組：焦點移到群組內第一個可用的選項（找不到時為群組本身）並捲入可視範圍
  const focusGroup = (groupId: ID): void => {
    const wrapper = bodyRef.current?.querySelector<HTMLElement>(`[data-option-group="${groupId}"]`);
    const target =
      wrapper?.querySelector<HTMLElement>('input:not(:disabled)') ??
      wrapper?.querySelector<HTMLElement>('fieldset');
    if (target === null || target === undefined) return;
    target.focus();
    target.scrollIntoView?.({ block: 'center' });
  };

  const soldOut = detail?.isSoldOut === true;
  const blocked = addBlockedReason !== null && addBlockedReason !== '';
  const ready = detail !== undefined && form !== null;

  const optionIds = ready ? flattenSelected(detail, form.selected) : [];
  const unit = ready ? selectedUnitPrice(detail, optionIds) : 0;
  const quantity = ready ? Math.min(form.quantity, Math.max(1, maxQty)) : 1;
  const total = unit * quantity;
  const groupError = ready ? firstGroupError(detail, form.selected) : null;
  const noteTooLong = ready && noteLength(form.note) > NOTE_MAX;
  const noQuota = maxQty < 1;
  const canSubmit =
    ready && !soldOut && !blocked && groupError === null && !noteTooLong && !noQuota;

  const stepQuantity = (delta: number): void => {
    if (!ready || soldOut) return;
    const next = Math.min(Math.max(1, quantity + delta), Math.max(1, maxQty));
    if (next === quantity) return;
    update((f) => ({ ...f, quantity: next }));
    announce(t.menu.sheet.quantityAnnounce(next, formatTWD(unit * next)));
  };

  const restore = (): void => {
    if (!ready || soldOut) return;
    update((f) => restoreDefaults(detail, f, { clearNote: !editing }));
    announce(t.menu.sheet.restored);
  };

  const submit = (): void => {
    if (!ready || soldOut || blocked) return;
    if (groupError !== null) {
      update((f) => ({ ...f, attempted: true }));
      focusGroup(groupError.group.id);
      return;
    }
    if (noteTooLong) {
      update((f) => ({ ...f, attempted: true }));
      noteRef.current?.focus();
      return;
    }
    if (noQuota) return;

    const labels = selectedLabels(detail, optionIds);
    const note = form.note.trim();
    if (editLine !== undefined) {
      useCartStore.getState().replaceLine(editLine.lineId, {
        productId: detail.id,
        quantity,
        optionIds,
        ...(note !== '' ? { note } : {}),
        snapshot: {
          name: detail.name,
          ...(detail.imageUrl ? { imageUrl: detail.imageUrl } : {}),
          unitPrice: unit,
          optionLabels: labels,
        },
      });
      const lines = useCartStore.getState().lines;
      toast({ message: t.menu.sheet.updated, tone: 'success' });
      announce(
        t.menu.sheet.updatedAnnounce(
          itemLabel(detail.name, labels),
          lines.length,
          formatTWD(cartSubtotal(lines)),
        ),
      );
      nav.close();
      return;
    }

    const outcome = feedback.add({
      productId: detail.id,
      name: detail.name,
      imageUrl: detail.imageUrl,
      remaining: detail.remainingToday,
      optionIds,
      optionLabels: labels,
      unitPrice: unit,
      quantity,
      note: note === '' ? undefined : note,
    });
    if (outcome.ok) nav.close();
  };

  // 單鍵快速鍵（範圍 'sheet'）：面板開啟期間背景頁面的範圍失效（07 §7.5）
  useOverlayScope(open, 'sheet');
  useHotkeyAction('qtyUp', () => stepQuantity(1), { enabled: open && ready });
  useHotkeyAction('qtyDown', () => stepQuantity(-1), { enabled: open && ready });
  useHotkeyAction('confirmAdd', submit, { enabled: open && ready });
  useHotkeyAction('restoreDefault', restore, { enabled: open && ready });

  const title =
    detail?.name ?? summary?.name ?? editLine?.snapshot.name ?? t.menu.sheet.loadingTitle;
  const remainingLabel = disclosedRemaining(detail?.remainingToday);
  const favorite = detail !== undefined && favorites.isFavorite(detail.id);

  const addLabel = (() => {
    if (soldOut) return t.common.soldOut;
    if (blocked) return addBlockedReason;
    if (noQuota) return t.common.limitReached;
    if (groupError !== null) return groupError.message;
    if (noteTooLong) return t.menu.sheet.noteTooLong(NOTE_MAX);
    return `${editing ? t.menu.sheet.update : t.menu.sheet.add} · ${formatTWD(total)}`;
  })();

  const maxReason =
    typeof detail?.remainingToday === 'number' && maxQty < MAX_QTY_PER_LINE
      ? t.common.maxReachedToday(detail.remainingToday)
      : t.common.maxQuantityReached(MAX_QTY_PER_LINE);

  const tip = ready ? form.tip : { kind: 'NONE' as const };
  const errors =
    ready && form.attempted ? groupErrors(detail, form.selected) : new Map<ID, string>();

  const media = detail?.imageUrl ? (
    <ImageOrPlaceholder
      media="PHOTO"
      imageUrl={detail.imageUrl}
      name={detail.name}
      aspect="16/9"
      loading="eager"
    />
  ) : undefined;

  const hasOptions = ready && detail.optionGroups.length > 0;
  const showAllergens = ready && detail.allergens.length > 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) nav.close();
      }}
      title={title}
      titleAccessory={
        detail !== undefined && favorites.available ? (
          <IconButton
            size="sm"
            label={
              favorite
                ? t.menu.favorite.removeLabel(detail.name)
                : t.menu.favorite.addLabel(detail.name)
            }
            aria-pressed={favorites.isMember ? favorite : undefined}
            icon={<Heart className={favorite ? 'fill-current text-brand-text' : undefined} />}
            onClick={() => favorites.toggle({ id: detail.id, name: detail.name })}
          />
        ) : undefined
      }
      media={media}
      returnFocusRef={returnFocusRef}
      footer={
        ready ? (
          <>
            <KeyHint action="qtyUp">
              <Stepper
                size="lg"
                label={t.menu.sheet.quantityLabel}
                value={quantity}
                min={1}
                max={Math.max(1, maxQty)}
                maxReason={maxReason}
                disabled={soldOut}
                announce={false}
                onChange={(next) => stepQuantity(next - quantity)}
              />
            </KeyHint>
            <button
              type="button"
              aria-disabled={canSubmit ? undefined : true}
              aria-keyshortcuts={confirmKeys}
              onClick={submit}
              className={buttonClassName({
                variant: 'primary',
                size: 'lg',
                inactive: !canSubmit,
                className: 'min-w-0 flex-1 whitespace-normal!',
              })}
            >
              <KeyHint action="confirmAdd">{addLabel}</KeyHint>
            </button>
          </>
        ) : null
      }
    >
      <div ref={bodyRef} className="mt-3 grid gap-5 pb-2">
        {ready ? (
          <>
            {tip.kind !== 'NONE' ? (
              <div
                role="status"
                className={
                  tip.kind === 'PARTIAL'
                    ? 'flex items-center justify-between gap-3 rounded-md bg-warning-soft px-3 py-2 text-sm leading-5 text-warning'
                    : 'flex items-center justify-between gap-3 rounded-md border border-brand-soft-strong bg-brand-soft px-3 py-2 text-sm leading-5 text-text'
                }
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {tip.kind === 'APPLIED'
                    ? t.menu.sheet.appliedLast(tip.text)
                    : tip.kind === 'PARTIAL'
                      ? t.menu.sheet.partialMemory
                      : t.menu.sheet.restored}
                </span>
                {tip.kind === 'APPLIED' || tip.kind === 'RESTORED' ? (
                  <button
                    type="button"
                    aria-disabled={tip.kind === 'RESTORED' ? true : undefined}
                    aria-keyshortcuts={restoreKeys}
                    onClick={() => {
                      if (tip.kind === 'APPLIED') restore();
                    }}
                    className="hit-area relative inline-flex min-h-8 shrink-0 items-center font-semibold whitespace-nowrap text-brand-text underline underline-offset-4 aria-disabled:cursor-not-allowed aria-disabled:text-text-disabled"
                  >
                    <KeyHint action="restoreDefault">{t.menu.sheet.restoreDefault}</KeyHint>
                  </button>
                ) : null}
              </div>
            ) : null}

            {detail.description ? (
              <SheetDescription className="-mt-2">{detail.description}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">
                {t.menu.sheet.priceDescription(formatTWD(unit))}
              </SheetDescription>
            )}

            <div className="-mt-2 flex flex-wrap items-center gap-2">
              <Price amount={unit} size="lg" />
              {soldOut ? <Badge tone="inverse">{t.common.soldOut}</Badge> : null}
              {detail.tags.map((tag) => (
                <ProductTagBadge key={tag} tag={tag} />
              ))}
              {remainingLabel !== null && !soldOut ? (
                <Badge tone="warning">{t.common.remaining(remainingLabel)}</Badge>
              ) : null}
            </div>

            {showAllergens ? (
              <p className="-mt-2 text-sm leading-5 text-text-sub">
                {t.menu.sheet.allergens}：
                {detail.allergens.map((a) => t.menu.allergen[a] ?? a).join('、')}
              </p>
            ) : null}

            {hasOptions
              ? detail.optionGroups.map((group) => (
                  <div key={group.id} data-option-group={group.id}>
                    <OptionGroupField
                      productId={detail.id}
                      group={group}
                      selected={form.selected[group.id] ?? []}
                      error={errors.get(group.id)}
                      disabled={soldOut}
                      onChange={(next) =>
                        update((f) => ({
                          ...f,
                          selected: { ...f.selected, [group.id]: next },
                          tip: f.tip.kind === 'RESTORED' ? { kind: 'NONE' } : f.tip,
                        }))
                      }
                    />
                  </div>
                ))
              : null}

            <TextArea
              ref={noteRef}
              label={t.menu.sheet.noteLabel}
              optional
              rows={2}
              value={form.note}
              placeholder={t.menu.sheet.notePlaceholder}
              disabled={soldOut}
              counter={{ current: noteLength(form.note), max: NOTE_MAX }}
              error={noteTooLong ? t.menu.sheet.noteTooLong(NOTE_MAX) : undefined}
              onChange={(event) => update((f) => ({ ...f, note: event.target.value }))}
            />
          </>
        ) : productQuery.isError ? (
          <ErrorState
            compact
            title={t.menu.sheet.loadError}
            message={errorMessageOf(productQuery.error)}
            retrying={productQuery.isFetching}
            onRetry={() => void productQuery.refetch()}
            actions={
              <Button variant="ghost" onClick={() => nav.close()}>
                {t.common.close}
              </Button>
            }
          />
        ) : (
          <ProductSheetSkeleton />
        )}
      </div>
    </Sheet>
  );
}
