export type PaymentState = 'PROCESSING' | 'PENDING' | 'UNCERTAIN' | 'PAID_PIX' | 'REVIEW_REQUIRED';
export interface PaymentProfile {
  provider: 'simulated' | 'infinitepay';
  environment: 'sandbox' | 'production';
  account: string | null;
}
export interface Payment {
  id: string;
  applicationId: string;
  receiverId: string;
  environment: PaymentProfile['environment'];
  provider: PaymentProfile['provider'];
  externalReference: string;
  amountCents: number;
  currency: 'BRL';
  state: PaymentState;
  providerReference: string | null;
  createdAt: string;
  checkout: { url: string | null; expiresAt: string; exclusivePix: false; directQrAvailable: false } | null;
}
export interface CreatePayment {
  receiverId: string;
  externalReference: string;
  amountCents: number;
  currency: 'BRL';
  method: 'pix';
}
export interface Principal {
  applicationId: string;
  receiverIds: readonly string[];
  permissions: readonly ('payments:create' | 'payments:read' | 'payments:check' | 'payments:operations')[];
  maxAmountCents: number;
  requestsPerMinute: number;
  /** Optional lifetime reservation cap per application/receiver/environment, including uncertain outcomes. */
  maxPayments?: number;
}
export class PaymentError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}
