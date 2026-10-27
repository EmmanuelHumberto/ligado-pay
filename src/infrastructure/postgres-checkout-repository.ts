import type { Pool } from 'pg';
import type { CheckoutRepository } from '../application/checkout-service.js';
import type { CheckoutLink, CheckoutObservation } from '../application/checkout-connector.js';
import type { Payment, Principal } from '../domain/payment.js';
import { PaymentError } from '../domain/payment.js';
import { PostgresRepository, toPayment, insertEvent } from './postgres-repository.js';
import type { PaymentRow } from './postgres-repository.js';

export class PostgresCheckoutRepository extends PostgresRepository implements CheckoutRepository {
  constructor(pool: Pool, account: string) { super(pool, { provider: 'infinitepay', environment: 'production', account }); }

  get operationalAccount() { return this.profile.account!; }

  private async withRefund(payment:Payment|null){
    if(!payment)return null;
    const total=Number((await this.pool.query('SELECT coalesce(sum(amount_cents),0)::text amount FROM bank_refund_reconciliations WHERE payment_id=$1',[payment.id])).rows[0].amount);
    return {...payment,refundedAmountCents:total};
  }
  override async find(principal:Principal,id:string){return this.withRefund(await super.find(principal,id));}
  override async findByReference(principal:Principal,receiverId:string,reference:string){return this.withRefund(await super.findByReference(principal,receiverId,reference));}
  async finishCheckout(id: string, result: CheckoutLink | null) {
    if (result && result.orderNsu !== id) throw new PaymentError(409, 'PROVIDER_REFERENCE_MISMATCH');
    return this.transaction(async client => {
      const updated = await client.query<PaymentRow>(`UPDATE payments SET state=$2,checkout_url=$3,
        provider_reference=$4,updated_at=clock_timestamp() WHERE id=$1 AND state='PROCESSING'
        AND provider='infinitepay' AND provider_account=$5 RETURNING *`,
      [id, result ? 'PENDING' : 'UNCERTAIN', result?.checkoutUrl ?? null, result?.orderNsu ?? null, this.profile.account]);
      const row = updated.rows[0];
      if (!row) throw new PaymentError(409, 'INVALID_TRANSITION');
      await insertEvent(client, row); return toPayment(row);
    });
  }

  async applyObservation(expected: Payment, observation: CheckoutObservation) {
    return this.transaction(async client => {
      const selected = await client.query<PaymentRow>(`SELECT * FROM payments WHERE id=$1 AND application_id=$2
        AND receiver_id=$3 AND environment='production' AND provider='infinitepay' AND provider_account=$4 FOR UPDATE`,
      [expected.id, expected.applicationId, expected.receiverId, this.profile.account]);
      const row = selected.rows[0];
      if (!row || observation.orderNsu !== row.id) throw new PaymentError(409, 'PROVIDER_REFERENCE_MISMATCH');
      // A divergent/card payment requires explicit operator resolution, never a later automatic approval.
      if (row.state === 'PAID_PIX' || row.state === 'REVIEW_REQUIRED' || observation.state === 'PENDING') return toPayment(row);
      if (observation.state === 'PAID_PIX') {
        if (observation.amountCents !== Number(row.amount_cents) || observation.paidAmountCents !== Number(row.amount_cents)) {
          throw new PaymentError(409, 'AMOUNT_MISMATCH');
        }
        await client.query(`INSERT INTO provider_settlements(provider,transaction_nsu,payment_id,amount_cents)
          VALUES('infinitepay',$1,$2,$3) ON CONFLICT DO NOTHING`,
        [observation.transactionNsu, row.id, row.amount_cents]);
        const claimed = await client.query<{ payment_id: string }>(`SELECT payment_id FROM provider_settlements
          WHERE provider='infinitepay' AND transaction_nsu=$1`, [observation.transactionNsu]);
        if (claimed.rows[0]?.payment_id !== row.id) throw new PaymentError(409, 'TRANSACTION_ALREADY_USED');
      }
      const updated = await client.query<PaymentRow>(`UPDATE payments SET state=$2,review_reason=$3,
        updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
      [row.id, observation.state, observation.state === 'REVIEW_REQUIRED' ? observation.reason : null]);
      const result = updated.rows[0]!;
      await insertEvent(client, result); return toPayment(result);
    });
  }
}
