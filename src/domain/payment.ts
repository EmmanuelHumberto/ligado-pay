export type PaymentState = 'PROCESSING' | 'PENDING' | 'UNCERTAIN';
export interface Payment {
  id: string;
  applicationId: string;
  receiverId: string;
  environment: 'sandbox';
  externalReference: string;
  amountCents: number;
  currency: 'BRL';
  state: PaymentState;
  providerReference: string | null;
  createdAt: string;
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
  permissions: readonly ('payments:create' | 'payments:read')[];
  maxAmountCents: number;
  requestsPerMinute: number;
}
export class PaymentError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}
