// src/features/checkout/FormSections.tsx —— 結帳表單的 ③～⑧ 區塊（取餐地點、聯絡資訊、付款、優惠、發票、備註）
import { Banknote, CreditCard, ExternalLink, Smartphone, Wallet } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactElement, Ref } from 'react';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  RadioCard,
  RadioGroup,
  Select,
  TextArea,
  TextField,
} from '@/components';
import { formatTWD } from '@/domain/format';
import type { Address, DeliveryZone, OrderType, PaymentMethod, UserCoupon } from '@/domain/types';
import { COUPON_CODE_RE } from '@/domain/validation';
import { t } from '@/i18n/zh-TW';
import { checkout as tCheckout } from '@/i18n/strings/checkout';
import { formatPhoneInput, normalizeCouponInput } from './checkoutHelpers';
import { CITIES, districtsOf, findDistrict } from './districts';
import { FieldErrorText } from './FieldErrorText';
import { useBooleanField, useStringField } from './fieldBindings';
import { SectionCard } from './SectionCard';

// ───────── ③ 取餐 / 外送 / 桌號 ─────────

export interface DeliveryCheckState {
  status: 'idle' | 'checking' | 'ok' | 'out' | 'closed' | 'error';
  zone?: DeliveryZone | undefined;
}

export interface PlaceSectionProps {
  orderType: OrderType;
  storeName: string;
  storeAddressText: string;
  kiosk: boolean;
  /** 會員地址簿（訪客為空） */
  addresses: ReadonlyArray<Address>;
  deliveryCheck: DeliveryCheckState;
  pickupAvailable: boolean;
  onSwitchToPickup: () => void;
  /** 選擇地址簿項目（null = 手動填寫其他地址） */
  onSelectAddress: (address: Address | null) => void;
  /** QR 帶入並解析成功的桌號（鎖定，不可編輯）；null = 手動輸入 */
  qrTable: string | null;
  qrFailed: boolean;
  /** 桌號有效但店家未開放內用：回到一般取餐方式並說明 */
  qrDineInOff?: boolean | undefined;
  tableChecking: boolean;
}

export function PlaceSection({
  orderType,
  storeName,
  storeAddressText,
  kiosk,
  addresses,
  deliveryCheck,
  pickupAvailable,
  onSwitchToPickup,
  onSelectAddress,
  qrTable,
  qrFailed,
  qrDineInOff = false,
  tableChecking,
}: PlaceSectionProps) {
  const headingId = useId();
  const title =
    orderType === 'DELIVERY' ? '外送地址' : orderType === 'DINE_IN' ? '桌號' : '取餐地點';
  return (
    <SectionCard index={3} title={title} headingId={headingId}>
      {orderType === 'PICKUP' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm leading-5 text-text">
          <p className="min-w-0 [overflow-wrap:anywhere]">
            {storeName}・{storeAddressText}
          </p>
          {!kiosk ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(storeAddressText)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={tCheckout.pickup.navigateAria(storeName)}
              className="hit-area inline-flex min-h-(--hit-size) items-center gap-1 text-brand-text underline underline-offset-4"
            >
              {tCheckout.pickup.navigate}
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          ) : null}
        </div>
      ) : null}

      {orderType === 'DELIVERY' ? (
        <DeliveryFields
          addresses={addresses}
          check={deliveryCheck}
          pickupAvailable={pickupAvailable}
          onSwitchToPickup={onSwitchToPickup}
          onSelectAddress={onSelectAddress}
        />
      ) : null}

      {orderType === 'DINE_IN' ? (
        <TableField qrTable={qrTable} qrFailed={qrFailed} checking={tableChecking} />
      ) : null}

      {/* QR 桌號無法辨識而回退為一般點餐：說明原因，不讓顧客以為內用已生效（03 PG-01） */}
      {orderType !== 'DINE_IN' && (qrFailed || qrDineInOff) ? (
        <p role="status" className="mt-3 text-sm leading-5 text-warning">
          {qrFailed ? tCheckout.dineIn.notFoundFallback : tCheckout.dineIn.unavailableFallback}
        </p>
      ) : null}
    </SectionCard>
  );
}

function DeliveryFields({
  addresses,
  check,
  pickupAvailable,
  onSwitchToPickup,
  onSelectAddress,
}: {
  addresses: ReadonlyArray<Address>;
  check: DeliveryCheckState;
  pickupAvailable: boolean;
  onSwitchToPickup: () => void;
  onSelectAddress: (address: Address | null) => void;
}) {
  const T = tCheckout.delivery;
  const addressId = useStringField('addressId');
  const city = useStringField('deliveryCity');
  const district = useStringField('deliveryDistrict');
  const zip = useStringField('deliveryZip');
  const line = useStringField('deliveryLine');
  const note = useStringField('deliveryNote');

  const manual = addressId.value === '' || addresses.length === 0;
  const districtOptions = districtsOf(city.value).map((d) => ({
    value: d.district,
    label: `${d.district}（${d.zipCode}）`,
  }));
  // 地址簿帶入的行政區不在內建清單時，仍要能顯示目前值
  if (district.value !== '' && !districtOptions.some((o) => o.value === district.value)) {
    districtOptions.push({ value: district.value, label: `${district.value}（${zip.value}）` });
  }
  const cityOptions = CITIES.map((c) => ({ value: c, label: c }));
  if (city.value !== '' && !CITIES.includes(city.value)) {
    cityOptions.push({ value: city.value, label: city.value });
  }

  const zoneText = ((): string | null => {
    if (check.status !== 'ok' || check.zone === undefined) return null;
    const z = check.zone;
    return T.feeLine(
      formatTWD(z.deliveryFee),
      z.freeDeliveryThreshold === null ? null : formatTWD(z.freeDeliveryThreshold),
      z.estimatedMinutes,
    );
  })();

  return (
    <div className="flex flex-col gap-4">
      {addresses.length > 0 ? (
        <RadioGroup
          name="addressId"
          legend={T.addressBook}
          value={addressId.value === '' ? 'NEW' : addressId.value}
          onChange={(v) => {
            if (v === 'NEW') onSelectAddress(null);
            else onSelectAddress(addresses.find((a) => a.id === v) ?? null);
          }}
        >
          {addresses.map((a) => (
            <RadioCard
              key={a.id}
              value={a.id}
              label={`${a.label}・${a.district}${a.line}`}
              description={a.isDefault ? '預設地址' : undefined}
            />
          ))}
          <RadioCard value="NEW" label={T.useOther} />
        </RadioGroup>
      ) : null}

      {manual ? (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
          <Select
            label={T.city}
            required
            placeholder={T.selectCity}
            options={cityOptions}
            {...city.inputProps}
            error={city.error}
            onChange={(e) => {
              city.set(e.target.value);
              district.set('');
              zip.set('');
              addressId.set('');
            }}
          />
          <Select
            label={T.district}
            required
            placeholder={T.selectDistrict}
            options={districtOptions}
            {...district.inputProps}
            error={district.error}
            onChange={(e) => {
              const found = findDistrict(city.value, e.target.value);
              district.set(e.target.value);
              zip.set(found?.zipCode ?? '');
              addressId.set('');
            }}
          />
          <TextField
            containerClassName="min-[480px]:col-span-2"
            label={T.line}
            required
            autoComplete="street-address"
            enterKeyHint="next"
            {...line.inputProps}
            error={line.error}
            onChange={(e) => {
              line.set(e.target.value);
              addressId.set('');
            }}
          />
        </div>
      ) : null}

      <div aria-live="polite" className="min-h-6 text-sm leading-5">
        {check.status === 'checking' ? <p className="text-text-muted">{T.checking}</p> : null}
        {zoneText !== null ? (
          <p className="text-text-sub">
            {zoneText}
            {check.zone !== undefined && check.zone.minOrderAmount > 0
              ? `・${T.minOrder(formatTWD(check.zone.minOrderAmount))}`
              : ''}
          </p>
        ) : null}
        {check.status === 'error' ? <p className="text-text-muted">{T.checkFailed}</p> : null}
      </div>
      {check.status === 'out' || check.status === 'closed' ? (
        <div className="flex flex-col items-start gap-2">
          <FieldErrorText>{check.status === 'out' ? T.outOfArea : T.notAvailable}</FieldErrorText>
          {pickupAvailable ? (
            <Button variant="secondary" onClick={onSwitchToPickup}>
              {T.switchToPickup}
            </Button>
          ) : null}
        </div>
      ) : null}

      <TextField
        label={T.note}
        optional
        placeholder={T.notePlaceholder}
        counter={{ current: note.value.length, max: 50 }}
        {...note.inputProps}
        error={note.error}
        onChange={(e) => note.set(e.target.value)}
      />
    </div>
  );
}

function TableField({
  qrTable,
  qrFailed,
  checking,
}: {
  qrTable: string | null;
  qrFailed: boolean;
  checking: boolean;
}) {
  const T = tCheckout.dineIn;
  const table = useStringField('tableNo');
  if (qrTable !== null) {
    return <p className="text-base leading-6 font-semibold text-text">{T.resolved(qrTable)}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {checking ? <p className="text-sm leading-5 text-text-muted">{T.checking}</p> : null}
      {qrFailed ? <FieldErrorText>{T.notFound}</FieldErrorText> : null}
      <TextField
        label={T.tableNo}
        required
        hint={T.tableHint}
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={10}
        {...table.inputProps}
        error={table.error}
        onChange={(e) => table.set(e.target.value.toUpperCase())}
      />
    </div>
  );
}

// ───────── ④ 聯絡資訊 ─────────

export interface ContactSectionProps {
  orderType: OrderType;
  /** 訪客（非會員）且非觸控面板才提供「記住我的資料」 */
  showRemember: boolean;
  hasStoredProfile: boolean;
  onClearMyData: () => void;
  nameRef?: Ref<HTMLInputElement> | undefined;
}

export function ContactSection({
  orderType,
  showRemember,
  hasStoredProfile,
  onClearMyData,
}: ContactSectionProps) {
  const T = tCheckout.contact;
  const headingId = useId();
  const name = useStringField('contactName');
  const phone = useStringField('contactPhone');
  const remember = useBooleanField('rememberMe');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const optional = orderType === 'DINE_IN';

  return (
    <SectionCard index={4} title={tCheckout.section.contact} headingId={headingId}>
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
        <TextField
          label={T.name}
          required={!optional}
          optional={optional}
          autoComplete="name"
          enterKeyHint="next"
          placeholder={T.namePlaceholder}
          {...name.inputProps}
          error={name.error}
          onChange={(e) => name.set(e.target.value)}
        />
        <TextField
          label={T.phone}
          required={!optional}
          optional={optional}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          enterKeyHint="done"
          placeholder={T.phonePlaceholder}
          {...phone.inputProps}
          error={phone.error}
          onChange={(e) => phone.set(formatPhoneInput(e.target.value))}
        />
      </div>
      {showRemember ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4">
          <Checkbox label={T.remember} checked={remember.checked} onCheckedChange={remember.set} />
          {hasStoredProfile ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="hit-area min-h-(--hit-size) text-sm font-medium text-brand-text underline underline-offset-4"
            >
              {T.clearMyData}
            </button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title={tCheckout.contact.clearMyData}
        description={T.clearConfirm}
        confirmLabel={t.common.clear}
        onConfirm={onClearMyData}
      />
    </SectionCard>
  );
}

// ───────── ⑤ 付款方式 ─────────

const PAYMENT_ICON: Record<PaymentMethod, ReactElement> = {
  CASH: <Banknote />,
  CREDIT_CARD: <CreditCard />,
  LINE_PAY: <Smartphone />,
  JKOPAY: <Wallet />,
};

export interface PaymentSectionProps {
  methods: ReadonlyArray<PaymentMethod>;
  orderType: OrderType;
  kiosk: boolean;
  serverError: string | undefined;
}

export function PaymentSection({ methods, orderType, kiosk, serverError }: PaymentSectionProps) {
  const T = tCheckout.payment;
  const headingId = useId();
  const method = useStringField('paymentMethod');
  const error = method.error ?? serverError;
  return (
    <SectionCard index={5} title={T.legend} headingId={headingId}>
      {methods.length === 0 ? (
        <p className="text-sm leading-5 text-text-muted">{T.none}</p>
      ) : (
        <RadioGroup
          name="paymentMethod"
          legend={T.legend}
          hideLegend
          columns={2}
          value={method.value}
          onChange={(v) => method.set(v)}
          error={error}
        >
          {methods.map((m) => (
            <RadioCard
              key={m}
              value={m}
              icon={PAYMENT_ICON[m]}
              label={m === 'CASH' && kiosk ? T.cashLabelKiosk : tCheckout.paymentLabel[m]}
              description={m === 'CASH' ? T.cash[kiosk ? 'KIOSK' : orderType] : T.online}
            />
          ))}
        </RadioGroup>
      )}
      {kiosk ? <p className="mt-2 text-xs leading-4 text-text-muted">{T.kioskOnlyCash}</p> : null}
    </SectionCard>
  );
}

// ───────── ⑥ 優惠（折扣碼、我的優惠券） ─────────

export interface CouponSectionProps {
  appliedCode: string;
  appliedName: string | undefined;
  /** 由異動項（折扣碼類）取得的錯誤文字 */
  error: string | undefined;
  /** 折扣碼已送出驗證、報價尚未回來 */
  pending: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
  memberCoupons: ReadonlyArray<UserCoupon>;
  subtotal: number;
  orderType: OrderType;
  inputRef?: Ref<HTMLInputElement> | undefined;
}

export function CouponSection({
  appliedCode,
  appliedName,
  error,
  pending,
  onApply,
  onRemove,
  memberCoupons,
  subtotal,
  orderType,
  inputRef,
}: CouponSectionProps) {
  const T = tCheckout.coupon;
  const headingId = useId();
  const [draft, setDraft] = useState('');
  const [formatError, setFormatError] = useState<string | undefined>(undefined);
  const [showCoupons, setShowCoupons] = useState(false);

  const apply = (raw: string): void => {
    const code = normalizeCouponInput(raw);
    if (!COUPON_CODE_RE.test(code)) {
      setFormatError(T.invalidFormat);
      return;
    }
    setFormatError(undefined);
    setDraft('');
    onApply(code);
  };

  const usable = memberCoupons.filter((c) => c.status === 'AVAILABLE');

  return (
    <SectionCard index={6} title={tCheckout.section.coupon} headingId={headingId}>
      {appliedCode !== '' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm leading-5 font-medium text-text [overflow-wrap:anywhere]">
            {pending
              ? T.pending
              : error !== undefined
                ? T.appliedNoName(appliedCode)
                : T.applied(appliedCode, appliedName)}
          </p>
          <Button variant="ghost" aria-label={T.removeAria(appliedCode)} onClick={onRemove}>
            {T.remove}
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
        >
          <TextField
            containerClassName="min-[480px]:flex-1"
            label={T.label}
            optional
            autoCapitalize="characters"
            autoComplete="off"
            placeholder={T.placeholder}
            value={draft}
            ref={inputRef}
            error={formatError}
            onChange={(e) => {
              setDraft(normalizeCouponInput(e.target.value));
              setFormatError(undefined);
            }}
          />
          <Button type="submit" variant="secondary" className="min-[480px]:mb-0">
            {T.apply}
          </Button>
        </form>
      )}
      {error !== undefined ? <FieldErrorText>{error}</FieldErrorText> : null}

      {usable.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={showCoupons}
            onClick={() => setShowCoupons((v) => !v)}
            className="hit-area min-h-(--hit-size) text-sm font-medium text-brand-text underline underline-offset-4"
          >
            {T.myCouponsCount(usable.length)}
          </button>
          {showCoupons ? (
            <ul className="mt-2 flex flex-col gap-2">
              {usable.map((uc) => {
                const c = uc.coupon;
                const applicable = c.applicableOrderTypes.includes(orderType);
                const short = c.minOrderAmount > subtotal ? c.minOrderAmount - subtotal : 0;
                const reason = !applicable
                  ? T.notApplicable
                  : short > 0
                    ? T.needMore(formatTWD(short))
                    : undefined;
                return (
                  <li
                    key={uc.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm leading-5 font-semibold text-text">{c.name}</p>
                      <p className="text-xs leading-4 text-text-muted">
                        {c.code}
                        {reason !== undefined ? `・${reason}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      aria-label={T.applyAria(c.name)}
                      aria-disabled={reason !== undefined ? true : undefined}
                      onClick={() => apply(c.code)}
                    >
                      {T.use}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

// ───────── ⑦ 發票 ─────────

export function InvoiceSection({ serverError }: { serverError: string | undefined }) {
  const T = tCheckout.invoice;
  const headingId = useId();
  const type = useStringField('invoiceType');
  const carrier = useStringField('invoiceCarrierCode');
  const taxId = useStringField('invoiceTaxId');
  const buyer = useStringField('invoiceBuyerName');
  const donate = useStringField('invoiceDonateCode');
  const typeError = type.error ?? serverError;

  return (
    <SectionCard index={7} title={T.legend} headingId={headingId}>
      <RadioGroup
        name="invoiceType"
        legend={T.legend}
        hideLegend
        columns={2}
        value={type.value}
        onChange={(v) => type.set(v)}
        error={typeError}
      >
        <RadioCard value="PAPER" label={T.PAPER} />
        <RadioCard value="MOBILE_BARCODE" label={T.MOBILE_BARCODE} />
        <RadioCard value="CITIZEN_CERT" label={T.CITIZEN_CERT} />
        <RadioCard value="DONATION" label={T.DONATION} />
        <RadioCard value="COMPANY" label={T.COMPANY} />
      </RadioGroup>

      <div className="mt-3 flex flex-col gap-3">
        {type.value === 'MOBILE_BARCODE' ? (
          <TextField
            label={T.carrierMobile}
            required
            autoCapitalize="characters"
            autoComplete="off"
            placeholder={T.carrierMobilePlaceholder}
            {...carrier.inputProps}
            error={carrier.error}
            onChange={(e) => carrier.set(e.target.value.toUpperCase())}
          />
        ) : null}
        {type.value === 'CITIZEN_CERT' ? (
          <TextField
            label={T.carrierCert}
            required
            autoCapitalize="characters"
            autoComplete="off"
            placeholder={T.carrierCertPlaceholder}
            {...carrier.inputProps}
            error={carrier.error}
            onChange={(e) => carrier.set(e.target.value.toUpperCase())}
          />
        ) : null}
        {type.value === 'DONATION' ? (
          <TextField
            label={T.donate}
            required
            inputMode="numeric"
            autoComplete="off"
            placeholder={T.donatePlaceholder}
            {...donate.inputProps}
            error={donate.error}
            onChange={(e) => donate.set(e.target.value.replace(/\D/g, ''))}
          />
        ) : null}
        {type.value === 'COMPANY' ? (
          <>
            <TextField
              label={T.taxId}
              required
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              placeholder={T.taxIdPlaceholder}
              {...taxId.inputProps}
              error={taxId.error}
              onChange={(e) => taxId.set(e.target.value.replace(/\D/g, ''))}
            />
            <TextField
              label={T.buyerName}
              optional
              hint={T.buyerNameHint}
              {...buyer.inputProps}
              error={buyer.error}
              onChange={(e) => buyer.set(e.target.value)}
            />
          </>
        ) : null}
      </div>
    </SectionCard>
  );
}

// ───────── ⑧ 備註與餐具 ─────────

export function NoteSection() {
  const T = tCheckout.note;
  const headingId = useId();
  const note = useStringField('note');
  const utensils = useBooleanField('needUtensils');
  return (
    <SectionCard index={8} title={tCheckout.section.note} headingId={headingId}>
      <TextArea
        label={T.label}
        optional
        placeholder={T.placeholder}
        counter={{ current: note.value.length, max: 100 }}
        {...note.inputProps}
        error={note.error}
        onChange={(e) => note.set(e.target.value)}
      />
      <Checkbox
        containerClassName="mt-2"
        label={T.utensils}
        description={T.utensilsHint}
        checked={utensils.checked}
        onCheckedChange={utensils.set}
      />
    </SectionCard>
  );
}
