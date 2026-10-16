// src/features/menu/MenuPage.tsx —— PG-01 菜單首頁
//
// Banner（可無）→ 搜尋 → 分類膠囊列（sticky、scroll-spy）→ 「常點」→ 商品網格 / 清單。
// 桌機（≥ 1024）右側為常駐訂單面板（CartPanel）；< 1024 為底部浮動購物車列（CartBar）。
// 商品面板（`?product=`）由 ProductSheet 依網址開啟。店家的頂欄、店家資訊列與底部 Tab 由外殼提供。
import { useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, LayoutList, SearchX, UtensilsCrossed } from 'lucide-react';
import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { TopbarSlot, TopbarSlotContext } from '@/app/layouts/TopbarSlot';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import {
  Button,
  EmptyState,
  ErrorState,
  SkeletonCard,
  VisuallyHidden,
  useToast,
} from '@/components';
import { MAX_QTY_PER_LINE } from '@/domain/cart';
import { formatDate, formatDateTime, formatTime, formatTWD } from '@/domain/format';
import { resolveMenuLayout } from '@/domain/menuLayout';
import type { ResolvedLayout } from '@/domain/menuLayout';
import { applyRemembered, canRepeatDirectly, frequentItems } from '@/domain/rememberedChoice';
import type { RememberedChoice } from '@/domain/rememberedChoice';
import type { ProductSummary, StoreStatus, StoreStatusCode } from '@/domain/types';
import {
  KeyHint,
  useAnnounce,
  useHotkeyAction,
  useHotkeyScope,
  useHotkeysEnabled,
  useKeyShortcuts,
} from '@/features/a11y';
import { CartBar } from '@/features/cart/CartBar';
import { CartPanel, focusOrderPanel } from '@/features/cart/CartPanel';
import { cartSubtotal, quantityOfProduct, quickAddLine } from '@/features/cart/cartMath';
import { useCartStore } from '@/features/cart/cartStore';
import { removeLineWithUndo } from '@/features/cart/removeLine';
import { useCartFeedback } from '@/features/cart/useCartFeedback';
import { QrTableStrip } from '@/features/checkout/QrTableStrip';
import { useLockOrderTypeToQrTable } from '@/features/checkout/useQrTable';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { AnnouncementBanner } from '@/features/store/AnnouncementBanner';
import { useBanners, useMenu, useStoreInfo, useStoreStatus } from '@/features/store/queries';
import { useApi } from '@/hooks/useApi';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useClockNow } from '@/hooks/useClockNow';
import { useLatched } from '@/hooks/useLatched';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { errorMessageOf } from '@/i18n/strings/errors';
import { t } from '@/i18n/zh-TW';
import { getClock } from '@/services/clock';
import { qk } from '@/services/api/queryKeys';
import { StoreHeader } from '@/features/store/StoreHeader';
import { BannerCarousel } from './BannerCarousel';
import { CategoryChips } from './CategoryChips';
import { MenuSkeleton } from './MenuSkeleton';
import { MenuSearchBox, SEARCH_PARAM } from './MenuSearchBox';
import { StoreActions } from './StoreActions';
import {
  CHIP_ALL,
  CHIP_HOT,
  allProducts,
  buildChips,
  buildSections,
  hotProducts,
  normalizeQuery,
  searchMenu,
} from './menuModel';
import type { ChipItem } from './menuModel';
import { ProductCard } from './ProductCard';
import { EDIT_PARAM, PRODUCT_PARAM, useProductSheetNav } from './productSheetNav';
import { LazyProductSheet, usePreloadProductSheetOnIntent } from './LazyProductSheet';
import { RECENT_ITEMS_MAX, RecentItems } from './RecentItems';
import type { RecentEntry } from './RecentItems';
import { selectedUnitPrice } from './sheetModel';
import { useFavorites } from './useFavorites';
import { useRememberedChoices } from './useRememberedChoices';

const NO_BLOCK: ReadonlyArray<StoreStatusCode> = [];

/** 屬性選擇器值（雙引號內）的跳脫；ID 為 UUID / 代號，保守處理引號與反斜線即可 */
const attrValue = (value: string): string => value.replace(/["\\]/g, '\\$&');

export interface MenuPageProps {
  /**
   * 這些店家狀態下「加入」停用並說明原因。預設不停用（03 PG-01：休息中可瀏覽並加入購物車以預約，
   * 暫停接單的唯讀由結帳頁負責）；需要更嚴格的政策時可傳 `['PAUSED']` 或 `['CLOSED', 'PAUSED']`。
   */
  blockAddWhen?: ReadonlyArray<StoreStatusCode>;
  /** 是否在頁內顯示搜尋框；外殼的頂欄已有搜尋框（同樣寫入 `?q=`）時傳 false */
  showSearch?: boolean;
}

/** 店家狀態說明（休息中 / 暫停接單）；營業中為 null */
function storeNotice(status: StoreStatus | undefined): { tone: 'warning'; text: string } | null {
  if (status === undefined || status.status === 'OPEN') return null;
  if (status.status === 'PAUSED') {
    return {
      tone: 'warning',
      text:
        status.pausedUntil !== undefined
          ? t.errors.storePausedUntil(formatTime(status.pausedUntil))
          : t.errors.byCode.STORE_PAUSED,
    };
  }
  if (status.nextOpenAt === undefined)
    return { tone: 'warning', text: t.errors.byCode.STORE_CLOSED };
  const today = formatDate(getClock().now());
  const when =
    formatDate(status.nextOpenAt) === today
      ? formatTime(status.nextOpenAt)
      : formatDateTime(status.nextOpenAt);
  return { tone: 'warning', text: t.errors.storeClosedUntil(when) };
}

function LayoutToggle({
  layout,
  onChange,
}: {
  layout: ResolvedLayout;
  onChange: (next: ResolvedLayout) => void;
}) {
  const name = useId();
  const keys = useKeyShortcuts('toggleLayout');
  const options: Array<{ value: ResolvedLayout; label: string; Icon: typeof LayoutGrid }> = [
    { value: 'GRID', label: t.menu.layout.grid, Icon: LayoutGrid },
    { value: 'LIST', label: t.menu.layout.list, Icon: LayoutList },
  ];
  return (
    <fieldset aria-keyshortcuts={keys} className="m-0 min-w-0 border-0 p-0">
      <legend className="sr-only">{t.menu.layout.label}</legend>
      <KeyHint action="toggleLayout">
        <div className="inline-flex rounded-pill bg-bg-muted p-1">
          {options.map(({ value, label, Icon }) => (
            <label key={value} className="relative">
              <input
                type="radio"
                name={name}
                value={value}
                checked={layout === value}
                onChange={() => onChange(value)}
                className="peer sr-only"
              />
              <span
                className={
                  'flex min-h-[calc(var(--hit-size)-8px)] min-w-9 cursor-pointer items-center justify-center gap-1.5 rounded-pill px-1 text-sm leading-5 font-medium text-text-sub select-none md:min-w-20 md:px-3 ' +
                  'peer-checked:bg-bg peer-checked:font-semibold peer-checked:text-brand-text peer-checked:shadow-sm ' +
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-text'
                }
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="max-md:sr-only">{label}</span>
              </span>
            </label>
          ))}
        </div>
      </KeyHint>
    </fieldset>
  );
}

export function MenuPage({ blockAddWhen = NO_BLOCK, showSearch = true }: MenuPageProps) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const nav = useProductSheetNav();
  const api = useApi();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const announce = useAnnounce();
  const feedback = useCartFeedback();
  const favorites = useFavorites();
  const remembered = useRememberedChoices();
  const kiosk = useIsKioskUi();
  const hotkeysEnabled = useHotkeysEnabled();
  const reducedMotion = useReducedMotion();
  const breakpoint = useBreakpoint();
  const desktop = breakpoint === 'lg';
  const now = useClockNow(60_000);
  const topbarSlot = useContext(TopbarSlotContext);
  usePageTitle(t.menu.title);
  // 掃描桌上 QR（`?table=`）進入：桌號有效時取餐方式固定為內用（03 PG-01、FR-CK-05）
  useLockOrderTypeToQrTable();

  const menuQuery = useMenu();
  const infoQuery = useStoreInfo();
  const storeInfo = infoQuery.data;
  const statusQuery = useStoreStatus();
  const status = statusQuery.data ?? storeInfo?.status;
  const bannersQuery = useBanners();
  // 首次載入：店家資訊、營業狀態、Banner 與菜單都回來（成功或失敗皆算）才「一次」換成真正的內容。
  // 逐塊出現會把已經顯示的內容一路往下推（CLS 超標）；整頁骨架被整塊換掉，不會有位移的元素。
  // 閂鎖：只會從骨架切到內容，不會因為之後的重新取資料又退回骨架（見 useLatched）。
  const settled = useLatched(
    !infoQuery.isPending &&
      !statusQuery.isPending &&
      !bannersQuery.isPending &&
      !menuQuery.isPending,
  );
  const layoutOverride = usePrefsStore((s) => s.menuLayoutOverride);
  const patchPrefs = usePrefsStore((s) => s.patch);
  const lines = useCartStore((s) => s.lines);

  const query = normalizeQuery(params.get(SEARCH_PARAM));
  const sheetOpen = params.has(PRODUCT_PARAM) || params.has(EDIT_PARAM);

  // ───────── 資料模型 ─────────
  const sections = useMemo(() => buildSections(menuQuery.data), [menuQuery.data]);
  const products = useMemo(() => allProducts(sections), [sections]);
  const hot = useMemo(() => hotProducts(sections), [sections]);
  const chips = useMemo(
    () =>
      buildChips(
        sections,
        hot,
        { all: t.menu.chips.all, hot: t.menu.chips.hot },
        t.menu.chips.hotIcon,
      ),
    [sections, hot],
  );
  const iconByCategory = useMemo(() => new Map(sections.map((s) => [s.id, s.icon])), [sections]);
  const categoryOfProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sections) for (const p of s.products) map.set(p.id, s.id);
    return map;
  }, [sections]);
  const hits = useMemo(() => searchMenu(sections, query), [sections, query]);

  const [hotOnly, setHotOnly] = useState(false);
  const searching = query !== '';
  const showHot = hotOnly && hot.length > 0 && !searching;

  // 版面優先序：使用者手動選擇 ＞ 店家 menu_layout ＞ AUTO（BR-31）
  const userLayout: ResolvedLayout | null = layoutOverride === 'AUTO' ? null : layoutOverride;
  const layout = resolveMenuLayout(storeInfo?.display.menuLayout ?? 'AUTO', products, userLayout);

  const blocked = status !== undefined && blockAddWhen.includes(status.status);
  const blockedReason = blocked ? (storeNotice(status)?.text ?? t.menu.card.addBlocked) : null;

  // ───────── 購物車衍生值 ─────────
  const { qtyByProduct, quickByProduct } = useMemo(() => {
    const qty = new Map<string, number>();
    const quick = new Map<string, number>();
    for (const line of lines)
      qty.set(line.productId, (qty.get(line.productId) ?? 0) + line.quantity);
    for (const p of products) {
      const q = quickAddLine(lines, p.id);
      if (q !== undefined) quick.set(p.id, q.quantity);
    }
    return { qtyByProduct: qty, quickByProduct: quick };
  }, [lines, products]);

  // ───────── 進入首頁與視窗取得焦點時：過期的購物車清空（FR-CT-04） ─────────
  useEffect(() => {
    const purge = (): void => useCartStore.getState().purgeIfExpired();
    purge();
    window.addEventListener('focus', purge);
    return () => window.removeEventListener('focus', purge);
  }, []);

  // ───────── 焦點與捲動 ─────────
  const contentRef = useRef<HTMLDivElement>(null);
  usePreloadProductSheetOnIntent(contentRef);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const visibleProducts: ProductSummary[] = searching
    ? hits.map((h) => h.product)
    : showHot
      ? hot
      : products;
  const firstCardId = visibleProducts[0]?.id ?? null;
  const tabStopId =
    focusedCardId !== null && visibleProducts.some((p) => p.id === focusedCardId)
      ? focusedCardId
      : firstCardId;
  const pendingFocus = useRef<{ productId: string; target: 'increase' | 'add' } | null>(null);

  // roving tabindex：整個網格只有一個 Tab 停點（卡片本身與其內的按鈕）；觸控面板以原生 Tab 順序操作
  useLayoutEffect(() => {
    const root = contentRef.current;
    if (root === null) return;
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    if (kiosk) {
      root.querySelectorAll<HTMLElement>('[data-product-card] [tabindex="-1"]').forEach((el) => {
        if (el.getAttribute('role') !== 'spinbutton') el.removeAttribute('tabindex');
      });
    } else {
      root.querySelectorAll<HTMLElement>('[data-product-card]').forEach((card) => {
        const active = card.dataset.productCard === tabStopId;
        card.querySelectorAll<HTMLElement>('button').forEach((el) => {
          if (active) el.removeAttribute('tabindex');
          else el.setAttribute('tabindex', '-1');
        });
      });
    }
    if (pending !== null) {
      const card = root.querySelector<HTMLElement>(
        `[data-product-card="${attrValue(pending.productId)}"]`,
      );
      const target =
        pending.target === 'increase'
          ? Array.from(card?.querySelectorAll<HTMLElement>('[data-card-stepper] button') ?? []).at(
              -1,
            )
          : card?.querySelector<HTMLElement>('[data-card-add]');
      target?.focus();
    }
  });

  // 商品網格的方向鍵導覽（原生導覽，不屬單字元快速鍵）：卡片本身取得焦點時 ← → ↑ ↓ Home End 移動，Enter / Space 開啟面板
  const openCard = (product: ProductSummary, trigger: HTMLElement): void => {
    returnFocusRef.current = trigger.closest<HTMLElement>('[data-product-card]') ?? trigger;
    nav.openProduct(product.id);
  };
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyHandlerRef.current = (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const root = contentRef.current;
      const target = event.target;
      if (
        root === null ||
        !(target instanceof HTMLElement) ||
        !target.matches('[data-product-card]')
      )
        return;
      const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-product-card]'));
      const index = cards.indexOf(target);
      if (index < 0) return;

      if (event.key === 'Enter' || event.key === ' ') {
        const product = products.find((p) => p.id === target.dataset.productCard);
        if (product === undefined) return;
        event.preventDefault();
        openCard(product, target);
        return;
      }
      let next: HTMLElement | undefined;
      if (event.key === 'Home') next = cards[0];
      else if (event.key === 'End') next = cards[cards.length - 1];
      else if (event.key === 'ArrowRight') next = cards[index + 1];
      else if (event.key === 'ArrowLeft') next = cards[index - 1];
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        next = verticalNeighbour(cards, target, event.key === 'ArrowDown' ? 1 : -1);
      } else return;
      event.preventDefault();
      next?.focus();
    };
  });
  useEffect(() => {
    const root = contentRef.current;
    if (root === null || kiosk) return;
    const listener = (event: KeyboardEvent): void => keyHandlerRef.current(event);
    root.addEventListener('keydown', listener);
    return () => root.removeEventListener('keydown', listener);
  }, [kiosk]);

  // ───────── 分類：scroll-spy 與跳轉 ─────────
  const [activeChip, setActiveChip] = useState<string>(CHIP_ALL);
  // 待捲動的目標（ref）與觸發器（nonce）：捲動只在「全部」檢視下執行一次，之後不會因檢視切換再度觸發
  const pendingScroll = useRef<string | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  const spyLockUntil = useRef(0);
  const inAllView = !searching && !showHot;

  useEffect(() => {
    if (!inAllView || typeof IntersectionObserver === 'undefined') return;
    const root = contentRef.current;
    if (root === null) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-section-id]'));
    if (els.length === 0) return;
    const visible = new Set<string>();
    const topOffset =
      parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 140;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.sectionId;
          if (id === undefined) continue;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        if (performance.now() < spyLockUntil.current) return;
        if (window.scrollY <= 4) {
          setActiveChip(CHIP_ALL);
          return;
        }
        const first = els.find(
          (el) => el.dataset.sectionId !== undefined && visible.has(el.dataset.sectionId),
        );
        const id = first?.dataset.sectionId;
        if (id !== undefined) setActiveChip(id);
      },
      { rootMargin: `-${Math.round(topOffset)}px 0px -60% 0px`, threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    const onScroll = (): void => {
      if (window.scrollY <= 4 && performance.now() >= spyLockUntil.current) setActiveChip(CHIP_ALL);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [inAllView, sections]);

  // 切回「全部」檢視後才捲到目標分類（搜尋 / 熱銷檢視中選分類時，區塊要等重新渲染後才存在）
  useEffect(() => {
    const id = pendingScroll.current;
    if (id === null) return;
    // 「全部」回到頁首（搜尋結果除外：先等搜尋清除）；分類區塊只存在於「全部」檢視
    if (id === CHIP_ALL ? searching : !inAllView) return;
    pendingScroll.current = null;
    spyLockUntil.current = performance.now() + 800;
    const behavior = reducedMotion ? 'auto' : 'smooth';
    if (id === CHIP_ALL) {
      window.scrollTo({ top: 0, behavior });
      return;
    }
    document
      .querySelector<HTMLElement>(`[data-section-id="${attrValue(id)}"]`)
      ?.scrollIntoView({ behavior, block: 'start' });
  }, [scrollNonce, inAllView, searching, reducedMotion]);

  const clearSearch = (): void => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(SEARCH_PARAM);
        return next;
      },
      { replace: true },
    );
  };

  const selectChip = (chip: ChipItem): void => {
    if (searching) clearSearch();
    setHotOnly(chip.id === CHIP_HOT);
    setActiveChip(chip.id);
    pendingScroll.current = chip.id === CHIP_HOT ? CHIP_ALL : chip.id;
    setScrollNonce((n) => n + 1);
    announce(t.menu.chips.selected(chip.name, chip.count));
  };

  // ───────── 加入、再點、收藏 ─────────
  const [repeatingId, setRepeatingId] = useState<string | null>(null);

  const quickAdd = (product: ProductSummary): void => {
    const outcome = feedback.add({
      productId: product.id,
      name: product.name,
      imageUrl: product.imageUrl,
      remaining: product.remainingToday,
      optionIds: [],
      optionLabels: [],
      unitPrice: product.basePrice,
      quantity: 1,
    });
    if (outcome.ok) pendingFocus.current = { productId: product.id, target: 'increase' };
  };

  const quickChange = (product: ProductSummary, next: number): void => {
    const line = quickAddLine(useCartStore.getState().lines, product.id);
    if (line === undefined) return;
    useCartStore.getState().setQuantity(line.lineId, next);
    const after = useCartStore.getState().lines;
    announce(
      t.cart.feedback.quantityChanged(
        product.name,
        next,
        after.length,
        formatTWD(cartSubtotal(after)),
      ),
    );
  };

  const quickRemove = (product: ProductSummary): void => {
    const line = quickAddLine(useCartStore.getState().lines, product.id);
    if (line === undefined) return;
    removeLineWithUndo(line, { toast, announce });
    pendingFocus.current = { productId: product.id, target: 'add' };
  };

  const repeat = async (product: ProductSummary, choice: RememberedChoice): Promise<void> => {
    setRepeatingId(product.id);
    const card = document.querySelector<HTMLElement>(
      `[data-product-card="${attrValue(product.id)}"]`,
    );
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: qk.store.product(product.id),
        queryFn: () => api.store.getProduct(product.id),
        staleTime: 60_000,
      });
      // 以商品「目前」的選項驗證記憶：全數有效且可購買才直接加入；否則開啟面板並提示（BR-35）
      const applied = applyRemembered(detail, choice);
      const inCart = quantityOfProduct(useCartStore.getState().lines, product.id);
      if (!canRepeatDirectly(detail, applied, inCart)) {
        if (card !== null) returnFocusRef.current = card;
        nav.openProduct(product.id);
        return;
      }
      feedback.add(
        {
          productId: detail.id,
          name: detail.name,
          imageUrl: detail.imageUrl,
          remaining: detail.remainingToday,
          optionIds: applied.optionIds,
          optionLabels: applied.labels,
          unitPrice: selectedUnitPrice(detail, applied.optionIds),
          quantity: 1,
          note: applied.note,
        },
        'repeat',
      );
    } catch {
      feedback.fail(t.menu.card.repeatFailed);
    } finally {
      setRepeatingId(null);
    }
  };

  const cardOf = (productId: string): ProductSummary | undefined =>
    products.find((p) => p.id === productId);
  const focusedProduct = (): ProductSummary | undefined => {
    const active = document.activeElement;
    const id =
      active instanceof HTMLElement
        ? active.closest<HTMLElement>('[data-product-card]')?.dataset.productCard
        : undefined;
    return id === undefined ? undefined : cardOf(id);
  };

  const changeLayout = (next: ResolvedLayout): void => {
    if (next === layout) return;
    patchPrefs({ menuLayoutOverride: next });
    announce(t.menu.layout.changed(next === 'GRID' ? t.menu.layout.grid : t.menu.layout.list));
  };

  // ───────── 單鍵快速鍵（範圍 'menu'；是否生效由 HotkeyProvider 依偏好與焦點解析） ─────────
  useHotkeyScope('menu');
  useHotkeyAction('jumpCategory', (arg) => {
    if (arg === undefined) return;
    const chip = arg === '0' ? chips[0] : chips[Number(arg)];
    if (chip !== undefined) selectChip(chip);
  });
  useHotkeyAction('toggleLayout', () => changeLayout(layout === 'GRID' ? 'LIST' : 'GRID'));
  useHotkeyAction('addFocused', () => {
    const product = focusedProduct();
    if (product === undefined) {
      announce(t.menu.card.focusFirst);
      return;
    }
    if (product.isSoldOut) {
      announce(t.menu.card.soldOutLabel(product.name));
      return;
    }
    if (blockedReason !== null) {
      feedback.fail(blockedReason);
      return;
    }
    if (product.hasRequiredOptions) {
      const active = document.activeElement;
      if (active instanceof HTMLElement) openCard(product, active);
      else nav.openProduct(product.id);
    } else quickAdd(product);
  });
  useHotkeyAction('repeatFocused', () => {
    const product = focusedProduct();
    if (product === undefined) {
      announce(t.menu.card.focusFirst);
      return;
    }
    const choice = remembered.map[product.id];
    if (choice === undefined || choice.optionIds.length === 0 || product.isSoldOut) {
      announce(t.menu.card.noMemory);
      return;
    }
    void repeat(product, choice);
  });
  useHotkeyAction('toggleFavorite', () => {
    const product = focusedProduct();
    if (product === undefined) {
      announce(t.menu.card.focusFirst);
      return;
    }
    favorites.toggle({ id: product.id, name: product.name });
  });
  useHotkeyAction('openCart', () => {
    if (desktop && focusOrderPanel()) {
      announce(t.cart.feedback.panelAnnounce(lines.length, formatTWD(cartSubtotal(lines))));
      return;
    }
    void navigate(ROUTES.cart);
  });

  // ───────── 渲染 ─────────
  const recentEntries = useMemo<RecentEntry[]>(() => {
    if (!remembered.enabled || kiosk || searching || showHot) return [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return frequentItems(remembered.map, products.length, now.getTime())
      .flatMap((choice) => {
        const product = byId.get(choice.productId);
        return product === undefined ? [] : [{ product, remembered: choice }];
      })
      .slice(0, RECENT_ITEMS_MAX);
  }, [remembered.enabled, remembered.map, kiosk, searching, showHot, products, now]);

  // 欄數依斷點遞增覆寫；一律使用 min-[…px] 任意值變體（Tailwind 會把它們排在具名的 md: / lg: 之前，
  // 混用時具名變體會蓋過任意值，因此全部用同一種）。≥ 1024 時右側有 360 的訂單面板，故欄數較少。
  const gridClass =
    layout === 'GRID'
      ? 'grid grid-cols-2 gap-3 md:gap-5 min-[768px]:grid-cols-3 min-[1024px]:grid-cols-2 min-[1280px]:grid-cols-3 min-[1680px]:grid-cols-4 kiosk:grid-cols-3'
      : 'grid grid-cols-1 gap-3 md:gap-x-5 md:gap-y-4 min-[768px]:grid-cols-2 min-[1024px]:grid-cols-1 min-[1280px]:grid-cols-2 kiosk:grid-cols-2';

  const renderCard = (product: ProductSummary, extra?: { categoryName: string }) => {
    const choice = remembered.map[product.id];
    const quick = quickByProduct.get(product.id) ?? null;
    // 步進器操作的是快速加入行：上限扣除「同商品的其他行」，不含它自己
    const quickLine = quick === null ? undefined : quickAddLine(lines, product.id);
    const cap = useCartStore
      .getState()
      .maxAddableFor(product.id, product.remainingToday, quickLine?.lineId);
    const categoryId = categoryOfProduct.get(product.id);
    return (
      <ProductCard
        key={product.id}
        product={product}
        layout={layout}
        categoryIcon={categoryId === undefined ? undefined : iconByCategory.get(categoryId)}
        categoryName={extra?.categoryName}
        remembered={choice !== undefined && choice.optionIds.length > 0 ? choice : undefined}
        cartQuantity={qtyByProduct.get(product.id) ?? 0}
        quickQuantity={quick}
        quickMax={Math.min(cap, MAX_QTY_PER_LINE)}
        tabStop={product.id === tabStopId}
        roving={!kiosk}
        favorite={
          favorites.isMember && favorites.available
            ? { active: favorites.isFavorite(product.id) }
            : undefined
        }
        blockedReason={blockedReason}
        showHints={hotkeysEnabled && !kiosk}
        repeating={repeatingId === product.id}
        onFocusCard={setFocusedCardId}
        onOpen={openCard}
        onQuickAdd={quickAdd}
        onQuickChange={quickChange}
        onQuickRemove={quickRemove}
        onRepeat={(p, c) => void repeat(p, c)}
        onToggleFavorite={(p) => favorites.toggle({ id: p.id, name: p.name })}
      />
    );
  };

  let body;
  if (menuQuery.isPending) {
    body = (
      <div aria-busy="true" role="status" className={`mt-5 ${gridClass}`}>
        <VisuallyHidden>{t.menu.loading}</VisuallyHidden>
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} variant={layout === 'LIST' ? 'list' : 'grid'} />
        ))}
      </div>
    );
  } else if (menuQuery.isError && menuQuery.data === undefined) {
    body = (
      <ErrorState
        title={t.menu.loadError}
        message={errorMessageOf(menuQuery.error)}
        retrying={menuQuery.isFetching}
        onRetry={() => void menuQuery.refetch()}
      />
    );
  } else if (products.length === 0) {
    body = (
      <EmptyState
        icon={<UtensilsCrossed />}
        title={t.menu.empty.title}
        description={t.menu.empty.description}
      />
    );
  } else if (searching) {
    body =
      hits.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={t.menu.search.emptyTitle(query)}
          description={t.menu.search.emptyDescription}
          action={
            <Button variant="secondary" onClick={clearSearch}>
              {t.menu.search.clear}
            </Button>
          }
        />
      ) : (
        <section aria-labelledby="menu-results-title" className="pt-5 md:pt-7">
          <div className="mb-3 flex items-baseline gap-2 md:mb-4">
            <h2 id="menu-results-title" className="text-h2 font-bold">
              {t.menu.search.resultsTitle}
            </h2>
            <span className="text-sm leading-5 text-text-muted">
              {t.menu.section.count(hits.length)}
            </span>
          </div>
          <div className={gridClass}>
            {hits.map((hit) => renderCard(hit.product, { categoryName: hit.categoryName }))}
          </div>
        </section>
      );
  } else if (showHot) {
    body = (
      <section data-section-id={CHIP_HOT} className="pt-5 md:pt-7">
        <div className="mb-3 flex items-baseline gap-2 md:mb-4">
          <h2 className="text-h2 font-bold">
            <span aria-hidden="true">{t.menu.chips.hotIcon} </span>
            {t.menu.chips.hot}
          </h2>
          <span className="text-sm leading-5 text-text-muted">
            {t.menu.section.count(hot.length)}
          </span>
        </div>
        <div className={gridClass}>{hot.map((p) => renderCard(p))}</div>
      </section>
    );
  } else {
    body = (
      <>
        <RecentItems
          entries={recentEntries}
          blockedReason={blockedReason}
          repeatingId={repeatingId}
          onRepeat={(p, c) => void repeat(p, c)}
        />
        {sections.map((section) => (
          <section key={section.id} data-section-id={section.id} className="pt-5 md:pt-7">
            <div className="mb-3 flex items-baseline gap-2 md:mb-4">
              <h2 className="text-h2 font-bold">{section.name}</h2>
              <span className="text-sm leading-5 text-text-muted">
                {t.menu.section.count(section.products.length)}
              </span>
            </div>
            <div className={gridClass}>{section.products.map((p) => renderCard(p))}</div>
          </section>
        ))}
      </>
    );
  }

  const banners = bannersQuery.data?.items ?? [];
  const cartVisible = lines.length > 0;
  // ≥ 768 且在外殼內：搜尋框放進頂部列的插槽（常駐搜尋膠囊）；< 768 與獨立渲染時放在頁內
  const searchInTopbar = showSearch && topbarSlot !== null && breakpoint !== 'sm';

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1440px] items-start">
        <div
          ref={contentRef}
          id="menu"
          className={`min-w-0 flex-1 ${cartVisible && !desktop ? 'pb-24' : ''}`}
        >
          <h1 tabIndex={-1} className="sr-only">
            {storeInfo?.name !== undefined ? t.menu.titleOf(storeInfo.name) : t.menu.title}
          </h1>

          {settled ? (
            <>
              {/* 店家公告：只在首頁（店家門面）顯示，與其他區塊一起出現，不會事後把內容推開 */}
              <AnnouncementBanner className="px-4 pt-3 md:px-8" />

              {kiosk ? null : (
                <div className="px-4 pt-3 md:px-8">
                  <StoreHeader
                    variant={breakpoint === 'sm' ? 'card' : 'strip'}
                    announce
                    actions={<StoreActions />}
                  />
                </div>
              )}

              <QrTableStrip className="px-4 pt-3 md:px-8" />

              {searchInTopbar ? (
                <TopbarSlot>
                  <MenuSearchBox />
                </TopbarSlot>
              ) : showSearch ? (
                <div className="px-4 pt-3 md:px-8">
                  <MenuSearchBox />
                </div>
              ) : null}

              {!searching && !showHot && banners.length > 0 ? (
                <div className="px-4 md:px-8">
                  <BannerCarousel
                    banners={banners}
                    onOpenProduct={(id) => nav.openProduct(id)}
                    onSelectCategory={(id) => {
                      const chip = chips.find((c) => c.id === id);
                      if (chip !== undefined) selectChip(chip);
                    }}
                  />
                </div>
              ) : null}

              {chips.length > 1 ? (
                <CategoryChips
                  className="mt-3"
                  chips={chips}
                  activeId={searching ? '' : showHot ? CHIP_HOT : activeChip}
                  onSelect={selectChip}
                  kiosk={kiosk}
                  trailing={
                    kiosk || products.length === 0 ? undefined : (
                      <LayoutToggle layout={layout} onChange={changeLayout} />
                    )
                  }
                />
              ) : null}

              {/* 最小高度：內容很少時頁尾仍在首屏之外，內容變動時頁尾不會跟著位移（CLS） */}
              <div className="min-h-[70dvh] px-4 pb-6 md:px-8 md:pb-14">{body}</div>
            </>
          ) : (
            <MenuSkeleton inlineSearch={showSearch && !searchInTopbar} kiosk={kiosk} />
          )}
        </div>

        {desktop ? <CartPanel hotkeysEnabled={!sheetOpen} /> : null}
      </div>

      {desktop ? null : <CartBar />}
      <LazyProductSheet returnFocusRef={returnFocusRef} addBlockedReason={blockedReason} />
    </>
  );
}

/** 同一欄的上 / 下一張卡：以幾何位置判斷（網格欄數隨斷點改變）；沒有幾何資訊（測試環境）時退為前後一張 */
function verticalNeighbour(
  cards: ReadonlyArray<HTMLElement>,
  from: HTMLElement,
  direction: 1 | -1,
): HTMLElement | undefined {
  const rect = from.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return cards[cards.indexOf(from) + direction];

  const cx = rect.left + rect.width / 2;
  const candidates = cards.filter((card) => {
    if (card === from) return false;
    const r = card.getBoundingClientRect();
    return direction === 1 ? r.top >= rect.bottom - 4 : r.bottom <= rect.top + 4;
  });
  if (candidates.length === 0) return undefined;
  const distance = (card: HTMLElement): number => {
    const r = card.getBoundingClientRect();
    return direction === 1 ? r.top - rect.bottom : rect.top - r.bottom;
  };
  const nearest = Math.min(...candidates.map(distance));
  // 同一列（頂端差距在 24px 內）中，水平中心最接近者
  const row = candidates.filter((card) => distance(card) - nearest < 24);
  row.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return Math.abs(ra.left + ra.width / 2 - cx) - Math.abs(rb.left + rb.width / 2 - cx);
  });
  return row[0];
}
