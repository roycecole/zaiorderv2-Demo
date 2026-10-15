// src/features/menu/ProductCard.tsx —— 商品卡（CMP-13、03 §6.6、§6.7、§6.8）
//
// 版面：GRID（圖卡）/ LIST（橫式）；圖片區依 `cardMedia` 為 PHOTO / PLACEHOLDER / THUMB / NONE。
// 缺漏降級：圖片、描述、標籤、剩餘份數皆可缺，缺漏時整塊隱藏，不留空標題或空白行（FLOW-17）。
// 動作區（依序）：售完 → 快速加入後的 `− n ＋` → 有點餐記憶的「↻ 再點」+「＋」→ 「＋ 加入」。
//
// 整張卡片可點（開啟商品面板）：以品名按鈕的偽元素覆蓋全卡（stretched link），
// 其餘動作按鈕以 z-index 浮在其上，鍵盤與螢幕閱讀器使用者則走品名按鈕與各動作按鈕。
import clsx from 'clsx';
import { Heart, Plus, Repeat2 } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import {
  Badge,
  ImageOrPlaceholder,
  Kbd,
  Price,
  ProductTagBadge,
  Stepper,
  VisuallyHidden,
} from '@/components';
import { disclosedRemaining } from '@/domain/availability';
import { MAX_QTY_PER_LINE } from '@/domain/cart';
import { cardMedia } from '@/domain/menuLayout';
import type { ResolvedLayout } from '@/domain/menuLayout';
import type { RememberedChoice } from '@/domain/rememberedChoice';
import type { ProductSummary } from '@/domain/types';
import { KeyHint, useKeyShortcuts } from '@/features/a11y';
import { optionSummary } from '@/features/cart/cartMath';
import { t } from '@/i18n/zh-TW';

export interface ProductCardProps {
  product: ProductSummary;
  layout: ResolvedLayout;
  /** 分類圖示：缺圖時佔位圖塊的內容（無則品名首字） */
  categoryIcon?: string | undefined;
  /** 搜尋結果：標示所屬分類 */
  categoryName?: string | undefined;
  /** 點餐記憶：只有「記了至少一個選項」者才傳入（§6.8）；未啟用或無記憶為 undefined */
  remembered?: RememberedChoice | undefined;
  /** 同商品在購物車內的總份數（徽章） */
  cartQuantity: number;
  /** 快速加入行的份數（null = 沒有）；有值且商品無必選選項時，動作區為 `− n ＋` */
  quickQuantity: number | null;
  /** 步進器上限（已扣除購物車內同商品其他行與剩餘份數） */
  quickMax: number;
  /** roving tabindex：此卡為整個菜單網格唯一的 Tab 停點 */
  tabStop: boolean;
  /** false = 不使用 roving（觸控面板：以原生 Tab 順序操作） */
  roving: boolean;
  /** 收藏心形：undefined = 不提供（訪客 / 觸控面板） */
  favorite?: { active: boolean } | undefined;
  /** 暫時不可加入的原因（店家狀態政策）；「加入」停用並說明 */
  blockedReason?: string | null | undefined;
  /** 單鍵快速鍵已啟用：取得焦點的卡片底部顯示提示列 */
  showHints: boolean;
  /** 「↻ 再點」處理中（取商品詳情驗證記憶） */
  repeating?: boolean | undefined;
  /** 卡片內任一元素取得焦點：成為 roving tabindex 的 Tab 停點 */
  onFocusCard?: ((productId: string) => void) | undefined;
  onOpen: (product: ProductSummary, trigger: HTMLElement) => void;
  onQuickAdd: (product: ProductSummary) => void;
  onQuickChange: (product: ProductSummary, next: number) => void;
  onQuickRemove: (product: ProductSummary) => void;
  onRepeat: (product: ProductSummary, remembered: RememberedChoice) => void;
  onToggleFavorite: (product: ProductSummary) => void;
}

const ACTION_BASE =
  'relative z-[2] inline-flex shrink-0 items-center justify-center gap-1 rounded-pill border text-sm leading-5 font-semibold whitespace-nowrap select-none transition-colors duration-150 hit-area';
const ACTION_BRAND = 'border-brand bg-bg text-brand-text hover:bg-brand-soft';
const ACTION_INACTIVE =
  'cursor-not-allowed border-transparent bg-bg-muted text-text-disabled hover:bg-bg-muted';

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -top-2 -right-2 h-[18px] min-w-[18px] rounded-pill bg-brand px-1 text-center text-xs leading-[18px] font-bold text-on-brand tabular-nums shadow-[0_0_0_2px_var(--color-bg)] forced-colors:border"
    >
      {count}
    </span>
  );
}

export function ProductCard({
  product,
  layout,
  categoryIcon,
  categoryName,
  remembered,
  cartQuantity,
  quickQuantity,
  quickMax,
  tabStop,
  roving,
  favorite,
  blockedReason,
  showHints,
  repeating = false,
  onFocusCard,
  onOpen,
  onQuickAdd,
  onQuickChange,
  onQuickRemove,
  onRepeat,
  onToggleFavorite,
}: ProductCardProps) {
  const ids = useId();
  const nameId = `${ids}-name`;
  const priceId = `${ids}-price`;
  const descId = `${ids}-desc`;
  const blockedId = `${ids}-blocked`;
  const addKeys = useKeyShortcuts('addFocused');
  const repeatKeys = useKeyShortcuts('repeatFocused');
  const favoriteKeys = useKeyShortcuts('toggleFavorite');

  const soldOut = product.isSoldOut;
  const hasImage = typeof product.imageUrl === 'string' && product.imageUrl !== '';
  const media = cardMedia(layout, hasImage);
  const remaining = disclosedRemaining(product.remainingToday);
  const hasDescription =
    typeof product.description === 'string' && product.description.trim() !== '';
  const needsSheet = product.hasRequiredOptions;
  const blocked = blockedReason !== null && blockedReason !== undefined && blockedReason !== '';
  const lastText = remembered !== undefined ? optionSummary(remembered.labels) : '';
  const showMemory = remembered !== undefined && remembered.optionIds.length > 0 && !soldOut;
  const showStepper = !soldOut && !needsSheet && quickQuantity !== null;
  const hasTags = soldOut || product.tags.length > 0 || remaining !== null;
  const bare =
    layout === 'LIST' &&
    media === 'NONE' &&
    !hasDescription &&
    !hasTags &&
    !showMemory &&
    categoryName === undefined;

  const tagBadges: ReactNode = hasTags ? (
    <>
      {soldOut ? (
        <Badge tone="inverse">{t.common.soldOut}</Badge>
      ) : (
        <>
          {product.tags.map((tag) => (
            <ProductTagBadge key={tag} tag={tag} />
          ))}
          {remaining !== null ? (
            <Badge tone="warning">{t.common.remaining(remaining)}</Badge>
          ) : null}
        </>
      )}
    </>
  ) : null;

  const name = (
    <h3 id={nameId} className={clsx('min-w-0 text-h3 font-semibold', soldOut && 'text-text-muted')}>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={(event) => onOpen(product, event.currentTarget)}
        className={clsx(
          'block w-full text-left [overflow-wrap:anywhere] line-clamp-2',
          // 偽元素覆蓋整張卡片：點卡片任一處開啟面板；動作按鈕以 z-[2] 浮在其上
          'after:absolute after:inset-0 after:z-[1] after:content-[""]',
          'focus-visible:after:rounded-lg',
        )}
      >
        {product.name}
      </button>
    </h3>
  );

  // id 供卡片的 aria-describedby 關聯（Price 元件本身不接受 id）
  const price = (
    <span id={priceId} className="shrink-0">
      <Price
        amount={product.displayPrice}
        from={product.isPriceFrom}
        tone={soldOut ? 'muted' : 'default'}
        size="md"
      />
    </span>
  );

  const addLabel =
    cartQuantity > 0
      ? t.menu.card.addLabelInCart(product.name, cartQuantity)
      : t.menu.card.addLabel(product.name);

  let action: ReactNode;
  if (soldOut) {
    action = (
      <button
        type="button"
        aria-disabled="true"
        aria-label={t.menu.card.soldOutLabel(product.name)}
        className={clsx(
          ACTION_BASE,
          ACTION_INACTIVE,
          'min-h-9 px-3 kiosk:min-h-(--hit-size) kiosk:px-5',
        )}
      >
        {t.menu.card.soldOutAction}
      </button>
    );
  } else if (showStepper) {
    action = (
      <span data-card-stepper="" className="relative z-[2] inline-flex">
        <Stepper
          size="md"
          label={t.common.stepper.quantityOf(product.name)}
          value={quickQuantity}
          min={1}
          max={Math.max(quickMax, quickQuantity)}
          maxReason={
            typeof product.remainingToday === 'number' && quickMax < MAX_QTY_PER_LINE
              ? t.common.maxReachedToday(product.remainingToday)
              : t.common.maxQuantityReached(MAX_QTY_PER_LINE)
          }
          announce={false}
          decreaseLabel={t.menu.card.decreaseLabel(product.name)}
          increaseLabel={t.menu.card.increaseLabel(product.name)}
          removeLabel={t.menu.card.removeLabel(product.name)}
          onChange={(next) => onQuickChange(product, next)}
          onRemove={() => onQuickRemove(product)}
        />
      </span>
    );
  } else if (showMemory && remembered !== undefined) {
    action = (
      <span className="relative z-[2] inline-flex items-center gap-2">
        <button
          type="button"
          aria-label={t.menu.card.repeatLabel(product.name, lastText)}
          aria-keyshortcuts={repeatKeys}
          aria-disabled={repeating || blocked ? true : undefined}
          aria-describedby={blocked ? blockedId : undefined}
          onClick={() => {
            if (!repeating && !blocked) onRepeat(product, remembered);
          }}
          className={clsx(
            ACTION_BASE,
            repeating || blocked ? ACTION_INACTIVE : ACTION_BRAND,
            'min-h-9 pr-3 pl-2 kiosk:min-h-(--hit-size) kiosk:px-5',
          )}
        >
          <Repeat2 aria-hidden="true" className="size-4 shrink-0 kiosk:size-6" />
          <KeyHint action="repeatFocused">{t.menu.card.repeat}</KeyHint>
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={t.menu.card.adjustLabel(product.name)}
          aria-keyshortcuts={addKeys}
          onClick={(event) => onOpen(product, event.currentTarget)}
          className={clsx(ACTION_BASE, ACTION_BRAND, 'size-9 kiosk:size-(--hit-size)')}
        >
          <KeyHint action="addFocused">
            <Plus aria-hidden="true" className="size-[18px] kiosk:size-6" />
          </KeyHint>
          <CountBadge count={cartQuantity} />
        </button>
      </span>
    );
  } else {
    const inactive = blocked;
    action = (
      <button
        type="button"
        data-card-add=""
        aria-haspopup={needsSheet ? 'dialog' : undefined}
        aria-label={addLabel}
        aria-keyshortcuts={addKeys}
        aria-disabled={inactive ? true : undefined}
        aria-describedby={blocked ? blockedId : undefined}
        onClick={(event) => {
          if (inactive) return;
          if (needsSheet) onOpen(product, event.currentTarget);
          else onQuickAdd(product);
        }}
        className={clsx(
          ACTION_BASE,
          inactive ? ACTION_INACTIVE : ACTION_BRAND,
          'min-h-9 pr-3 pl-2 kiosk:min-h-(--hit-size) kiosk:px-5',
        )}
      >
        <Plus aria-hidden="true" className="size-4 shrink-0 kiosk:size-6" />
        <KeyHint action="addFocused">{t.menu.card.add}</KeyHint>
        <CountBadge count={cartQuantity} />
      </button>
    );
  }

  const blockedNote = blocked ? (
    <VisuallyHidden id={blockedId}>{blockedReason}</VisuallyHidden>
  ) : null;

  const favoriteButton =
    favorite !== undefined ? (
      <button
        type="button"
        aria-pressed={favorite.active}
        aria-label={
          favorite.active
            ? t.menu.favorite.removeLabel(product.name)
            : t.menu.favorite.addLabel(product.name)
        }
        aria-keyshortcuts={favoriteKeys}
        onClick={() => onToggleFavorite(product)}
        className={clsx(
          'z-[2] grid size-9 shrink-0 place-items-center rounded-full text-brand-text',
          // 熱區擴大至 44（視覺 36）
          'after:absolute after:-inset-1 after:content-[""]',
          layout === 'GRID'
            ? 'absolute top-1.5 right-1.5 bg-bg shadow-sm'
            : 'relative hover:bg-brand-soft',
        )}
      >
        <Heart aria-hidden="true" className={clsx('size-4', favorite.active && 'fill-current')} />
      </button>
    ) : null;

  const hintRow = showHints ? (
    <div
      aria-hidden="true"
      className={clsx(
        'pointer-events-none absolute top-[calc(100%+4px)] right-2 left-2 z-10 hidden flex-wrap items-center gap-x-2 rounded-sm border border-border bg-bg px-2 py-1 text-xs leading-4 text-text-muted shadow-md',
        'group-focus-within/card:flex',
      )}
    >
      {!soldOut ? (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Kbd>a</Kbd>
          {t.menu.card.hintAdd}
        </span>
      ) : null}
      {showMemory ? (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Kbd>r</Kbd>
          {t.menu.card.hintRepeat}
        </span>
      ) : null}
      {favorite !== undefined ? (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Kbd>f</Kbd>
          {t.menu.card.hintFavorite}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Kbd>Enter</Kbd>
        {t.menu.card.hintOpen}
      </span>
    </div>
  ) : null;

  const describedBy = [priceId, hasDescription ? descId : null].filter(Boolean).join(' ');
  const cardClass = clsx(
    'group/card relative isolate min-w-0 rounded-lg border border-border bg-bg transition-shadow duration-150',
    'hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-text',
    // 取得焦點的卡片浮到鄰近卡片之上，底部的快速鍵提示列才不會被下一列遮住
    'focus-within:z-[7]',
    '@container',
  );
  const tabIndex = roving ? (tabStop ? 0 : -1) : undefined;

  const description = hasDescription ? (
    <p id={descId} className="line-clamp-2 text-sm leading-5 text-text-muted">
      {product.description}
    </p>
  ) : null;
  const lastLine =
    showMemory && lastText !== '' ? (
      <p className="text-xs leading-4 text-text-muted">{t.menu.card.last(lastText)}</p>
    ) : null;
  const categoryLine =
    categoryName !== undefined ? (
      <p className="text-xs leading-4 text-text-muted">
        {categoryIcon ? <span aria-hidden="true">{categoryIcon} </span> : null}
        {categoryName}
      </p>
    ) : null;

  if (bare) {
    return (
      <article
        data-product-card={product.id}
        aria-labelledby={nameId}
        aria-describedby={describedBy}
        tabIndex={tabIndex}
        onFocus={() => onFocusCard?.(product.id)}
        className={cardClass}
      >
        <div className="flex min-h-[62px] items-center gap-3 py-2 pr-3 pl-4 @max-[299px]:flex-col @max-[299px]:items-stretch @max-[299px]:gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {name}
            {favoriteButton}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3">
            {price}
            {action}
          </div>
        </div>
        {blockedNote}
        {hintRow}
      </article>
    );
  }

  if (layout === 'GRID') {
    return (
      <article
        data-product-card={product.id}
        aria-labelledby={nameId}
        aria-describedby={describedBy}
        tabIndex={tabIndex}
        onFocus={() => onFocusCard?.(product.id)}
        className={clsx(cardClass, 'flex flex-col p-2')}
      >
        <div className={clsx('relative', soldOut && '[&_img]:grayscale')}>
          <div className={clsx(soldOut && 'opacity-55')}>
            <ImageOrPlaceholder
              media={media}
              imageUrl={product.imageUrl}
              name={product.name}
              icon={categoryIcon}
            />
          </div>
          {hasTags ? (
            <div className="absolute top-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap gap-1">
              {tagBadges}
            </div>
          ) : null}
          {favoriteButton}
        </div>
        <div className="flex min-w-0 flex-col gap-1 px-1 pt-3">
          {name}
          {categoryLine}
          {description}
          {lastLine}
        </div>
        <div className="mt-auto flex min-h-14 flex-wrap items-center justify-between gap-x-2 gap-y-2 px-1 pt-2 pb-1">
          {price}
          {action}
        </div>
        {blockedNote}
        {hintRow}
      </article>
    );
  }

  return (
    <article
      data-product-card={product.id}
      aria-labelledby={nameId}
      aria-describedby={describedBy}
      tabIndex={tabIndex}
      onFocus={() => onFocusCard?.(product.id)}
      className={clsx(cardClass, 'flex items-start gap-3 p-3')}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="flex min-w-0 items-center gap-1">
            {name}
            {favoriteButton}
          </div>
          {tagBadges}
        </div>
        {categoryLine}
        {description}
        {lastLine}
        <div className="mt-auto flex min-h-11 flex-wrap items-center justify-between gap-x-2 gap-y-2 pt-1">
          {price}
          {action}
        </div>
      </div>
      {media === 'NONE' ? null : (
        <div className={clsx('shrink-0', soldOut && 'opacity-55 [&_img]:grayscale')}>
          <ImageOrPlaceholder
            media={media}
            imageUrl={product.imageUrl}
            name={product.name}
            icon={categoryIcon}
          />
        </div>
      )}
      {blockedNote}
      {hintRow}
    </article>
  );
}
