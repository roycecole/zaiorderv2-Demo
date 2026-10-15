// src/features/checkout/buildRequest.ts —— 表單值 + 購物車 → POST /orders 的請求內容（06 §5.9）
import type { CartLine } from '@/domain/cart';
import type {
  CreateOrderRequest,
  OrderLineInput,
  OrderType,
  PaymentMethod,
  TWD,
} from '@/domain/types';
import { normalizePhone } from '@/domain/validation';
import type { CheckoutFormValues } from './checkoutSchema';

/** 購物車行 → 請求品項（備註去前後空白，空白視同未填） */
export function toOrderLines(
  lines: ReadonlyArray<Pick<CartLine, 'productId' | 'quantity' | 'optionIds' | 'note'>>,
): OrderLineInput[] {
  return lines.map((l) => {
    const item: OrderLineInput = {
      productId: l.productId,
      quantity: l.quantity,
      optionIds: [...l.optionIds],
    };
    const note = l.note?.trim();
    if (note) item.note = note;
    return item;
  });
}

export interface BuildRequestInput {
  values: CheckoutFormValues;
  lines: ReadonlyArray<CartLine>;
  /** 顧客目前據以送出的金額（BR-25） */
  expectedTotal: TWD;
  /** 由 QR 帶入的權杖（手動輸入桌號時省略） */
  qrToken?: string | undefined;
}

export function buildCreateOrderRequest({
  values,
  lines,
  expectedTotal,
  qrToken,
}: BuildRequestInput): CreateOrderRequest {
  const orderType: OrderType = values.orderType;
  const scheduled =
    orderType !== 'DINE_IN' && values.scheduleMode === 'SCHEDULED' && values.scheduledAt !== '';

  const contact: CreateOrderRequest['contact'] = {};
  const name = values.contactName.trim();
  const phone = normalizePhone(values.contactPhone.trim());
  if (name !== '') contact.name = name;
  if (phone !== '') contact.phone = phone;

  const invoice: CreateOrderRequest['invoice'] = { type: values.invoiceType };
  switch (values.invoiceType) {
    case 'MOBILE_BARCODE':
    case 'CITIZEN_CERT':
      invoice.carrierCode = values.invoiceCarrierCode.trim().toUpperCase();
      break;
    case 'DONATION':
      invoice.donateCode = values.invoiceDonateCode.trim();
      break;
    case 'COMPANY': {
      invoice.taxId = values.invoiceTaxId.trim();
      const buyer = values.invoiceBuyerName.trim();
      if (buyer !== '') invoice.buyerName = buyer;
      break;
    }
    case 'PAPER':
      break;
  }

  const req: CreateOrderRequest = {
    orderType,
    items: toOrderLines(lines),
    scheduledAt: scheduled ? values.scheduledAt : null,
    contact,
    paymentMethod: values.paymentMethod as PaymentMethod,
    invoice,
    needUtensils: values.needUtensils,
    marketingOptIn: values.marketingOptIn,
    expectedTotal,
  };

  if (orderType === 'DELIVERY') {
    const delivery: NonNullable<CreateOrderRequest['delivery']> = {
      city: values.deliveryCity,
      district: values.deliveryDistrict,
      zipCode: values.deliveryZip,
      line: values.deliveryLine.trim(),
    };
    if (values.addressId !== '') delivery.addressId = values.addressId;
    const note = values.deliveryNote.trim();
    if (note !== '') delivery.note = note;
    req.delivery = delivery;
  }

  if (orderType === 'DINE_IN') {
    const dineIn: NonNullable<CreateOrderRequest['dineIn']> = {
      tableNo: values.tableNo.trim().toUpperCase(),
    };
    if (qrToken !== undefined && qrToken !== '') dineIn.qrToken = qrToken;
    req.dineIn = dineIn;
  }

  if (values.couponCode !== '') req.couponCode = values.couponCode;
  const note = values.note.trim();
  if (note !== '') req.note = note;
  return req;
}
