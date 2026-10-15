// src/features/checkout/CheckoutPage.tsx —— PG-04 結帳（FLOW-04、FLOW-22～24；FR-CK-01～16）
//
// 結構：CheckoutPage（載入店家資訊、空購物車導向）→ CheckoutContent（表單、報價、異動清單、送出管線）。
// 送出管線：decideSubmit（點擊與 Ctrl/⌘ + Enter 共用）→ 表單驗證 → 預檢 quote → POST /orders（同一把 Idempotency-Key）
//   → 201 導向 / 422·409 就地展開異動清單 / 429·503 冷卻 / 結果未知 / IDEMPOTENCY_CONFLICT 以同 Key 重放取回。
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import {
  Checkbox,
  EmptyState,
  ErrorState,
  IconButton,
  LinkButton,
  Skeleton,
  useToast,
} from '@/components';
import {
  blockingCount,
  decideSubmit,
  deriveCheckoutIssues,
  hasNothingToBuy,
} from '@/domain/availability';
import type { CheckoutIssue, SubmitContext } from '@/domain/availability';
import type { CartLine } from '@/domain/cart';
import { EMPTY_KEY_STATE } from '@/domain/idempotency';
import type { CheckoutKeyState } from '@/domain/idempotency';
import { formatTWD, formatTime } from '@/domain/format';
import type {
  Address,
  CreateOrderRequest,
  OrderType,
  PaymentMethod,
  QuoteResponse,
  StoreInfo,
} from '@/domain/types';
import { useApi } from '@/hooks/useApi';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useClockNow } from '@/hooks/useClockNow';
import { useLatest } from '@/hooks/useLatest';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { t } from '@/i18n/zh-TW';
import { checkout as tCheckout } from '@/i18n/strings/checkout';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import { useAnnounce, useHotkeyAction, useHotkeyScope } from '@/features/a11y';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { onKioskReset } from '@/features/kiosk/resetEvent';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useQuote } from '@/features/quote/useQuote';
import { useStoreInfo, useStoreStatus } from '@/features/store/queries';
import { qk } from '@/services/api/queryKeys';
import { getClock } from '@/services/clock';
import { AdjustedSummary, AvailabilityIssueList, UndoNotice } from './AvailabilityIssueList';
import { useBooleanField } from './fieldBindings';
import { buildCreateOrderRequest } from './buildRequest';
import { clearDraft, keyStateOf, loadDraft, saveDraft } from './checkoutDraft';
import type { CheckoutDraft } from './checkoutDraft';
import { qrTokenFromSearch, recalledQrTable } from './qrTable';
import { checkoutFormSchema, ZIP_RE } from './checkoutSchema';
import type { CheckoutFormValues } from './checkoutSchema';
import {
  calendarOf,
  computeShown,
  dayWordFor,
  formatPhoneInput,
  hasCouponError,
  isStickyIssue,
  issueSignature,
  makeAck,
  slotContextOf,
} from './checkoutHelpers';
import type { PriceAck } from './checkoutHelpers';
import {
  ContactSection,
  CouponSection,
  InvoiceSection,
  NoteSection,
  PaymentSection,
  PlaceSection,
} from './FormSections';
import type { DeliveryCheckState } from './FormSections';
import { buildIssueCards, planApplyAll } from './issueViews';
import type { IssueAction } from './issueViews';
import { OrderTypeSection } from './OrderTypeSection';
import { OrderSummaryPanel, StatusBar, StoreNotice, SubmitAlert, SubmitBar } from './PageParts';
import type { StatusBarState, SubmitAlertKind, SubmitBarState } from './PageParts';
import type { OrderNavState, PaymentNavState } from './navState';
import { submitOrder } from './submitPipeline';
import type { SubmitOutcome } from './submitPipeline';
import { TimeSection } from './TimeSection';

const T = tCheckout;

// ───────── 外層：載入店家資訊與空購物車導向 ─────────

export function CheckoutPage() {
  usePageTitle(T.pageTitle);
  const infoQuery = useStoreInfo();
  const lineCount = useCartStore((s) => s.lines.length);
  // 進入時購物車為空 → 導向購物車（07 §8）；進入後被清空（移除所有無法購買的品項）則留在本頁顯示 EmptyState
  const [enteredEmpty] = useState(lineCount === 0);

  if (enteredEmpty && lineCount === 0) return <Navigate to={ROUTES.cart} replace />;

  // 頁名由外殼的 TaskHeader 顯示（usePageTitle）；h1 視覺隱藏，每個狀態都保留唯一一個 h1，路由切換後焦點移到此處
  const heading = (
    <h1 tabIndex={-1} className="sr-only">
      {T.pageTitle}
    </h1>
  );

  if (infoQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6" aria-busy="true">
        {heading}
        <p className="sr-only" role="status">
          {T.loadingPage}
        </p>
        <div className="flex flex-col gap-3">
          <Skeleton height={56} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      </div>
    );
  }
  if (infoQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {heading}
        <ErrorState
          title={T.loadFailed}
          message={t.errors.messageOf(infoQuery.error)}
          onRetry={() => void infoQuery.refetch()}
        />
      </div>
    );
  }
  return (
    <>
      {heading}
      <CheckoutContent info={infoQuery.data} />
    </>
  );
}

// ───────── 草稿與預設值 ─────────

const ALL_ORDER_TYPES: ReadonlyArray<OrderType> = ['PICKUP', 'DELIVERY', 'DINE_IN'];

function availableOrderTypes(info: StoreInfo, kiosk: boolean): OrderType[] {
  const s = info.services;
  const base: OrderType[] = [];
  if (s.pickup) base.push('PICKUP');
  if (s.delivery && !kiosk) base.push('DELIVERY'); // 觸控面板不提供外送（03 §5.6）
  if (s.dineIn) base.push('DINE_IN');
  return base;
}

function allowedPaymentMethods(
  info: StoreInfo,
  orderType: OrderType,
  kiosk: boolean,
): PaymentMethod[] {
  void orderType;
  // 觸控面板僅「現金（櫃檯付款）」（BR-36）；其餘依店家設定
  if (kiosk) return info.paymentMethods.includes('CASH') ? ['CASH'] : [];
  return [...info.paymentMethods];
}

interface DefaultsInput {
  info: StoreInfo;
  cartOrderType: OrderType;
  draft: CheckoutDraft;
  kiosk: boolean;
}

function buildDefaults({ info, cartOrderType, draft, kiosk }: DefaultsInput): CheckoutFormValues {
  const prefs = usePrefsStore.getState();
  const user = useSessionStore.getState().user;
  const guest = kiosk ? null : prefs.guestProfile;
  const f = draft.form;

  const types = availableOrderTypes(info, kiosk);
  // 購物車的取餐方式已不可用（店家關閉、觸控面板不提供外送）時回退：觸控面板預設內用（03 §5.6）
  const fallback: OrderType | undefined = kiosk && types.includes('DINE_IN') ? 'DINE_IN' : types[0];
  const orderType: OrderType = types.includes(cartOrderType)
    ? cartOrderType
    : (fallback ?? cartOrderType);

  const methods = allowedPaymentMethods(info, orderType, kiosk);
  const preferred: PaymentMethod | null =
    f.paymentMethod !== undefined && f.paymentMethod !== ''
      ? f.paymentMethod
      : (guest?.paymentMethod ?? (kiosk ? null : prefs.lastPaymentMethod));
  const paymentMethod: PaymentMethod | '' =
    preferred !== null && methods.includes(preferred) ? preferred : (methods[0] ?? '');

  const phone = f.contactPhone ?? guest?.phone ?? user?.phone ?? '';
  const gInvoice = guest?.invoice;
  return {
    orderType,
    scheduleMode: orderType === 'DINE_IN' ? 'ASAP' : (f.scheduleMode ?? 'ASAP'),
    scheduledAt: orderType === 'DINE_IN' ? '' : (f.scheduledAt ?? ''),
    contactName: f.contactName ?? guest?.name ?? user?.name ?? '',
    contactPhone: formatPhoneInput(phone),
    rememberMe: kiosk ? false : (f.rememberMe ?? guest !== null),
    addressId: f.addressId ?? '',
    deliveryCity: f.deliveryCity ?? guest?.delivery?.city ?? '',
    deliveryDistrict: f.deliveryDistrict ?? guest?.delivery?.district ?? '',
    deliveryZip: f.deliveryZip ?? guest?.delivery?.zipCode ?? '',
    deliveryLine: f.deliveryLine ?? guest?.delivery?.line ?? '',
    deliveryNote: f.deliveryNote ?? guest?.delivery?.note ?? '',
    tableNo: f.tableNo ?? '',
    paymentMethod,
    invoiceType: f.invoiceType ?? gInvoice?.type ?? 'PAPER',
    invoiceCarrierCode: f.invoiceCarrierCode ?? gInvoice?.carrierCode ?? '',
    invoiceTaxId: f.invoiceTaxId ?? gInvoice?.taxId ?? '',
    invoiceBuyerName: f.invoiceBuyerName ?? gInvoice?.buyerName ?? '',
    invoiceDonateCode: f.invoiceDonateCode ?? gInvoice?.donateCode ?? '',
    couponCode: f.couponCode ?? '',
    note: f.note ?? '',
    needUtensils: f.needUtensils ?? false,
    marketingOptIn: f.marketingOptIn ?? false,
  };
}

/** 表單欄位在畫面上的順序（驗證失敗時聚焦第一個錯誤，FR-CK-10） */
const FIELD_ORDER: ReadonlyArray<keyof CheckoutFormValues> = [
  'scheduledAt',
  'deliveryCity',
  'deliveryDistrict',
  'deliveryLine',
  'deliveryNote',
  'tableNo',
  'contactName',
  'contactPhone',
  'paymentMethod',
  'invoiceType',
  'invoiceCarrierCode',
  'invoiceDonateCode',
  'invoiceTaxId',
  'invoiceBuyerName',
  'note',
];

const GROUP_SELECTORS: Partial<Record<keyof CheckoutFormValues, string>> = {
  scheduledAt: 'input[name="slot"]:not([aria-disabled]), input[name="scheduleMode"]',
  paymentMethod: 'input[name="paymentMethod"]',
  invoiceType: 'input[name="invoiceType"]',
};

/** 後端 details[].field → 表單欄位 */
const SERVER_FIELD_MAP: Record<string, keyof CheckoutFormValues> = {
  'contact.name': 'contactName',
  'contact.phone': 'contactPhone',
  'delivery.city': 'deliveryCity',
  'delivery.district': 'deliveryDistrict',
  'delivery.zipCode': 'deliveryDistrict',
  'delivery.line': 'deliveryLine',
  'delivery.note': 'deliveryNote',
  'dineIn.tableNo': 'tableNo',
  paymentMethod: 'paymentMethod',
  'invoice.type': 'invoiceType',
  'invoice.carrierCode': 'invoiceCarrierCode',
  'invoice.taxId': 'invoiceTaxId',
  'invoice.buyerName': 'invoiceBuyerName',
  'invoice.donateCode': 'invoiceDonateCode',
  note: 'note',
  scheduledAt: 'scheduledAt',
};

interface StickyIssue {
  issue: CheckoutIssue;
  /** 被退回當下與該異動相關的欄位值；欄位改變後才移除 */
  rejectedValue: string;
}

const invoiceValue = (v: CheckoutFormValues): string =>
  JSON.stringify([v.invoiceType, v.invoiceCarrierCode, v.invoiceTaxId, v.invoiceDonateCode]);

function stickyValueOf(issue: CheckoutIssue, v: CheckoutFormValues): string {
  if (issue.kind === 'SLOT') return `${v.scheduleMode}|${v.scheduledAt}`;
  const f = issue.field ?? '';
  if (f === 'paymentMethod') return v.paymentMethod;
  if (f.startsWith('invoice')) return invoiceValue(v);
  if (f === 'dineIn.tableNo') return v.tableNo;
  return '';
}

function stickyStillValid(s: StickyIssue, v: CheckoutFormValues): boolean {
  if (s.issue.kind === 'SLOT') {
    // 被退回時清除原選取（EC-07）：未重新選擇前持續列出，改選其他時段或改為盡快即移除
    const [, rejectedAt = ''] = s.rejectedValue.split('|');
    return v.scheduleMode === 'SCHEDULED' && (v.scheduledAt === '' || v.scheduledAt === rejectedAt);
  }
  return stickyValueOf(s.issue, v) === s.rejectedValue;
}

interface AdjustedState {
  text: string;
  restore: () => void;
}

/** 會讓報價改變、清單項目因而消失或換項的就地動作：處理後把焦點移到下一個異動項的主要動作 */
const FOCUS_NEXT_ACTION_TYPES: ReadonlySet<IssueAction['spec']['type']> = new Set([
  'FIT',
  'REMOVE_LINE',
  'PICK_SLOT',
  'TOMORROW',
  'ASAP',
  'SWITCH_ORDER_TYPE',
  'REMOVE_COUPON',
]);
/** 動作之後等待重新計價的最長時間（逾時視為不再需要移焦） */
const FOCUS_NEXT_ACTION_WINDOW_MS = 10_000;

interface UndoState {
  message: string;
  restore: () => void;
  nonce: number;
}

interface AlertState {
  kind: SubmitAlertKind;
  message: string;
}

// ───────── 主體 ─────────

function CheckoutContent({ info }: { info: StoreInfo }) {
  const api = useApi();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const announce = useAnnounce();
  const kiosk = useIsKioskUi();
  const isDesktop = useBreakpoint() === 'lg';
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');

  const lines = useCartStore((s) => s.lines);
  const cartOrderType = useCartStore((s) => s.orderType);
  const user = useSessionStore((s) => s.user);
  const isMember = user !== null;
  const hasStoredProfile = usePrefsStore((s) => s.guestProfile !== null);

  useHotkeyScope('checkout');

  // ── 草稿與表單 ──
  const [draft0] = useState(() => loadDraft());
  const [defaults] = useState(() => buildDefaults({ info, cartOrderType, draft: draft0, kiosk }));
  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: defaults,
    mode: 'onBlur',
  });
  const values = useWatch({ control: form.control }) as CheckoutFormValues;
  const { setValue } = form;

  const keyStateRef = useRef<CheckoutKeyState>(keyStateOf(draft0));
  const lastBodyRef = useRef<CreateOrderRequest | null>(
    draft0.unknownBodies[draft0.unknownBodies.length - 1] ?? null,
  );
  const completedRef = useRef(false);
  const submittingRef = useRef(false);
  const [completed, setCompleted] = useState(false);

  // QR 桌號（FR-CK-05）：URL 的 ?table= 優先，其次本分頁記下的桌位（站內導覽不帶查詢字串），最後是草稿
  const [qrToken] = useState<string | null>(
    () => qrTokenFromSearch(`?${searchParams.toString()}`) ?? recalledQrTable() ?? draft0.qrToken,
  );

  const persist = useCallback((): void => {
    if (completedRef.current) return;
    saveDraft({
      form: form.getValues(),
      idempotencyKey: keyStateRef.current.idempotencyKey,
      unknownBodies: keyStateRef.current.unknownBodies,
      qrToken,
    });
  }, [form, qrToken]);

  // 欄位變更即寫入草稿（sessionStorage；觸控面板為記憶體）
  useEffect(() => {
    persist();
  }, [values, persist]);

  // ── 取餐方式 ──
  const orderType = values.orderType;
  const orderTypes = useMemo(() => availableOrderTypes(info, kiosk), [info, kiosk]);
  const methods = useMemo(
    () => allowedPaymentMethods(info, orderType, kiosk),
    [info, orderType, kiosk],
  );

  // 回退後的取餐方式寫回購物車，購物車頁與訂單面板維持一致
  useEffect(() => {
    if (useCartStore.getState().orderType !== defaults.orderType) {
      useCartStore.getState().setOrderType(defaults.orderType);
    }
  }, [defaults.orderType]);

  // 付款方式不在可用清單（取餐方式或店家設定改變）→ 改選第一個可用項
  useEffect(() => {
    const current = form.getValues('paymentMethod');
    if (methods.length > 0 && (current === '' || !methods.includes(current))) {
      setValue('paymentMethod', methods[0] ?? '', { shouldDirty: true });
    }
  }, [methods, form, setValue]);

  // ── QR 桌號解析 ──
  const tableQuery = useQuery({
    queryKey: qk.store.table(qrToken ?? ''),
    queryFn: () => api.store.resolveTable(qrToken ?? ''),
    enabled: qrToken !== null,
    staleTime: Infinity,
    retry: false,
  });
  const qrTable = tableQuery.data?.tableNo ?? null;
  const qrFailed = tableQuery.isError;
  useEffect(() => {
    if (qrTable === null) return;
    setValue('tableNo', qrTable);
    if (orderTypes.includes('DINE_IN') && form.getValues('orderType') !== 'DINE_IN') {
      setValue('orderType', 'DINE_IN', { shouldDirty: true });
      setValue('scheduleMode', 'ASAP');
      setValue('scheduledAt', '');
      useCartStore.getState().setOrderType('DINE_IN');
    }
  }, [qrTable, orderTypes, form, setValue]);

  // ── 外送範圍與地址簿 ──
  const deliveryZip =
    orderType === 'DELIVERY' && ZIP_RE.test(values.deliveryZip) ? values.deliveryZip : undefined;
  const checkQuery = useQuery({
    queryKey: qk.store.checkDelivery(deliveryZip ?? ''),
    queryFn: () => api.store.checkDelivery(deliveryZip ?? ''),
    enabled: deliveryZip !== undefined,
    staleTime: 60_000,
  });
  const deliveryCheck: DeliveryCheckState = useMemo(() => {
    if (deliveryZip === undefined) return { status: 'idle' };
    if (checkQuery.isPending) return { status: 'checking' };
    if (checkQuery.isError) return { status: 'error' };
    const r = checkQuery.data;
    if (r.deliverable) return { status: 'ok', zone: r.zone };
    return { status: r.reason === 'SERVICE_NOT_AVAILABLE' ? 'closed' : 'out' };
  }, [deliveryZip, checkQuery.isPending, checkQuery.isError, checkQuery.data]);

  const addressesQuery = useQuery({
    queryKey: qk.me.addresses(),
    queryFn: () => api.me.addresses.list(),
    enabled: isMember && orderTypes.includes('DELIVERY'),
    staleTime: 60_000,
  });
  const addresses: ReadonlyArray<Address> = useMemo(
    () => addressesQuery.data?.items ?? [],
    [addressesQuery.data],
  );
  const couponsQuery = useQuery({
    queryKey: qk.me.coupons('AVAILABLE'),
    queryFn: () => api.me.coupons.list('AVAILABLE'),
    enabled: isMember,
    staleTime: 60_000,
  });

  const selectAddress = useCallback(
    (a: Address | null): void => {
      if (a === null) {
        setValue('addressId', '', { shouldDirty: true });
        return;
      }
      setValue('addressId', a.id, { shouldDirty: true });
      setValue('deliveryCity', a.city, { shouldDirty: true });
      setValue('deliveryDistrict', a.district, { shouldDirty: true });
      setValue('deliveryZip', a.zipCode, { shouldDirty: true });
      setValue('deliveryLine', a.line, { shouldDirty: true });
      setValue('deliveryNote', a.note ?? '', { shouldDirty: true });
      form.clearErrors(['deliveryCity', 'deliveryDistrict', 'deliveryLine', 'deliveryNote']);
    },
    [form, setValue],
  );

  // 會員：結帳自動選取預設地址（FR-AC-04）
  const addressAppliedRef = useRef(false);
  useEffect(() => {
    if (addressAppliedRef.current || addresses.length === 0) return;
    const v = form.getValues();
    if (v.addressId !== '' || v.deliveryZip !== '' || v.deliveryLine !== '') {
      addressAppliedRef.current = true;
      return;
    }
    const pick = addresses.find((a) => a.isDefault) ?? addresses[0];
    addressAppliedRef.current = true;
    if (pick !== undefined) selectAddress(pick);
  }, [addresses, form, selectAddress]);

  // 會員：以會員資料預填聯絡資訊（EC-10）；已輸入者不覆寫
  useEffect(() => {
    if (user === null) return;
    const v = form.getValues();
    if (v.contactName === '' && user.name) setValue('contactName', user.name);
    if (v.contactPhone === '' && user.phone) setValue('contactPhone', formatPhoneInput(user.phone));
  }, [user, form, setValue]);

  // ── 取餐時段（staleTime 0、視窗取得焦點重抓；07 §7.1） ──
  const slotsEnabled = orderType !== 'DELIVERY' || deliveryZip !== undefined;
  const slotsQuery = useQuery({
    queryKey: qk.store.pickupSlots(orderType, deliveryZip),
    queryFn: () =>
      api.store.getPickupSlots({
        orderType,
        ...(deliveryZip !== undefined ? { zipCode: deliveryZip } : {}),
      }),
    enabled: slotsEnabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const slots = slotsQuery.data;

  const scheduledAt: string | null =
    orderType !== 'DINE_IN' && values.scheduleMode === 'SCHEDULED' && values.scheduledAt !== ''
      ? values.scheduledAt
      : null;

  // 預設選取：盡快可用則盡快；休息中 / 來不及則選第一個可預約時段（FR-CK-12）。送出被退回後清除的選取不自動補選（EC-07）
  const scheduleInitRef = useRef(draft0.form.scheduleMode !== undefined);
  useEffect(() => {
    if (slots === undefined || orderType === 'DINE_IN') return;
    const first = slots.days.flatMap((d) => d.slots).find((s) => s.status === 'AVAILABLE');
    const mode = form.getValues('scheduleMode');
    if (!slots.asap.available && mode === 'ASAP') {
      setValue('scheduleMode', 'SCHEDULED', { shouldDirty: true });
      if (first !== undefined && !scheduleInitRef.current) {
        setValue('scheduledAt', first.startAt, { shouldDirty: true });
      }
    }
    scheduleInitRef.current = true;
  }, [slots, orderType, form, setValue]);

  // ── 報價（購物車頁與結帳頁共用） ──
  const couponCode = values.couponCode;
  const quoteQuery = useQuote({
    orderType,
    lines,
    scheduledAt,
    ...(deliveryZip !== undefined ? { zipCode: deliveryZip } : {}),
    ...(couponCode !== '' ? { couponCode } : {}),
  });
  const quoteResult = quoteQuery.data ?? null;
  const quote: QuoteResponse | null = quoteResult?.quote ?? null;
  const repricing = quoteQuery.isStale || quoteQuery.isFetching;
  const precheckFailed = quoteQuery.isError && quoteResult === null;

  // 送出被退回時的「前一次報價」：只在該次 error.quote 仍是目前報價時才使用（供「剛剛被訂走了」判斷）；
  // 背景偵測不帶 previous，文案維持「今日售完」（03 §9）
  // 以內容比對（React Query 的 structural sharing 不保證物件同一性）
  const [rejection, setRejection] = useState<{
    currentJson: string;
    previous: QuoteResponse;
  } | null>(null);
  const previousQuote =
    rejection !== null && quote !== null && rejection.currentJson === JSON.stringify(quote)
      ? rejection.previous
      : undefined;

  // 顧客上一次看見的折扣（折扣碼失效時據以判斷「折扣已失效」）
  const [seenDiscount, setSeenDiscount] = useState<number | null>(null);
  if (quote !== null && !hasCouponError(quote) && seenDiscount !== quote.discount) {
    setSeenDiscount(quote.discount);
  }

  const [ack, setAck] = useState<PriceAck | null>(null);
  const [sticky, setSticky] = useState<StickyIssue[]>([]);

  const evaluate = useCallback(
    (q: QuoteResponse, lineIds: ReadonlyArray<string>, cartLines: ReadonlyArray<CartLine>) => {
      const shown = computeShown(q, lineIds, cartLines, ack, seenDiscount);
      const derived = deriveCheckoutIssues(q, lineIds, cartLines, shown, previousQuote);
      return { ...derived, shown };
    },
    [ack, seenDiscount, previousQuote],
  );

  const evaluation = useMemo(() => {
    if (quoteResult === null) return null;
    return evaluate(quoteResult.quote, quoteResult.lineIds, lines);
  }, [quoteResult, lines, evaluate]);

  const issues: CheckoutIssue[] = useMemo(() => {
    const derived = evaluation?.issues ?? [];
    const seen = new Set(derived.map((i) => `${i.code}|${i.field ?? ''}`));
    const extra = sticky
      .filter((s) => stickyStillValid(s, values))
      .map((s) => s.issue)
      .filter((i) => !seen.has(`${i.code}|${i.field ?? ''}`));
    return [...derived, ...extra].sort((a, b) => kindRank(a) - kindRank(b));
  }, [evaluation, sticky, values]);

  const blocking = blockingCount(issues);
  const priceCount = issues.filter((i) => i.kind === 'PRICE').length;
  const shownTotal = evaluation?.shown.total ?? quote?.total ?? 0;
  const priceDiffShown = ack !== null && quote !== null && quote.total <= ack.total;
  const nothingToBuy = lines.length === 0 || (quote !== null && hasNothingToBuy(quote));

  // ── 店家狀態 ──
  const statusQuery = useStoreStatus();
  const liveStatus = statusQuery.data?.status ?? info.status.status;
  const storeIssue = evaluation?.storeIssue ?? null;
  const [justNow, setJustNow] = useState(false);
  const storeKind: 'PAUSED' | 'CLOSED' | null =
    storeIssue === 'STORE_PAUSED' || liveStatus === 'PAUSED'
      ? 'PAUSED'
      : storeIssue === 'STORE_CLOSED' || liveStatus === 'CLOSED'
        ? 'CLOSED'
        : null;
  const storePaused = storeKind === 'PAUSED';

  useEffect(() => {
    if (storeIssue !== null) {
      void queryClient.invalidateQueries({ queryKey: qk.store.status() });
      void queryClient.invalidateQueries({ queryKey: qk.store.info() });
    }
  }, [storeIssue, queryClient]);

  // ── 異動清單的 UI 狀態 ──
  const [listOpen, setListOpen] = useState(false);
  const [listMode, setListMode] = useState<'rejected' | 'peek'>('peek');
  const [adjusted, setAdjusted] = useState<AdjustedState | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const undoNonceRef = useRef(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const handledFocusRequestRef = useRef(0);
  /** 單項處理（移除、改為 n 份、改選時段…）的時間點：重新計價回來後把焦點移到下一個異動項的主要動作 */
  const focusNextActionAtRef = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const adjustedRef = useRef<HTMLParagraphElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const firstSlotRef = useRef<HTMLInputElement>(null);
  const couponInputRef = useRef<HTMLInputElement>(null);
  const orderTypeAnchorRef = useRef<HTMLDivElement>(null);

  const openList = useCallback(
    (mode: 'rejected' | 'peek', focus = true, forceAck = false): void => {
      setListMode(mode);
      setListOpen(true);
      // 差異隨清單展開而呈現給顧客：記下已確認的單價，之後再按一次才送出（BR-25）
      if (quote !== null && quoteResult !== null && (forceAck || priceCountOf(issues) > 0)) {
        setAck(makeAck(quote, quoteResult.lineIds));
      }
      if (focus) setFocusRequest((n) => n + 1);
    },
    [issues, quote, quoteResult],
  );

  const showList = listOpen && (blocking > 0 || priceCount > 0);

  // 焦點請求（focusRequest 遞增）：清單實際渲染後才聚焦標題；「復原」後清單要等重新計價回來才再出現，請求會等到那時
  useEffect(() => {
    if (focusRequest === handledFocusRequestRef.current || !showList) return;
    const el = headingRef.current;
    if (el === null) return;
    handledFocusRequestRef.current = focusRequest;
    el.focus({ preventScroll: true });
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  }, [focusRequest, showList]);

  // 清單處理完（無阻擋項與價格更新）：收合並把焦點移到送出鈕；「已調整」摘要由 adjusted 狀態呈現。
  // 收合於 render 期間調整 state（不經 effect），背景偵測之後再出現異動時不會自動重新展開（FLOW-23）
  const resolved = blocking === 0 && priceCount === 0 && quoteResult !== null && !repricing;
  const [resolvedCount, setResolvedCount] = useState(0);
  if (listOpen && resolved) {
    setListOpen(false);
    setResolvedCount((n) => n + 1);
  }
  const adjustedLatest = useLatest(adjusted);
  useEffect(() => {
    if (resolvedCount === 0) return;
    // 「全部套用建議」已通報並把焦點放在已調整摘要，不再重複通報或搶焦點
    if (adjustedLatest.current !== null) return;
    announce(T.announce.allClear);
    submitRef.current?.focus();
  }, [resolvedCount, announce, adjustedLatest]);

  // 單項處理後的焦點（FLOW-23）：被按下的動作鈕隨該項消失，焦點不可落到 body；
  // 重新計價回來後移到下一個異動項的主要動作，全部處理完則由上方「已處理完」效果移到送出鈕。
  // 只在焦點仍在清單內或已遺失時移動，不搶走使用者已移到他處的焦點。
  useEffect(() => {
    const at = focusNextActionAtRef.current;
    if (at === null || quoteResult === null || repricing) return;
    focusNextActionAtRef.current = null;
    if (performance.now() - at > FOCUS_NEXT_ACTION_WINDOW_MS) return;
    const section = headingRef.current?.closest('section') ?? null;
    if (section === null) return;
    const active = document.activeElement;
    const lost = active === null || active === document.body || !document.contains(active);
    if (!lost && !section.contains(active)) return;
    section.querySelector<HTMLElement>('li button:not([aria-disabled="true"])')?.focus();
  }, [quoteResult, repricing, showList]);

  // 時段被退回後，原選取已清除（EC-07）：異動文案與「改選最近時段」仍以被退回的時段為準
  const rejectedSlotAt = useMemo(() => {
    const s = sticky.find((x) => x.issue.kind === 'SLOT' && x.issue.code === 'SLOT_UNAVAILABLE');
    if (s === undefined) return null;
    const at = s.rejectedValue.split('|')[1] ?? '';
    return at !== '' ? at : null;
  }, [sticky]);
  const slotTime = scheduledAt ?? rejectedSlotAt;

  const cards = useMemo(() => {
    const slot = slotContextOf(slots, slotTime);
    const alternative =
      orderTypes.find((o) => o !== orderType && o !== 'DELIVERY') ??
      orderTypes.find((o) => o !== orderType) ??
      null;
    return buildIssueCards(issues, {
      cartLines: lines,
      quote,
      dayWord: dayWordFor(getClock().now().getTime(), slotTime, calendarOf(info)),
      kiosk,
      orderType,
      scheduledAt: slotTime,
      slot,
      alternativeOrderType: alternative,
      pickupAvailable: orderTypes.includes('PICKUP'),
      couponCode,
      maxLines: info.limits.maxLines,
      maxPerItem: info.limits.maxQuantityPerItem,
    });
  }, [issues, lines, quote, slots, slotTime, orderTypes, orderType, kiosk, info, couponCode]);

  const plan = useMemo(() => {
    const p = planApplyAll(issues, slotContextOf(slots, slotTime));
    return p.count > 0 ? p : null;
  }, [issues, slots, slotTime]);

  // ── 背景偵測的通報（單一來源，合併為一句） ──
  const lastSigRef = useRef<string | null>(null);
  const suppressAnnounceRef = useRef(false);
  const pendingActionAnnounceRef = useRef<string | null>(null);
  const sig = issueSignature(issues);
  useEffect(() => {
    if (quoteResult === null || repricing) return;
    // 單項處理後的合併句：「已改為 2 份，金額 $670，還有 1 項需要處理」
    if (pendingActionAnnounceRef.current !== null) {
      const prefix = pendingActionAnnounceRef.current;
      pendingActionAnnounceRef.current = null;
      lastSigRef.current = sig;
      const tail =
        blocking > 0 ? `，${T.announce.stillBlocked(blocking)}` : `，${T.announce.allClear}`;
      announce(`${prefix}，金額 ${formatTWD(quoteResult.quote.total)}${tail}`);
      return;
    }
    if (lastSigRef.current === sig) return;
    const first = lastSigRef.current === null;
    lastSigRef.current = sig;
    if (suppressAnnounceRef.current) {
      suppressAnnounceRef.current = false;
      return;
    }
    if (blocking > 0) announce(T.announce.issuesFound(blocking));
    else if (priceCount > 0) announce(T.announce.priceFound(priceCount));
    else if (!first) announce(T.announce.allClear);
  }, [sig, quoteResult, repricing, blocking, priceCount, announce]);

  // ── 送出狀態 ──
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(() =>
    draft0.unknownBodies.length > 0
      ? {
          kind: 'UNKNOWN',
          message: kiosk ? t.errors.orderResultUnknownKiosk : t.errors.orderResultUnknown,
        }
      : null,
  );
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const queuedRef = useRef(false);
  const [validationShown, setValidationShown] = useState(false);
  const now = useClockNow(cooldownUntil !== null ? 1000 : null);
  const coolingSeconds =
    cooldownUntil === null ? 0 : Math.max(0, Math.ceil((cooldownUntil - now.getTime()) / 1000));
  const coolingDown = coolingSeconds > 0;
  // 冷卻結束（依 retryAfterSeconds）：解除送出鈕暫停
  useEffect(() => {
    if (cooldownUntil === null) return;
    const wait = Math.max(0, cooldownUntil - getClock().now().getTime());
    const id = setTimeout(() => setCooldownUntil(null), wait);
    return () => clearTimeout(id);
  }, [cooldownUntil]);

  const fieldErrorCount = Object.keys(form.formState.errors).length;

  // ── 欄位聚焦 ──
  const focusField = useCallback(
    (name: keyof CheckoutFormValues): void => {
      const selector = GROUP_SELECTORS[name];
      let el: HTMLElement | null = null;
      if (selector !== undefined) el = document.querySelector<HTMLElement>(selector);
      if (el !== null) el.focus();
      else form.setFocus(name);
      const target = el ?? (document.activeElement as HTMLElement | null);
      if (target !== null && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'center' });
      }
    },
    [form],
  );

  const focusFirstFieldError = useCallback((): void => {
    const first = FIELD_ORDER.find((n) => form.getFieldState(n).error !== undefined);
    if (first !== undefined) focusField(first);
  }, [form, focusField]);

  // ── 取餐方式切換 ──
  const changeOrderType = useCallback(
    (next: OrderType): void => {
      if (next === form.getValues('orderType')) return;
      setValue('orderType', next, { shouldDirty: true });
      useCartStore.getState().setOrderType(next);
      if (next === 'DINE_IN') {
        setValue('scheduleMode', 'ASAP', { shouldDirty: true });
        setValue('scheduledAt', '', { shouldDirty: true });
      }
      form.clearErrors();
      setValidationShown(false);
    },
    [form, setValue],
  );

  const selectSlot = useCallback(
    (startAt: string): void => {
      setValue('scheduleMode', 'SCHEDULED', { shouldDirty: true });
      setValue('scheduledAt', startAt, { shouldDirty: true });
      form.clearErrors('scheduledAt');
    },
    [form, setValue],
  );

  const changeMode = useCallback(
    (mode: 'ASAP' | 'SCHEDULED'): void => {
      setValue('scheduleMode', mode, { shouldDirty: true });
      if (mode === 'ASAP') setValue('scheduledAt', '', { shouldDirty: true });
      form.clearErrors('scheduledAt');
    },
    [form, setValue],
  );

  /** 復原後重新計價的結果仍有異動：清單重新展開，焦點回到清單標題（03 §10.2「復原」） */
  const reopenListAfterUndo = (): void => {
    setListMode('peek');
    setListOpen(true);
    setFocusRequest((n) => n + 1);
  };

  // ── 異動清單的就地動作 ──
  const handleIssueAction = (action: IssueAction): void => {
    const spec = action.spec;
    if (FOCUS_NEXT_ACTION_TYPES.has(spec.type)) focusNextActionAtRef.current = performance.now();
    switch (spec.type) {
      case 'FIT': {
        useCartStore
          .getState()
          .fitLinesToAvailable([{ lineId: spec.lineId, quantity: spec.quantity }]);
        pendingActionAnnounceRef.current = T.issues.fit(spec.quantity).replace('改為', '已改為');
        break;
      }
      case 'REMOVE_LINE': {
        const before = useCartStore.getState().lines;
        const target = before.find((l) => l.lineId === spec.lineId);
        useCartStore.getState().removeLine(spec.lineId);
        setUndo({
          message: T.issues.removed(target?.snapshot.name ?? ''),
          restore: () => useCartStore.getState().restoreLines(before),
          nonce: ++undoNonceRef.current,
        });
        pendingActionAnnounceRef.current = T.issues.removed(target?.snapshot.name ?? '');
        break;
      }
      case 'RESELECT':
      case 'REMOVE_LINES':
        navigate(ROUTES.cart);
        break;
      case 'PICK_SLOT':
      case 'TOMORROW':
        selectSlot(spec.startAt);
        pendingActionAnnounceRef.current = `時段改為 ${formatTime(spec.startAt)}`;
        break;
      case 'OTHER_SLOT':
        setValue('scheduleMode', 'SCHEDULED', { shouldDirty: true });
        setValue('scheduledAt', '', { shouldDirty: true });
        setTimeout(() => firstSlotRef.current?.focus(), 0);
        break;
      case 'ASAP':
        changeMode('ASAP');
        pendingActionAnnounceRef.current = '已改為盡快';
        break;
      case 'SWITCH_ORDER_TYPE': {
        const next = spec.orderType ?? orderTypes.find((o) => o !== orderType) ?? null;
        if (next !== null) {
          changeOrderType(next);
          pendingActionAnnounceRef.current = `已改為${T.orderTypeLabel[next]}`;
        } else {
          orderTypeAnchorRef.current?.scrollIntoView?.({ block: 'center' });
        }
        break;
      }
      case 'FOCUS_FIELD': {
        const map: Record<string, keyof CheckoutFormValues> = {
          delivery: 'deliveryLine',
          paymentMethod: 'paymentMethod',
          invoice: 'invoiceType',
          tableNo: 'tableNo',
        };
        if (spec.field === 'couponCode') {
          // 已套用的折扣碼先移除，才會出現輸入框供修改
          if (form.getValues('couponCode') !== '') removeCoupon();
          setTimeout(() => {
            couponInputRef.current?.focus();
            couponInputRef.current?.scrollIntoView?.({ block: 'center' });
          }, 0);
        } else if (spec.field === 'items') {
          navigate(ROUTES.cart);
        } else {
          const name = map[spec.field];
          if (name !== undefined) focusField(name);
        }
        break;
      }
      case 'REMOVE_COUPON':
        removeCoupon();
        break;
      case 'LOGIN':
        navigate(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.checkout)}`);
        break;
      case 'CONTINUE_ORDERING':
        navigate(ROUTES.home);
        break;
    }
  };

  const applyAll = (): void => {
    if (plan === null) return;
    const beforeLines = useCartStore.getState().lines;
    const beforeMode = form.getValues('scheduleMode');
    const beforeSlot = form.getValues('scheduledAt');
    if (plan.fits.length > 0) useCartStore.getState().fitLinesToAvailable(plan.fits);
    if (plan.slot !== null) selectSlot(plan.slot.startAt);
    setUndo(null);
    setAdjusted({
      text: T.issues.adjusted(plan.summary),
      restore: () => {
        useCartStore.getState().restoreLines(beforeLines);
        setValue('scheduleMode', beforeMode, { shouldDirty: true });
        setValue('scheduledAt', beforeSlot, { shouldDirty: true });
        setAdjusted(null);
        announce(T.issues.undoDone);
        reopenListAfterUndo();
      },
    });
    announce(T.issues.adjustedAnnounce(plan.count));
    setTimeout(() => adjustedRef.current?.focus(), 0);
  };

  // ── 折扣碼 ──
  function removeCoupon(): void {
    setValue('couponCode', '', { shouldDirty: true });
  }
  const applyCoupon = (code: string): void => {
    setValue('couponCode', code, { shouldDirty: true });
    announce(T.coupon.pending);
  };
  const couponIssue = issues.find((i) => i.field === 'couponCode' && i.blocking);
  const couponError =
    couponIssue === undefined
      ? undefined
      : couponIssue.code === 'LOGIN_REQUIRED'
        ? t.errors.couponMemberOnly
        : t.errors.message(couponIssue.code, couponIssue.message);
  const appliedName = quote?.coupon?.applied === true ? quote.coupon.name : undefined;

  const serverErrorOf = (field: 'paymentMethod' | 'invoice'): string | undefined => {
    const hit = issues.find((i) => (i.field ?? '').startsWith(field) && i.blocking);
    return hit === undefined ? undefined : t.errors.message(hit.code, hit.message);
  };

  // ── 送出管線 ──
  const quoteCacheKey = useMemo(
    () =>
      qk.quote(
        JSON.stringify({ request: quoteQuery.request, lineIds: lines.map((l) => l.lineId) }),
      ),
    [quoteQuery.request, lines],
  );

  const buildBody = useCallback(
    (expectedTotal: number): CreateOrderRequest =>
      buildCreateOrderRequest({
        values: form.getValues(),
        lines: useCartStore.getState().lines,
        expectedTotal,
        qrToken: qrTable !== null ? (qrToken ?? undefined) : undefined,
      }),
    [form, qrTable, qrToken],
  );

  const snapshotTotal = useCallback(
    () => useCartStore.getState().lines.reduce((s, l) => s + l.snapshot.unitPrice * l.quantity, 0),
    [],
  );

  const startCooldown = (seconds: number): void => {
    setCooldownUntil(getClock().now().getTime() + seconds * 1000);
  };

  const completeOrder = (
    outcome: Extract<SubmitOutcome, { kind: 'CREATED' | 'REPLAYED' }>,
  ): void => {
    const { response } = outcome;
    const order = response.order;
    const replayed = outcome.kind === 'REPLAYED';
    const clearCart = outcome.kind === 'CREATED' || outcome.clearCart;
    const v = form.getValues();
    const cartLines = useCartStore.getState().lines;

    completedRef.current = true;
    setCompleted(true);

    // 訪客：記下追蹤權杖（重放時重新簽發，舊權杖失效；BR-27）
    if (!isMember && response.trackingToken !== undefined) {
      useGuestOrdersStore.getState().upsert({
        orderId: order.id,
        orderNo: order.orderNo,
        trackingToken: response.trackingToken,
        placedAt: order.placedAt,
      });
    }

    if (!kiosk) {
      const prefs = usePrefsStore.getState();
      prefs.patch({
        lastOrderType: v.orderType,
        ...(v.paymentMethod !== '' ? { lastPaymentMethod: v.paymentMethod } : {}),
      });
      if (clearCart && !isMember) {
        prefs.rememberOrder(
          cartLines.map((l) => ({
            productId: l.productId,
            optionIds: l.optionIds,
            labels: l.snapshot.optionLabels,
            ...(l.note !== undefined ? { note: l.note } : {}),
          })),
          getClock().now().getTime(),
        );
      }
      if (!isMember) {
        if (v.rememberMe) {
          prefs.patch({
            guestProfile: {
              name: v.contactName.trim(),
              phone: v.contactPhone.replace(/\D/g, ''),
              ...(v.orderType === 'DELIVERY' && v.deliveryZip !== ''
                ? {
                    delivery: {
                      city: v.deliveryCity,
                      district: v.deliveryDistrict,
                      zipCode: v.deliveryZip,
                      line: v.deliveryLine.trim(),
                      ...(v.deliveryNote.trim() !== '' ? { note: v.deliveryNote.trim() } : {}),
                    },
                  }
                : prefs.guestProfile?.delivery !== undefined
                  ? { delivery: prefs.guestProfile.delivery }
                  : {}),
              ...(v.paymentMethod !== '' ? { paymentMethod: v.paymentMethod } : {}),
              invoice: {
                type: v.invoiceType,
                ...(v.invoiceCarrierCode !== '' ? { carrierCode: v.invoiceCarrierCode } : {}),
                ...(v.invoiceTaxId !== '' ? { taxId: v.invoiceTaxId } : {}),
                ...(v.invoiceBuyerName !== '' ? { buyerName: v.invoiceBuyerName } : {}),
                ...(v.invoiceDonateCode !== '' ? { donateCode: v.invoiceDonateCode } : {}),
              },
            },
          });
        } else if (prefs.guestProfile !== null) {
          // 取消勾選「記住我的資料」：不再保留先前存下的資料
          prefs.patch({ guestProfile: null });
        }
      }
    }

    // 購物車與草稿：201 一律清除；重放僅在原訂單未取消且內容一致時清除（BR-41），否則保留並提示
    if (clearCart) {
      useCartStore.getState().clear();
      clearDraft();
    } else {
      saveDraft({ form: v, idempotencyKey: null, unknownBodies: [], qrToken });
    }

    const phone = order.customer?.phone ?? outcome.body.contact.phone;
    if (outcome.kind === 'REPLAYED') {
      if (outcome.cancelled) toast({ message: T.replay.cancelled, durationMs: 6000 });
      else if (outcome.sameAsCart) toast({ message: T.replay.created });
      else toast({ message: T.replay.differentContent, durationMs: 8000 });
    }
    const replayKind: OrderNavState['replayed'] | undefined =
      outcome.kind !== 'REPLAYED'
        ? undefined
        : outcome.cancelled
          ? 'CANCELLED'
          : outcome.sameAsCart
            ? 'SAME'
            : 'DIFFERENT';

    const pay = response.nextAction === 'PAY' && !(replayed && outcome.cancelled);
    if (pay) {
      const state: PaymentNavState = {
        placed: true,
        ...(phone !== undefined ? { phone } : {}),
        ...(replayKind === 'SAME' || replayKind === 'DIFFERENT' ? { replayed: replayKind } : {}),
      };
      navigate(ROUTES.payment(order.id), { state });
    } else {
      const state: OrderNavState = {
        placed: !replayed,
        ...(phone !== undefined ? { phone } : {}),
        ...(replayKind !== undefined ? { replayed: replayKind } : {}),
      };
      navigate(ROUTES.order(order.id), { state });
    }
  };

  /** 被退回（422、409 PRICE_CHANGED）：以 error.quote 更新異動清單；留在結帳頁，保留表單與 Key */
  const handleRejected = (outcome: Extract<SubmitOutcome, { kind: 'REJECTED' }>): void => {
    const f = outcome.failure;
    const cartLines = useCartStore.getState().lines;

    if (f.quote !== undefined) {
      const lineIds = cartLines.map((l) => l.lineId);
      queryClient.setQueryData(quoteCacheKey, { quote: f.quote, lineIds });
      const shown = computeShown(f.quote, lineIds, cartLines, ack, seenDiscount);
      const derived = deriveCheckoutIssues(f.quote, lineIds, cartLines, shown, quote ?? undefined);
      if (quote !== null) setRejection({ currentJson: JSON.stringify(f.quote), previous: quote });

      suppressAnnounceRef.current = true;
      if (derived.storeIssue !== null) {
        setJustNow(true);
        void queryClient.invalidateQueries({ queryKey: qk.store.status() });
        void queryClient.invalidateQueries({ queryKey: qk.store.info() });
      }
      if (
        derived.issues.some(
          (i) => i.code === 'SERVICE_NOT_AVAILABLE' || i.code === 'PAYMENT_METHOD_NOT_ALLOWED',
        )
      ) {
        void queryClient.invalidateQueries({ queryKey: qk.store.info() });
      }

      const v = form.getValues();
      const stickies = derived.issues
        .filter(isStickyIssue)
        .map((issue) => ({ issue, rejectedValue: stickyValueOf(issue, v) }));
      setSticky(stickies);

      const blockers = derived.issues.filter((i) => i.blocking);
      const slotOnly =
        blockers.length > 0 &&
        blockers.every((i) => i.kind === 'SLOT' && i.code === 'SLOT_UNAVAILABLE');
      const storeOnly =
        blockers.length === 0 &&
        derived.issues.every((i) => i.kind !== 'PRICE') &&
        derived.storeIssue !== null;

      // 價格差異已隨清單展開呈現：之後再按一次才送出（BR-25）
      if (derived.issues.some((i) => i.kind === 'PRICE')) setAck(makeAck(f.quote, lineIds));

      setListMode('rejected');
      setListOpen(true);
      setAdjusted(null);

      if (storeOnly) {
        setListOpen(false);
        setTimeout(() => noticeRef.current?.focus(), 0);
      } else if (slotOnly) {
        // 時段額滿且僅此一項：清除原選取、不自動選取，焦點到時段選擇區（EC-07）
        setValue('scheduledAt', '', { shouldDirty: true });
        void queryClient.invalidateQueries({ queryKey: ['store', 'pickup-slots'] });
        announce(T.announce.slotCleared);
        setTimeout(() => firstSlotRef.current?.focus(), 50);
      } else {
        setFocusRequest((n) => n + 1);
        announce(T.announce.rejected(blockingCount(derived.issues)));
      }
      return;
    }

    if (f.code === 'VALIDATION_FAILED') {
      for (const d of f.details ?? []) {
        const name = d.field !== undefined ? SERVER_FIELD_MAP[d.field] : undefined;
        if (name !== undefined) form.setError(name, { type: 'server', message: d.message });
      }
      setValidationShown(true);
      setAlert({ kind: 'VALIDATION', message: T.alert.validation });
      focusFirstFieldError();
      return;
    }
    setAlert({ kind: 'ERROR', message: t.errors.message(f.code, f.message || T.alert.generic) });
  };

  const handleOutcome = (outcome: SubmitOutcome): void => {
    switch (outcome.kind) {
      case 'CREATED':
      case 'REPLAYED':
        setAlert(null);
        completeOrder(outcome);
        break;
      case 'REJECTED':
        handleRejected(outcome);
        break;
      case 'NOT_CREATED': {
        const rate = outcome.failure.status === 429;
        startCooldown(outcome.retryAfterSeconds);
        setAlert({
          kind: rate ? 'RATE_LIMITED' : 'LOCK_TIMEOUT',
          message: rate ? T.alert.rateLimited : T.alert.lockTimeout,
        });
        break;
      }
      case 'UNKNOWN':
        setAlert({
          kind: 'UNKNOWN',
          message: kiosk ? t.errors.orderResultUnknownKiosk : t.errors.orderResultUnknown,
        });
        break;
    }
  };

  const runSubmit = async (body: CreateOrderRequest): Promise<void> => {
    lastBodyRef.current = body;
    const outcome = await submitOrder(
      {
        api,
        makeKey: () => crypto.randomUUID(),
        getCartItems: () =>
          useCartStore.getState().lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            optionIds: l.optionIds,
            ...(l.note !== undefined ? { note: l.note } : {}),
          })),
        onKeyReady: (state) => {
          keyStateRef.current = state;
          persist();
        },
      },
      body,
      keyStateRef.current,
    );
    keyStateRef.current = outcome.keyState;
    persist();
    handleOutcome(outcome);
  };

  /** 送出前預檢：唯讀、不保留；逾時或 5xx 略過，不阻擋送出（FLOW-04 O） */
  const precheck = async (): Promise<{ quote: QuoteResponse; lineIds: string[] } | null> => {
    try {
      const q = await api.orders.quote(quoteQuery.request);
      const result = { quote: q, lineIds: lines.map((l) => l.lineId) };
      queryClient.setQueryData(quoteCacheKey, result);
      return result;
    } catch {
      return null;
    }
  };

  const requestSubmit = async (): Promise<void> => {
    if (submittingRef.current || completedRef.current) return;
    const ctx: SubmitContext = {
      submitting: false,
      coolingDown,
      storePaused,
      repricing,
      priceDiffShown,
    };
    const quotedTotal = quote?.total ?? shownTotal;
    const decision = decideSubmit(issues, shownTotal, quotedTotal, ctx);

    switch (decision.type) {
      case 'NOOP':
        if (storePaused) noticeRef.current?.focus();
        else if (coolingDown) retryRef.current?.focus();
        return;
      case 'QUEUE':
        queuedRef.current = true;
        announce(T.announce.queued);
        return;
      case 'FOCUS_LIST':
        void form.trigger().then(() => setValidationShown(true));
        openList(listOpen ? listMode : 'peek');
        announce(T.announce.stillBlocked(decision.blockingCount));
        return;
      case 'REVEAL_PRICE_DIFF':
        openList('rejected', true, true);
        if (quote !== null) {
          announce(T.submit.priceDiff(formatTWD(shownTotal), formatTWD(quote.total)));
        }
        return;
      case 'SEND':
        break;
    }

    submittingRef.current = true;
    setSubmitting(true);
    announce(T.submit.submitting);
    setAlert(null);
    try {
      // 1) 表單驗證：失敗時捲動並聚焦第一個錯誤欄位（FR-CK-10）
      const valid = await form.trigger();
      if (!valid) {
        setValidationShown(true);
        focusFirstFieldError();
        return;
      }

      // 2) 預檢：發現異動則不送出，改為展開清單（屬使用者按下送出的結果）
      let expectedTotal = quote?.total ?? snapshotTotal();
      const fresh = await precheck();
      if (fresh !== null) {
        const cartLines = useCartStore.getState().lines;
        // 預檢發現的異動屬使用者按下送出的結果：以送出前顯示的報價作為「前一次報價」（剛剛被訂走了）
        const preShown = computeShown(fresh.quote, fresh.lineIds, cartLines, ack, seenDiscount);
        const ev = {
          ...deriveCheckoutIssues(
            fresh.quote,
            fresh.lineIds,
            cartLines,
            preShown,
            quote ?? undefined,
          ),
          shown: preShown,
        };
        const d = decideSubmit(ev.issues, ev.shown.total, fresh.quote.total, {
          submitting: false,
          coolingDown: false,
          storePaused: ev.storeIssue === 'STORE_PAUSED',
          repricing: false,
          priceDiffShown: ack !== null && fresh.quote.total <= ack.total,
        });
        if (ev.storeIssue !== null) {
          setJustNow(true);
          void queryClient.invalidateQueries({ queryKey: qk.store.status() });
          void queryClient.invalidateQueries({ queryKey: qk.store.info() });
          if (d.type === 'NOOP') {
            setTimeout(() => noticeRef.current?.focus(), 0);
            return;
          }
        }
        if (d.type === 'FOCUS_LIST' || d.type === 'REVEAL_PRICE_DIFF') {
          suppressAnnounceRef.current = true;
          if (quote !== null)
            setRejection({ currentJson: JSON.stringify(fresh.quote), previous: quote });
          setListMode('rejected');
          setListOpen(true);
          setAdjusted(null);
          if (ev.issues.some((i) => i.kind === 'PRICE'))
            setAck(makeAck(fresh.quote, fresh.lineIds));
          setFocusRequest((n) => n + 1);
          announce(
            d.type === 'FOCUS_LIST'
              ? T.announce.rejected(d.blockingCount)
              : T.submit.priceDiff(formatTWD(ev.shown.total), formatTWD(fresh.quote.total)),
          );
          return;
        }
        expectedTotal = fresh.quote.total;
      }

      // 3) POST /orders（同一把 Idempotency-Key）
      await runSubmit(buildBody(expectedTotal));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // 重新計價中按下送出會排入佇列：quote 回來後依同一套規則處理（有阻擋項或總額增加時改為展開清單）
  useEffect(() => {
    if (!queuedRef.current || repricing) return;
    queuedRef.current = false;
    void requestSubmit();
    // requestSubmit 以最新閉包執行；僅在重新計價結束時觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repricing]);

  const retryUnknown = async (): Promise<void> => {
    if (submittingRef.current || coolingDown) return;
    const recorded = keyStateRef.current.unknownBodies;
    const body = recorded[recorded.length - 1] ?? lastBodyRef.current;
    if (body === null) {
      await requestSubmit();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setAlert(null);
    try {
      await runSubmit(body);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const onRetry = (): void => {
    if (alert?.kind === 'UNKNOWN') void retryUnknown();
    else void requestSubmit();
  };

  // 提示出現時，焦點移到「再試一次」（Alert 朗讀一次）
  useEffect(() => {
    if (alert !== null && alert.kind !== 'VALIDATION') {
      const id = setTimeout(() => retryRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [alert]);

  // ── 快速鍵 ──
  useHotkeyAction('back', () => navigate(ROUTES.cart));
  useHotkeyAction('submitOrder', () => void requestSubmit());

  // ── 觸控面板閒置重置：丟棄表單、Key 與記下的送出內容並回首頁（FLOW-21） ──
  const defaultsRef = useRef(defaults);
  useEffect(
    () =>
      onKioskReset(() => {
        completedRef.current = true;
        keyStateRef.current = EMPTY_KEY_STATE;
        lastBodyRef.current = null;
        clearDraft();
        form.reset(defaultsRef.current);
        navigate(ROUTES.home, { replace: true });
      }),
    [form, navigate],
  );

  // ── 畫面 ──
  const statusState: StatusBarState = precheckFailed
    ? 'precheckFailed'
    : quote === null || (repricing && quoteResult === null)
      ? 'confirming'
      : blocking > 0
        ? 'issues'
        : priceCount > 0
          ? 'priceOnly'
          : repricing
            ? 'confirming'
            : 'ok';

  const barState: SubmitBarState = storePaused
    ? 'paused'
    : submitting
      ? 'submitting'
      : coolingDown
        ? 'cooling'
        : repricing
          ? 'repricing'
          : blocking > 0
            ? 'locked'
            : 'idle';
  const totalText = quote !== null ? formatTWD(quote.total) : '';
  const confirmPrice = ack !== null && priceCount > 0 && blocking === 0;
  const submitLabel =
    barState === 'submitting'
      ? T.submit.submitting
      : barState === 'repricing'
        ? T.submit.repricing
        : confirmPrice
          ? T.submit.confirmPrice(totalText)
          : totalText === ''
            ? '送出訂單'
            : T.submit.label(totalText);
  const helpText =
    barState === 'paused'
      ? T.submit.paused
      : barState === 'cooling'
        ? T.submit.cooling(coolingSeconds)
        : barState === 'locked'
          ? T.submit.locked(blocking)
          : undefined;

  const closeNotice = useMemo(
    () => (info.status.nextOpenAt !== undefined ? formatTime(info.status.nextOpenAt) : undefined),
    [info.status.nextOpenAt],
  );
  const liveNextOpen = statusQuery.data?.nextOpenAt ?? info.status.nextOpenAt;
  const pausedUntilText =
    (statusQuery.data?.pausedUntil ?? info.status.pausedUntil) !== undefined
      ? formatTime((statusQuery.data?.pausedUntil ?? info.status.pausedUntil) as string)
      : undefined;
  const nextOpenText = liveNextOpen !== undefined ? formatTime(liveNextOpen) : closeNotice;

  const storeAddressText = `${info.address.city}${info.address.district}${info.address.line}`;
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  const slotsAsapText = ((): string | undefined => {
    const a = slots?.asap;
    if (a === undefined || a.available) return undefined;
    if (a.unavailableReason === 'STORE_PAUSED') return T.time.storePaused;
    if (a.unavailableReason === 'STORE_CLOSED') return T.time.storeClosed;
    return orderType === 'DELIVERY' ? T.time.asapCannotCatch : T.issues.slotAsapUnavailable;
  })();

  if (completed) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10" role="status" aria-busy="true">
        <p className="text-center text-text-muted">{T.submit.submitting}</p>
      </div>
    );
  }

  // 桌號有效但店家未開放內用：不鎖定，回到一般取餐方式並說明（03 PG-01）
  const qrDineInOff = qrTable !== null && !orderTypes.includes('DINE_IN');
  const lockedTo: OrderType | null =
    qrToken !== null && qrTable !== null && !qrDineInOff ? 'DINE_IN' : null;
  const undoNotice =
    undo !== null ? (
      <UndoNotice
        nonce={undo.nonce}
        message={undo.message}
        onUndo={() => {
          undo.restore();
          setUndo(null);
          announce(T.issues.undoDone);
          reopenListAfterUndo();
        }}
        onExpire={() => setUndo(null)}
      />
    ) : null;
  const summaryNode = (
    <OrderSummaryPanel
      lines={lines}
      quote={quote}
      lineIds={quoteResult?.lineIds ?? []}
      pricing={repricing}
      cards={cards}
      busy={repricing}
      orderType={orderType}
      deliveryZoneChosen={deliveryZip !== undefined}
      onAction={handleIssueAction}
    />
  );
  const submitNode = (
    <SubmitBar
      state={barState}
      label={submitLabel}
      helpText={helpText}
      showShortcut={finePointer && !kiosk}
      sticky={!isDesktop}
      buttonRef={submitRef}
      onClick={() => void requestSubmit()}
    />
  );

  return (
    <FormProvider {...form}>
      <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-6">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            {alert !== null ? (
              <SubmitAlert
                kind={alert.kind}
                message={alert.message}
                kiosk={kiosk}
                storeName={info.name}
                phone={info.phone}
                coolingSeconds={coolingSeconds}
                retrying={false}
                onRetry={onRetry}
                retryRef={retryRef}
              />
            ) : null}
            {validationShown && fieldErrorCount > 0 ? (
              <div
                role="alert"
                className="rounded-md border border-danger/25 bg-danger-soft p-3 text-sm leading-5"
              >
                <p className="font-semibold text-danger">{T.form.errorSummary(fieldErrorCount)}</p>
                <p className="text-text">{T.form.errorSummaryHint}</p>
              </div>
            ) : null}

            <StatusBar
              state={statusState}
              blocking={blocking}
              priceCount={priceCount}
              onView={() => openList('peek')}
            />
            <StoreNotice
              kind={storeKind}
              justNow={justNow}
              pausedUntil={pausedUntilText}
              nextOpenAt={nextOpenText}
              storeName={info.name}
              phone={info.phone}
              kiosk={kiosk}
              canSchedule={orderType !== 'DINE_IN'}
              onSwitchToScheduled={() => {
                changeMode('SCHEDULED');
                setTimeout(() => firstSlotRef.current?.focus(), 0);
              }}
              noticeRef={noticeRef}
            />

            {adjusted !== null && !nothingToBuy ? (
              <AdjustedSummary
                text={adjusted.text}
                onUndo={adjusted.restore}
                headingRef={adjustedRef}
              />
            ) : null}

            {nothingToBuy ? (
              <div className="rounded-lg border border-border bg-bg">
                <EmptyState
                  icon="🍽️"
                  title={T.issues.nothingToBuyTitle}
                  description={T.issues.nothingToBuyDesc}
                  action={
                    <LinkButton as={Link} to={ROUTES.home}>
                      {T.backToMenu}
                    </LinkButton>
                  }
                />
              </div>
            ) : showList ? (
              <AvailabilityIssueList
                cards={cards}
                blockingCount={blocking}
                mode={listMode}
                busy={repricing}
                plan={plan}
                headingRef={headingRef}
                onAction={handleIssueAction}
                onApplyAll={applyAll}
                onBackToCart={() => navigate(ROUTES.cart)}
                after={undoNotice}
              />
            ) : (
              undoNotice
            )}

            {!isMember && !kiosk && !nudgeDismissed ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-info/25 bg-info-soft px-3 py-2 text-sm leading-5 text-text">
                <p className="flex min-w-0 items-center gap-2">
                  <Info aria-hidden="true" className="size-4 shrink-0 text-info" />
                  <span>
                    {T.loginNudge.text}
                    <Link
                      to={`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.checkout)}`}
                      className="font-semibold text-brand-text underline underline-offset-4"
                    >
                      {T.loginNudge.link}
                    </Link>
                    {T.loginNudge.suffix}
                  </span>
                </p>
                <IconButton
                  label={T.loginNudge.dismiss}
                  icon={<X />}
                  size="sm"
                  onClick={() => setNudgeDismissed(true)}
                />
              </div>
            ) : null}

            <fieldset
              disabled={storePaused}
              className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
            >
              <div ref={orderTypeAnchorRef}>
                <OrderTypeSection
                  available={orderTypes.length > 0 ? orderTypes : ALL_ORDER_TYPES}
                  value={orderType}
                  currentUnavailable={!orderTypes.includes(orderType)}
                  lockedTo={lockedTo}
                  lockedHint={
                    lockedTo !== null && qrTable !== null
                      ? T.orderType.tableLocked(qrTable)
                      : undefined
                  }
                  kiosk={kiosk}
                  onChange={changeOrderType}
                  aside={orderType === 'PICKUP' ? storeAddressText : undefined}
                />
              </div>
              <TimeSection
                orderType={orderType}
                slots={slots}
                loading={slotsQuery.isPending && slotsEnabled}
                failed={slotsQuery.isError}
                waitingForZip={orderType === 'DELIVERY' && deliveryZip === undefined}
                asapUnavailableText={slotsAsapText}
                mode={values.scheduleMode}
                scheduledAt={values.scheduledAt}
                error={form.formState.errors.scheduledAt?.message}
                deliveryMinutes={
                  deliveryCheck.status === 'ok' ? deliveryCheck.zone?.estimatedMinutes : undefined
                }
                firstSlotRef={firstSlotRef}
                onModeChange={changeMode}
                onSelectSlot={selectSlot}
              />
              <PlaceSection
                orderType={orderType}
                storeName={info.name}
                storeAddressText={storeAddressText}
                kiosk={kiosk}
                addresses={addresses}
                deliveryCheck={deliveryCheck}
                pickupAvailable={orderTypes.includes('PICKUP')}
                onSwitchToPickup={() => changeOrderType('PICKUP')}
                onSelectAddress={selectAddress}
                qrTable={qrTable}
                qrFailed={qrFailed}
                qrDineInOff={qrDineInOff}
                tableChecking={tableQuery.isPending && qrToken !== null}
              />
              <ContactSection
                orderType={orderType}
                showRemember={!isMember && !kiosk}
                hasStoredProfile={hasStoredProfile}
                onClearMyData={() => {
                  usePrefsStore.getState().clearMyData();
                  useGuestOrdersStore.getState().clear();
                  setValue('rememberMe', false);
                }}
              />
              <PaymentSection
                methods={methods}
                orderType={orderType}
                kiosk={kiosk}
                serverError={serverErrorOf('paymentMethod')}
              />
              <CouponSection
                appliedCode={couponCode}
                appliedName={appliedName}
                error={couponError}
                pending={
                  repricing &&
                  couponCode !== '' &&
                  quote?.coupon === undefined &&
                  couponError === undefined
                }
                onApply={applyCoupon}
                onRemove={removeCoupon}
                memberCoupons={couponsQuery.data?.items ?? []}
                subtotal={quote?.subtotal ?? 0}
                orderType={orderType}
                inputRef={couponInputRef}
              />
              <InvoiceSection serverError={serverErrorOf('invoice')} />
              <NoteSection />
            </fieldset>

            {!isDesktop ? summaryNode : null}

            <div className="flex flex-col gap-2 text-sm leading-5 text-text-sub">
              <p className="kiosk:flex kiosk:flex-wrap kiosk:items-center">
                {T.terms.prefix}
                <Link
                  to={ROUTES.terms}
                  className="text-brand-text underline underline-offset-4 kiosk:inline-flex kiosk:min-h-(--hit-size) kiosk:min-w-(--hit-size) kiosk:items-center kiosk:justify-center kiosk:px-2"
                >
                  {T.terms.terms}
                </Link>
                {T.terms.and}
                <Link
                  to={ROUTES.privacy}
                  className="text-brand-text underline underline-offset-4 kiosk:inline-flex kiosk:min-h-(--hit-size) kiosk:min-w-(--hit-size) kiosk:items-center kiosk:justify-center kiosk:px-2"
                >
                  {T.terms.privacy}
                </Link>
                。
              </p>
              <MarketingCheckbox />
            </div>

            {!isDesktop ? submitNode : null}
          </div>

          {isDesktop ? (
            <aside className="sticky top-4 flex flex-col gap-3" aria-label={T.section.summary}>
              {summaryNode}
              {submitNode}
            </aside>
          ) : null}
        </div>
      </div>
    </FormProvider>
  );
}

function MarketingCheckbox() {
  const marketing = useBooleanField('marketingOptIn');
  return (
    <Checkbox
      label={T.terms.marketing}
      description={T.terms.marketingHint}
      checked={marketing.checked}
      onCheckedChange={marketing.set}
    />
  );
}

const KIND_ORDER: Record<CheckoutIssue['kind'], number> = {
  UNAVAILABLE: 0,
  QUANTITY: 1,
  SLOT: 2,
  CONDITION: 3,
  PRICE: 4,
};
const kindRank = (i: CheckoutIssue): number => KIND_ORDER[i.kind];
const priceCountOf = (issues: ReadonlyArray<CheckoutIssue>): number =>
  issues.filter((i) => i.kind === 'PRICE').length;
