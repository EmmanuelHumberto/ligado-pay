import { PaymentError } from '../domain/payment.js';
import type { CreatePayment, Principal } from '../domain/payment.js';
import type { PaymentProvider, PaymentRepository } from './ports.js';

export class PaymentService {
  constructor(private readonly repository: PaymentRepository, private readonly provider: PaymentProvider) {}

  async create(principal: Principal, input: CreatePayment, key: string) {
    if (!principal.permissions.includes('payments:create') || !principal.receiverIds.includes(input.receiverId)) {
      throw new PaymentError(403, 'OPERATION_NOT_ALLOWED');
    }
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > principal.maxAmountCents) {
      throw new PaymentError(422, 'AMOUNT_NOT_ALLOWED');
    }
    const reserved = await this.repository.reserve(principal, input, key);
    if (!reserved.created) return reserved;
    // Durable intent precedes the external call. Replays never call the provider again.
    let reference: string;
    try {
      ({ reference } = await this.provider.create({ payment: reserved.payment, idempotencyKey: reserved.payment.id }));
    } catch {
      return { payment: await this.repository.finish(reserved.payment.id, 'UNCERTAIN', null), created: true };
    }
    // A database failure after provider acceptance leaves PROCESSING for reconciliation.
    return { payment: await this.repository.finish(reserved.payment.id, 'PENDING', reference), created: true };
  }

  async get(principal: Principal, id: string) {
    if (!principal.permissions.includes('payments:read')) throw new PaymentError(403, 'OPERATION_NOT_ALLOWED');
    const payment = await this.repository.find(principal, id);
    if (!payment) throw new PaymentError(404, 'PAYMENT_NOT_FOUND');
    return payment;
  }
}
