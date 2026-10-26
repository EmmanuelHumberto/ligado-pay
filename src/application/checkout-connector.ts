/** A reserved, durable gateway intent, not a browser-supplied commercial order. */
export interface CheckoutIntent {
  paymentId: string;
  receiverId: string;
  amountCents: number;
  expiresAt: string;
}

/** Hints from a redirect/webhook are untrusted until verified with the provider. */
export interface CheckoutHints {
  orderNsu: string;
  transactionNsu: string;
  slug: string;
}

export interface CheckoutLink {
  orderNsu: string;
  checkoutUrl: string;
  expiresAt: string;
  exclusivePix: false;
  directQrAvailable: false;
}

export type CheckoutObservation =
  | { state: 'PENDING'; orderNsu: string; transactionNsu: string }
  | { state: 'PAID_PIX'; orderNsu: string; transactionNsu: string; amountCents: number; paidAmountCents: number }
  | { state: 'REVIEW_REQUIRED'; orderNsu: string; transactionNsu: string;
      reason: 'METHOD_NOT_PIX' | 'AMOUNT_MISMATCH' | 'UNSUPPORTED_RESULT' };

export interface CheckoutConnector {
  createLink(intent: CheckoutIntent): Promise<CheckoutLink>;
  checkPayment(intent: CheckoutIntent, hints: CheckoutHints): Promise<CheckoutObservation>;
}

export type CheckoutErrorCode = 'INVALID_CHECKOUT_INTENT' | 'RECEIVER_NOT_ALLOWED' |
  'INVALID_CHECKOUT_HINTS' | 'UNSAFE_PROVIDER_RESPONSE' | 'PROVIDER_UNAVAILABLE' | 'CREATE_RESULT_UNCERTAIN';

export class CheckoutError extends Error {
  constructor(public readonly code: CheckoutErrorCode) { super(code); }
}
