import { CheckoutError } from '../../application/checkout-connector.js';
import type { CheckoutConnector, CheckoutHints, CheckoutIntent, CheckoutLink, CheckoutObservation } from '../../application/checkout-connector.js';
import { InfinitePayTransport } from './transport.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const token = /^[A-Za-z0-9_-]{1,128}$/;
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CheckoutError('UNSAFE_PROVIDER_RESPONSE');
  return value as Record<string, unknown>;
}

export interface InfinitePayAccount {
  receiverId: string;
  handle: string;
  maxAmountCents: number;
  redirectUrl: string;
}

export class InfinitePayCheckout implements CheckoutConnector {
  private readonly account: Readonly<InfinitePayAccount>;
  private readonly now: () => number;
  constructor(account: InfinitePayAccount, private readonly transport: InfinitePayTransport, now = Date.now) {
    let redirect: URL;
    try { redirect = new URL(account.redirectUrl); } catch { throw new Error('Invalid InfinitePay account configuration.'); }
    if (!/^[a-z][a-z0-9_-]{2,63}$/.test(account.receiverId) || !/^[A-Za-z0-9_-]{3,80}$/.test(account.handle) ||
        !Number.isSafeInteger(account.maxAmountCents) || account.maxAmountCents < 1 || account.maxAmountCents > 100_000_000 ||
        redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.port || redirect.search || redirect.hash ||
        redirect.hostname === 'localhost' || redirect.hostname.endsWith('.localhost') || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(redirect.hostname)) {
      throw new Error('Invalid InfinitePay account configuration.');
    }
    this.account = Object.freeze({ ...account }); this.now = now;
  }

  private validate(intent: CheckoutIntent) {
    if (intent.receiverId !== this.account.receiverId) throw new CheckoutError('RECEIVER_NOT_ALLOWED');
    if (!uuid.test(intent.paymentId) || !amount(intent.amountCents) || intent.amountCents < 1 ||
        intent.amountCents > this.account.maxAmountCents || !Number.isFinite(Date.parse(intent.expiresAt))) {
      throw new CheckoutError('INVALID_CHECKOUT_INTENT');
    }
  }

  async createLink(intent: CheckoutIntent): Promise<CheckoutLink> {
    this.validate(intent);
    const expires = Date.parse(intent.expiresAt);
    if (expires <= this.now() || expires > this.now() + 24 * 60 * 60 * 1000) throw new CheckoutError('INVALID_CHECKOUT_INTENT');
    const response = await this.transport.post('create-link', {
      order_nsu: intent.paymentId,
      redirect_url: this.account.redirectUrl,
      items: [{ quantity: 1, price: intent.amountCents, description: 'Pagamento Ligado' }],
      options: { single_payment: true, valid_until: new Date(expires).toISOString(),
        // The provider explicitly keeps credit_card available. Do not promise a Pix-only link.
        payment_methods_enabled: ['pix', 'credit_card'], require_delivery_address: false },
    });
    let url: URL;
    try {
      const raw = record(response);
      // Candidate response shapes, awaiting live contract confirmation. Conflicting aliases are refused.
      const candidates = ['url', 'checkout_url', 'link'].filter(key => raw[key] !== undefined).map(key => raw[key]);
      if (!candidates.length || candidates.some(value => typeof value !== 'string' || value.length > 2048) ||
          new Set(candidates).size !== 1) throw new Error();
      if (raw['order_nsu'] !== undefined && raw['order_nsu'] !== intent.paymentId) throw new Error();
      url = new URL(candidates[0] as string);
    } catch { throw new CheckoutError('CREATE_RESULT_UNCERTAIN'); }
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.infinitepay.io' || url.port || url.username || url.password ||
        url.hash || url.search || !/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
        url.pathname.split('/')[1] !== this.account.handle) {
      // A link might already exist. An unexpected response is not permission to create another.
      throw new CheckoutError('CREATE_RESULT_UNCERTAIN');
    }
    return { orderNsu: intent.paymentId, checkoutUrl: url.href, expiresAt: new Date(expires).toISOString(),
      exclusivePix: false, directQrAvailable: false };
  }

  async checkPayment(intent: CheckoutIntent, hints: CheckoutHints): Promise<CheckoutObservation> {
    this.validate(intent);
    // Do not enforce current expiration here: an on-time payment can be confirmed late.
    if (hints.orderNsu !== intent.paymentId || !uuid.test(hints.transactionNsu) || !token.test(hints.slug)) {
      throw new CheckoutError('INVALID_CHECKOUT_HINTS');
    }
    const raw = record(await this.transport.post('check-payment', {
      handle: this.account.handle, order_nsu: intent.paymentId,
      transaction_nsu: hints.transactionNsu, slug: hints.slug,
    }));
    const identity = { orderNsu: intent.paymentId, transactionNsu: hints.transactionNsu };
    for (const [key, expected] of Object.entries({ order_nsu: intent.paymentId,
      transaction_nsu: hints.transactionNsu, handle: this.account.handle, slug: hints.slug })) {
      if (raw[key] !== undefined && raw[key] !== expected) throw new CheckoutError('UNSAFE_PROVIDER_RESPONSE');
    }
    if (raw['currency'] !== undefined && raw['currency'] !== 'BRL') throw new CheckoutError('UNSAFE_PROVIDER_RESPONSE');
    if (raw['success'] !== true || typeof raw['paid'] !== 'boolean') {
      throw new CheckoutError('UNSAFE_PROVIDER_RESPONSE');
    }
    if (!raw['paid']) return { ...identity, state: 'PENDING' };
    if (raw['capture_method'] !== 'pix') return { ...identity, state: 'REVIEW_REQUIRED', reason: 'METHOD_NOT_PIX' };
    if (!amount(raw['amount']) || !amount(raw['paid_amount']) || raw['amount'] !== intent.amountCents ||
        raw['paid_amount'] !== intent.amountCents) {
      return { ...identity, state: 'REVIEW_REQUIRED', reason: 'AMOUNT_MISMATCH' };
    }
    if (raw['installments'] !== 1) return { ...identity, state: 'REVIEW_REQUIRED', reason: 'UNSUPPORTED_RESULT' };
    return { ...identity, state: 'PAID_PIX', amountCents: raw['amount'], paidAmountCents: raw['paid_amount'] };
  }
}
