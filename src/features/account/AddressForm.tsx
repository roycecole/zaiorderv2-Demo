// src/features/account/AddressForm.tsx —— 地址新增 / 編輯表單（CMP-20；PG-12）
//
// 縣市與行政區來自店家的外送區域（`store.getDeliveryZones`）：選擇行政區自動帶入郵遞區號；
// 取不到外送區域時改為手動輸入縣市、行政區與郵遞區號。驗證規則同伺服器（06 §5.15）。
import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Checkbox, Select, TextField } from '@/components';
import type { Address, DeliveryZone } from '@/domain/types';
import { PHONE_RE, normalizePhone } from '@/domain/validation';
import { account as tAccount } from '@/i18n/strings/account';

const f = tAccount.addresses.form;

export const addressSchema = z.object({
  label: z.string().trim().min(1, f.labelInvalid).max(10, f.labelInvalid),
  recipientName: z.string().trim().min(1, f.recipientNameInvalid).max(20, f.recipientNameInvalid),
  recipientPhone: z
    .string()
    .transform(normalizePhone)
    .pipe(z.string().regex(PHONE_RE, f.recipientPhoneInvalid)),
  city: z.string().min(1, f.cityInvalid),
  district: z.string().min(1, f.districtInvalid),
  zipCode: z.string().regex(/^\d{3}$/, f.zipCodeInvalid),
  line: z.string().trim().min(5, f.lineInvalid).max(100, f.lineInvalid),
  note: z.string().trim().max(50, f.noteInvalid),
  isDefault: z.boolean(),
});

export type AddressFormInput = z.input<typeof addressSchema>;
export type AddressFormValues = z.output<typeof addressSchema>;

export interface AddressFormProps {
  /** 編輯時帶入；省略為新增 */
  address?: Address;
  /** 店家外送區域；空陣列時改為手動輸入 */
  zones: ReadonlyArray<DeliveryZone>;
  /** 供外層的送出鈕以 `form` 屬性關聯 */
  formId: string;
  onSubmit: (values: AddressFormValues) => Promise<void> | void;
  /** 伺服器回傳的欄位錯誤（VALIDATION_FAILED details）；以 key 重新掛載表單時帶入 */
  serverErrors?: Partial<Record<keyof AddressFormValues, string>>;
}

export function AddressForm({ address, zones, formId, onSubmit, serverErrors }: AddressFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<AddressFormInput, unknown, AddressFormValues>({
    resolver: zodResolver(addressSchema),
    mode: 'onBlur',
    defaultValues: {
      label: address?.label ?? '',
      recipientName: address?.recipientName ?? '',
      recipientPhone: address?.recipientPhone ?? '',
      city: address?.city ?? '',
      district: address?.district ?? '',
      zipCode: address?.zipCode ?? '',
      line: address?.line ?? '',
      note: address?.note ?? '',
      isDefault: address?.isDefault ?? false,
    },
  });

  const city = useWatch({ control, name: 'city' });
  const zipCode = useWatch({ control, name: 'zipCode' });
  const note = useWatch({ control, name: 'note' });
  const manual = zones.length === 0;

  const cities = useMemo(() => {
    const set = new Set(zones.map((z) => z.city));
    if (address !== undefined && address.city !== '') set.add(address.city);
    return [...set];
  }, [zones, address]);

  const districts = useMemo(() => {
    const set = new Set(zones.filter((z) => z.city === city).map((z) => z.district));
    if (address !== undefined && address.city === city && address.district !== '') set.add(address.district);
    return [...set];
  }, [zones, city, address]);

  const cityField = register('city', {
    onChange: () => {
      // 縣市改變：行政區與郵遞區號重新選擇
      setValue('district', '');
      setValue('zipCode', '');
    },
  });
  const districtField = register('district', {
    onChange: (e: { target: { value: string } }) => {
      const zone = zones.find((z) => z.city === city && z.district === e.target.value);
      setValue('zipCode', zone?.zipCode ?? '', { shouldValidate: true });
    },
  });

  const err = (key: keyof AddressFormValues): string | undefined =>
    errors[key]?.message ?? serverErrors?.[key];

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(e) => void handleSubmit((v) => onSubmit(v))(e)}
      className="flex flex-col gap-4"
    >
      <TextField
        label={f.label}
        hint={f.labelHint}
        required
        enterKeyHint="next"
        error={err('label')}
        {...register('label')}
      />
      <TextField
        label={f.recipientName}
        required
        autoComplete="name"
        enterKeyHint="next"
        error={err('recipientName')}
        {...register('recipientName')}
      />
      <TextField
        label={f.recipientPhone}
        required
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        enterKeyHint="next"
        error={err('recipientPhone')}
        {...register('recipientPhone')}
      />

      {manual ? (
        <>
          <TextField
            label={f.city}
            required
            autoComplete="address-level1"
            error={err('city')}
            {...register('city')}
          />
          <TextField
            label={f.district}
            required
            autoComplete="address-level2"
            error={err('district')}
            {...register('district')}
          />
          <TextField
            label={f.zipCode}
            required
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={3}
            error={err('zipCode')}
            {...register('zipCode')}
          />
        </>
      ) : (
        <>
          <Select
            label={f.city}
            required
            placeholder={f.cityPlaceholder}
            hint={f.zonesHint}
            options={cities.map((c) => ({ value: c, label: c }))}
            error={err('city')}
            {...cityField}
          />
          <Select
            label={f.district}
            required
            placeholder={f.districtPlaceholder}
            options={districts.map((d) => ({ value: d, label: d }))}
            error={err('district')}
            disabled={city === ''}
            {...districtField}
          />
          <TextField
            label={f.zipCode}
            hint={f.zipCodeHint}
            readOnly
            required
            inputMode="numeric"
            autoComplete="postal-code"
            error={err('zipCode')}
            value={zipCode}
            {...register('zipCode')}
          />
        </>
      )}
      <TextField
        label={f.line}
        hint={f.lineHint}
        required
        autoComplete="street-address"
        enterKeyHint="next"
        error={err('line')}
        {...register('line')}
      />
      <TextField
        label={f.note}
        optional
        enterKeyHint="done"
        counter={{ current: (note ?? '').trim().length, max: 50 }}
        error={err('note')}
        {...register('note')}
      />
      <Checkbox label={f.isDefault} {...register('isDefault')} />
    </form>
  );
}
