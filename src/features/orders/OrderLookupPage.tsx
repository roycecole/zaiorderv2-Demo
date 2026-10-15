// src/features/orders/OrderLookupPage.tsx —— PG-08 訪客查詢訂單（FR-OD-07、EC-15）
//
// 以「訂單編號 + 手機」換取追蹤權杖（`orders.lookup`），成功後寫入本機記錄並導向訂單頁。
// 查無資料一律顯示同一句「找不到訂單，請確認編號與手機」，不揭露是哪個欄位錯誤；限流（429）顯示冷卻倒數。
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import { Button, Card, InlineAlert, TextField } from '@/components';
import { formatDateTime } from '@/domain/format';
import { PHONE_RE, normalizePhone } from '@/domain/validation';
import { readApiError } from '@/features/auth/errorInfo';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { useApi } from '@/hooks/useApi';
import { useClockNow } from '@/hooks/useClockNow';
import { errorMessageOf } from '@/i18n/strings/errors';
import { t } from '@/i18n/zh-TW';
import { orders as tOrders } from '@/i18n/strings/orders';
import { qk } from '@/services/api/queryKeys';
import { getClock } from '@/services/clock';
import { useGuestOrdersStore } from './guestOrdersStore';

const s = tOrders.lookup;

/** 訂單編號：去除空白與連字號並轉大寫 */
export const normalizeOrderNo = (input: string): string => input.replace(/[\s-]/g, '').toUpperCase();

const lookupSchema = z.object({
  orderNo: z
    .string()
    .transform(normalizeOrderNo)
    .pipe(z.string().min(1, s.orderNoRequired).max(30, s.orderNoTooLong)),
  phone: z
    .string()
    .transform(normalizePhone)
    .pipe(z.string().regex(PHONE_RE, s.phoneInvalid)),
});

type LookupInput = z.input<typeof lookupSchema>;
type LookupOutput = z.output<typeof lookupSchema>;

export function OrderLookupPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isLoggedIn = useSessionStore(selectIsLoggedIn);
  const kiosk = useIsKioskUi();
  const recent = useGuestOrdersStore((st) => st.orders);
  usePageTitle(s.pageTitle);

  const [notice, setNotice] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const rawNow = getClock().now().getTime();
  const cooling = cooldownUntil !== null && cooldownUntil > rawNow;
  const now = useClockNow(cooling ? 1000 : null).getTime();
  const cooldownLeft = cooldownUntil === null ? 0 : Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const coolingDown = cooling && cooldownLeft > 0;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LookupInput, unknown, LookupOutput>({
    resolver: zodResolver(lookupSchema),
    defaultValues: { orderNo: '', phone: '' },
    mode: 'onBlur',
  });

  const onSubmit = async (values: LookupOutput): Promise<void> => {
    if (coolingDown) return;
    setNotice(null);
    try {
      const { orderId, trackingToken } = await api.orders.lookup(values.orderNo, values.phone);

      // 補齊本機記錄需要的資料（真正的訂單編號與下單時間），並預先放進快取讓訂單頁不必再等一次
      let orderNo = values.orderNo;
      let placedAt = getClock().now().toISOString();
      try {
        const order = await api.orders.get(orderId, { trackingToken });
        queryClient.setQueryData(qk.orders.detail(orderId), order);
        orderNo = order.orderNo;
        placedAt = order.placedAt;
      } catch {
        // 取不到也沒關係：導向訂單頁後會再載入
      }
      useGuestOrdersStore.getState().upsert({ orderId, orderNo, trackingToken, placedAt });
      navigate(ROUTES.order(orderId));
    } catch (e) {
      const info = readApiError(e);
      if (info.status === 429 || info.code === 'RATE_LIMITED') {
        if (info.retryAfterSeconds !== null) {
          setCooldownUntil(getClock().now().getTime() + info.retryAfterSeconds * 1000);
        }
        setNotice(s.rateLimited);
      } else if (info.status === 404 || info.code === 'NOT_FOUND') {
        setNotice(t.errors.orderNotFound);
      } else {
        setNotice(errorMessageOf(e));
      }
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-4 md:py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-bold text-text">{s.pageTitle}</h1>
        <p className="text-sm leading-5 text-text-sub">{s.intro}</p>
      </header>

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="flex flex-col gap-4">
        <TextField
          label={s.orderNoLabel}
          hint={s.orderNoHint}
          required
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="next"
          error={errors.orderNo?.message}
          {...register('orderNo')}
        />
        <TextField
          label={s.phoneLabel}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          enterKeyHint="search"
          placeholder="0912-345-678"
          required
          error={errors.phone?.message}
          {...register('phone')}
        />

        {notice !== null ? (
          <InlineAlert tone="error">
            <p>{notice}</p>
            {coolingDown ? <p role="timer">{s.retryIn(cooldownLeft)}</p> : null}
          </InlineAlert>
        ) : null}

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={isSubmitting}
          loadingLabel={s.submitting}
          aria-disabled={coolingDown ? true : undefined}
        >
          {s.submit}
        </Button>
      </form>

      <section aria-labelledby="lookup-recent-title" className="flex flex-col gap-3">
        <div>
          <h2 id="lookup-recent-title" className="text-h3 font-semibold text-text">
            {s.recentTitle}
          </h2>
          <p className="text-xs leading-4 text-text-muted">{s.recentHint}</p>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm leading-5 text-text-sub">{s.recentEmpty}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {recent.map((o) => (
              <li key={o.orderId}>
                <Card padding="none" interactive>
                  <Link
                    to={ROUTES.order(o.orderId)}
                    className="flex min-h-(--hit-size) items-center justify-between gap-3 rounded-lg px-4 py-3"
                    aria-label={s.recentOpen(o.orderNo)}
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-base leading-6 font-semibold text-text [overflow-wrap:anywhere]">
                        {o.orderNo}
                      </span>
                      <span className="block text-sm leading-5 text-text-muted">
                        {s.recentPlacedAt(formatDateTime(o.placedAt))}
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-text-muted" />
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!kiosk ? (
        <p className="text-sm leading-5 text-text-sub">
          {isLoggedIn ? (
            <Link to={ROUTES.orders} className="font-semibold text-brand-text underline underline-offset-2">
              {tOrders.history.pageTitle}
            </Link>
          ) : (
            <>
              {s.memberHint}
              <Link
                to={ROUTES.login}
                className="ml-1 font-semibold text-brand-text underline underline-offset-2"
              >
                {s.loginLink}
              </Link>
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
