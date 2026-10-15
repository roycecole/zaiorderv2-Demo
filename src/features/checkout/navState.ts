// src/features/checkout/navState.ts —— 結帳 / 付款頁導向時經 react-router `state` 傳遞的資訊（訂單頁、付款頁讀取）
//
// 追蹤權杖已先寫入 `useGuestOrdersStore`（訪客）；以下僅為補充，缺少時頁面仍須正常運作。
export interface OrderNavState {
  /** 剛由結帳成立（可顯示「訂單已送出」與保存訂單提示） */
  placed?: boolean;
  /**
   * 該筆 201 的 `order.customer.phone`：追蹤權杖被較晚簽發者取代（存取回 404）時，
   * 以 `orders.lookup(orderNo, phone)` 換取新權杖（BR-27、FLOW-16）；不另寫入 guestOrders。
   */
  phone?: string;
  /** 冪等重放取回（FLOW-24）：SAME 內容一致、DIFFERENT 內容與目前購物車不同（購物車保留）、CANCELLED 原訂單已取消 */
  replayed?: 'SAME' | 'DIFFERENT' | 'CANCELLED';
  /** 由付款頁導回：逾時取消 */
  paymentExpired?: boolean;
}

export interface PaymentNavState {
  /** 剛由結帳成立，付款頁不需再顯示「訂單已成立」 */
  placed?: boolean;
  phone?: string;
  replayed?: 'SAME' | 'DIFFERENT';
}
