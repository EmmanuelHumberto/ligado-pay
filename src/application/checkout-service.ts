import { PaymentError } from '../domain/payment.js';
import type { CreatePayment, Payment, Principal } from '../domain/payment.js';
import type { PaymentRepository } from './ports.js';
import type { CheckoutConnector, CheckoutHints, CheckoutLink, CheckoutObservation } from './checkout-connector.js';

export interface CheckoutRepository extends PaymentRepository {
  finishCheckout(id: string, result: CheckoutLink | null): Promise<Payment>;
  applyObservation(payment: Payment, observation: CheckoutObservation): Promise<Payment>;
}

export class CheckoutService {
  constructor(private readonly repository: CheckoutRepository, private readonly connector: CheckoutConnector,
    private readonly receiverId: string, readonly creationEnabled = false) {}

  async create(principal: Principal, input: CreatePayment, key: string) {
    if (!principal.permissions.includes('payments:create') || !principal.receiverIds.includes(input.receiverId) ||
        input.receiverId !== this.receiverId) throw new PaymentError(403, 'OPERATION_NOT_ALLOWED');
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > principal.maxAmountCents) {
      throw new PaymentError(422, 'AMOUNT_NOT_ALLOWED');
    }
    if (!this.creationEnabled) throw new PaymentError(503, 'LIVE_CREATION_DISABLED');
    const reserved = await this.repository.reserve(principal, input, key);
    if (!reserved.created) return reserved;
    let link: CheckoutLink;
    try { link = await this.connector.createLink(this.intent(reserved.payment)); }
    catch { return { payment: await this.repository.finishCheckout(reserved.payment.id, null), created: true }; }
    return { payment: await this.repository.finishCheckout(reserved.payment.id, link), created: true };
  }

  async lookup(principal: Principal, receiverId: string, externalReference: string) {
    if (!principal.permissions.includes('payments:read') || !principal.receiverIds.includes(receiverId) ||
        receiverId !== this.receiverId) throw new PaymentError(403, 'OPERATION_NOT_ALLOWED');
    const payment = await this.repository.findByReference(principal, receiverId, externalReference);
    if (!payment) throw new PaymentError(404, 'PAYMENT_NOT_FOUND');
    return payment;
  }

  async get(principal: Principal, id: string) {
    if (!principal.permissions.includes('payments:read')) throw new PaymentError(403, 'OPERATION_NOT_ALLOWED');
    const payment = await this.repository.find(principal, id);
    if (!payment || payment.receiverId !== this.receiverId) throw new PaymentError(404, 'PAYMENT_NOT_FOUND');
    return payment;
  }

  async check(principal: Principal, id: string, hints: CheckoutHints) {
    if (!principal.permissions.includes('payments:check')) throw new PaymentError(403, 'OPERATION_NOT_ALLOWED');
    const payment = await this.get(principal, id);
    if (hints.orderNsu !== payment.id) throw new PaymentError(400, 'INVALID_CHECKOUT_HINTS');
    if (payment.state === 'PAID_PIX') return payment;
    const observation = await this.connector.checkPayment(this.intent(payment), hints);
    if (observation.orderNsu !== payment.id || observation.transactionNsu !== hints.transactionNsu) {
      throw new PaymentError(409, 'PROVIDER_REFERENCE_MISMATCH');
    }
    return this.repository.applyObservation(payment, observation);
  }

  private intent(payment: Payment) {
    if (!payment.checkout || payment.provider !== 'infinitepay') throw new PaymentError(409, 'INVALID_CHECKOUT_PAYMENT');
    return { paymentId: payment.id, receiverId: payment.receiverId, amountCents: payment.amountCents,
      expiresAt: payment.checkout.expiresAt };
  }
}
