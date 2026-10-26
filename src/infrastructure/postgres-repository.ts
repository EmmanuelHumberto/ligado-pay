import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PaymentRepository } from '../application/ports.js';
import type { CreatePayment, Payment, Principal } from '../domain/payment.js';
import { PaymentError } from '../domain/payment.js';

interface PaymentRow {
  id: string; application_id: string; receiver_id: string; external_reference: string;
  amount_cents: string; state: Payment['state']; provider_reference: string | null;
  created_at: Date; request_hash: string;
}
function payment(row: PaymentRow): Payment {
  return { id: row.id, applicationId: row.application_id, receiverId: row.receiver_id,
    environment: 'sandbox', externalReference: row.external_reference, amountCents: Number(row.amount_cents),
    currency: 'BRL', state: row.state, providerReference: row.provider_reference, createdAt: row.created_at.toISOString() };
}
async function event(client: PoolClient, row: PaymentRow) {
  const id = randomUUID();
  await client.query(`INSERT INTO payment_events(id,payment_id,application_id,receiver_id,environment,event_type)
    VALUES($1,$2,$3,$4,'sandbox',$5)`, [id, row.id, row.application_id, row.receiver_id, row.state]);
  await client.query('INSERT INTO outbox(event_id) VALUES($1)', [id]);
}

export class PostgresRepository implements PaymentRepository {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
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
    ])).digest('hex');
    return this.transaction(async client => {
      // Serializes creation per application+receiver even across API instances.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [JSON.stringify([principal.applicationId, input.receiverId, 'sandbox'])]);
      const existing = await client.query<PaymentRow>(`SELECT * FROM payments
        WHERE application_id=$1 AND receiver_id=$2 AND environment='sandbox' AND idempotency_key=$3`,
      [principal.applicationId, input.receiverId, key]);
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== hash) throw new PaymentError(409, 'IDEMPOTENCY_CONFLICT');
        return { payment: payment(existing.rows[0]), created: false };
      }
      const reference = await client.query(`SELECT 1 FROM payments WHERE application_id=$1
        AND receiver_id=$2 AND environment='sandbox' AND external_reference=$3`,
      [principal.applicationId, input.receiverId, input.externalReference]);
      if (reference.rowCount) throw new PaymentError(409, 'REFERENCE_ALREADY_CHARGED');
      const inserted = await client.query<PaymentRow>(`INSERT INTO payments
        (id,application_id,receiver_id,environment,external_reference,amount_cents,currency,method,
         provider,idempotency_key,request_hash,state)
        VALUES($1,$2,$3,'sandbox',$4,$5,'BRL','pix','simulated',$6,$7,'PROCESSING') RETURNING *`,
      [randomUUID(), principal.applicationId, input.receiverId, input.externalReference, input.amountCents, key, hash]);
      const row = inserted.rows[0]!;
      await event(client, row);
      return { payment: payment(row), created: true };
    });
  }

  async find(principal: Principal, id: string) {
    const result = await this.pool.query<PaymentRow>(`SELECT * FROM payments WHERE id=$1 AND application_id=$2
      AND receiver_id=ANY($3::text[]) AND environment='sandbox'`, [id, principal.applicationId, principal.receiverIds]);
    return result.rows[0] ? payment(result.rows[0]) : null;
  }

  async finish(id: string, state: 'PENDING' | 'UNCERTAIN', providerReference: string | null) {
    return this.transaction(async client => {
      const updated = await client.query<PaymentRow>(`UPDATE payments SET state=$2,provider_reference=$3,
        updated_at=clock_timestamp() WHERE id=$1 AND state='PROCESSING' RETURNING *`, [id, state, providerReference]);
      const row = updated.rows[0];
      if (!row) throw new PaymentError(409, 'INVALID_TRANSITION');
      await event(client, row);
      return payment(row);
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
    await this.pool.query('SELECT id FROM payments LIMIT 0');
    await this.pool.query('SELECT event_id FROM outbox LIMIT 0');
  }
}
