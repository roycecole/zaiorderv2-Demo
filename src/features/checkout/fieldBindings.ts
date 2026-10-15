// src/features/checkout/fieldBindings.ts —— React Hook Form 與 components 輸入元件的橋接
import { useController, useFormContext } from 'react-hook-form';
import type { CheckoutFormValues } from './checkoutSchema';

type StringFieldName = {
  [K in keyof CheckoutFormValues]: CheckoutFormValues[K] extends string ? K : never;
}[keyof CheckoutFormValues];

type BooleanFieldName = {
  [K in keyof CheckoutFormValues]: CheckoutFormValues[K] extends boolean ? K : never;
}[keyof CheckoutFormValues];

/** 字串欄位：回傳可直接展開到 TextField / TextArea / Select 的屬性（含 ref，供「聚焦第一個錯誤」） */
export function useStringField(name: StringFieldName) {
  const { control } = useFormContext<CheckoutFormValues>();
  const { field, fieldState } = useController({ name, control });
  return {
    inputProps: {
      name: field.name,
      value: typeof field.value === 'string' ? field.value : '',
      ref: field.ref,
      onBlur: field.onBlur,
    },
    set: (value: string): void => field.onChange(value),
    value: typeof field.value === 'string' ? field.value : '',
    error: fieldState.error?.message,
  };
}

export function useBooleanField(name: BooleanFieldName) {
  const { control } = useFormContext<CheckoutFormValues>();
  const { field, fieldState } = useController({ name, control });
  return {
    checked: field.value === true,
    set: (value: boolean): void => field.onChange(value),
    onBlur: field.onBlur,
    ref: field.ref,
    error: fieldState.error?.message,
  };
}
