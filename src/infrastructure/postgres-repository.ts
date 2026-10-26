import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PaymentRepository } from '../application/ports.js';
import type { CreatePayment, Payment, Principal, PaymentProfile } from '../domain/payment.js';
import { PaymentError } from '../domain/payment.js';

export interface PaymentRow {
  id: string; application_id: string; receiver_id: string; external_reference: string;
  amount_cents: string; state: Payment['state']; provider_reference: string | null;
  created_at: Date; request_hash: string;
  provider: PaymentProfile['provider']; environment: PaymentProfile['environment'];
  provider_account: string | null; checkout_url: string | null; checkout_expires_at: Date | null;
}
export function toPayment(row: PaymentRow): Payment {
  return { id: row.id, applicationId: row.application_id, receiverId: row.receiver_id,
    provider: row.provider, environment: row.environment, externalReference: row.external_reference, amountCents: Number(row.amount_cents),
    currency: 'BRL', state: row.state, providerReference: row.provider_reference, createdAt: row.created_at.toISOString(),
    checkout: row.checkout_expires_at ? { url: row.checkout_url, expiresAt: row.checkout_expires_at.toISOString(),
      exclusivePix: false, directQrAvailable: false } : null };
}
export async function insertEvent(client: PoolClient, row: PaymentRow) {
  const id = randomUUID();
  await client.query(`INSERT INTO payment_events(id,payment_id,application_id,receiver_id,environment,event_type)
    VALUES($1,$2,$3,$4,$5,$6)`, [id, row.id, row.application_id, row.receiver_id, row.environment, row.state]);
  await client.query('INSERT INTO outbox(event_id) VALUES($1)', [id]);
}

export class PostgresRepository implements PaymentRepository {
  constructor(protected readonly pool: Pool, protected readonly profile: PaymentProfile = {
    provider: 'simulated', environment: 'sandbox', account: null,
  }) {}
  protected async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async reserve(principal: Principal, input: CreatePayment, key: string) {
    const hash = createHash('sha256').update(JSON.stringify([
      input.receiverId, input.externalReference, input.amountCents, input.currency, input.method,
      ...(this.profile.provider === 'infinitepay' ? [this.profile.provider, this.profile.account] : []),
    ])).digest('hex');
    return this.transaction(async client => {
      // Serializes creation per application+receiver even across API instances.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [JSON.stringify([principal.applicationId, input.receiverId, this.profile.environment])]);
      const existing = await client.query<PaymentRow>(`SELECT * FROM payments
        WHERE application_id=$1 AND receiver_id=$2 AND environment=$4 AND idempotency_key=$3`,
      [principal.applicationId, input.receiverId, key, this.profile.environment]);
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== hash) throw new PaymentError(409, 'IDEMPOTENCY_CONFLICT');
        return { payment: toPayment(existing.rows[0]), created: false };
      }
      const reference = await client.query(`SELECT 1 FROM payments WHERE application_id=$1
        AND receiver_id=$2 AND environment=$4 AND external_reference=$3`,
      [principal.applicationId, input.receiverId, input.externalReference, this.profile.environment]);
      if (reference.rowCount) throw new PaymentError(409, 'REFERENCE_ALREADY_CHARGED');
      // The same lock protects the lifetime cap and idempotent replay across processes.
      // Count all states/providers: expiry, uncertainty or a restart never replenishes it.
      if (principal.maxPayments !== undefined) {
        if (!Number.isSafeInteger(principal.maxPayments) || principal.maxPayments < 1 || principal.maxPayments > 100000) {
          throw new PaymentError(403, 'INVALID_RESERVATION_LIMIT');
        }
        const reserved = await client.query<{count: string}>(`SELECT count(*)::text AS count FROM payments
          WHERE application_id=$1 AND receiver_id=$2 AND environment=$3`,
        [principal.applicationId, input.receiverId, this.profile.environment]);
        if (Number(reserved.rows[0]!.count) >= principal.maxPayments) {
          throw new PaymentError(409, 'RESERVATION_LIMIT_REACHED');
        }
      }
      const inserted = await client.query<PaymentRow>(`INSERT INTO payments
        (id,application_id,receiver_id,environment,external_reference,amount_cents,currency,method,
         provider,idempotency_key,request_hash,state,provider_account,checkout_expires_at)
        VALUES($1,$2,$3,$8,$4,$5,'BRL','pix',$9,$6,$7,'PROCESSING',$10,
          CASE WHEN $9='infinitepay' THEN clock_timestamp()+interval '1 hour' ELSE NULL END) RETURNING *`,
      [randomUUID(), principal.applicationId, input.receiverId, input.externalReference, input.amountCents, key, hash,
        this.profile.environment, this.profile.provider, this.profile.account]);
      const row = inserted.rows[0]!;
      await insertEvent(client, row);
      return { payment: toPayment(row), created: true };
    });
  }

  async find(principal: Principal, id: string) {
    const result = await this.pool.query<PaymentRow>(`SELECT * FROM payments WHERE id=$1 AND application_id=$2
      AND receiver_id=ANY($3::text[]) AND environment=$4 AND provider=$5
      AND provider_account IS NOT DISTINCT FROM $6`,
    [id, principal.applicationId, principal.receiverIds, this.profile.environment, this.profile.provider, this.profile.account]);
    return result.rows[0] ? toPayment(result.rows[0]) : null;
  }

  async findByReference(principal: Principal, receiverId: string, externalReference: string) {
    const result = await this.pool.query<PaymentRow>(`SELECT * FROM payments WHERE application_id=$1
      AND receiver_id=$2 AND receiver_id=ANY($3::text[]) AND external_reference=$4
      AND environment=$5 AND provider=$6 AND provider_account IS NOT DISTINCT FROM $7`,
    [principal.applicationId, receiverId, principal.receiverIds, externalReference,
      this.profile.environment, this.profile.provider, this.profile.account]);
    return result.rows[0] ? toPayment(result.rows[0]) : null;
  }

  async finish(id: string, state: 'PENDING' | 'UNCERTAIN', providerReference: string | null) {
    return this.transaction(async client => {
      const updated = await client.query<PaymentRow>(`UPDATE payments SET state=$2,provider_reference=$3,
        updated_at=clock_timestamp() WHERE id=$1 AND state='PROCESSING' AND provider=$4 AND environment=$5
        AND provider_account IS NOT DISTINCT FROM $6 RETURNING *`,
      [id, state, providerReference, this.profile.provider, this.profile.environment, this.profile.account]);
      const row = updated.rows[0];
      if (!row) throw new PaymentError(409, 'INVALID_TRANSITION');
      await insertEvent(client, row);
      return toPayment(row);
    });
  }

  async consumeRequest(principal: Principal) {
    const result = await this.pool.query<{ attempts: number }>(`INSERT INTO request_limits(application_id,window_start,attempts)
      VALUES($1,date_trunc('minute',clock_timestamp()),1) ON CONFLICT(application_id,window_start)
      DO UPDATE SET attempts=LEAST(request_limits.attempts+1,$2+1) RETURNING attempts`,
    [principal.applicationId, principal.requestsPerMinute]);
    return result.rows[0]!.attempts <= principal.requestsPerMinute;
  }

  async ready() {
    // Requires migrated tables, not just a reachable database.
    await this.pool.query('SELECT id,provider_account,checkout_url,checkout_expires_at FROM payments LIMIT 0');
    await this.pool.query('SELECT event_id FROM outbox LIMIT 0');
    await this.pool.query('SELECT payment_id FROM provider_settlements LIMIT 0');
  }
}
