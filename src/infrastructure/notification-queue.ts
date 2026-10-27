import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {CheckoutHints} from '../application/checkout-connector.js';

/** Caller holds notification:<payment> advisory lock. No financial/audit rows are removed. */
export async function queueNotification(db:PoolClient,paymentId:string,hints:CheckoutHints,trusted=false) {
  const duplicate=await db.query('SELECT id FROM checkout_notifications WHERE payment_id=$1 AND transaction_nsu=$2 AND invoice_slug=$3',
    [paymentId,hints.transactionNsu,hints.slug]);
  if(duplicate.rowCount){
    if(trusted)await db.query('UPDATE checkout_notifications SET trusted=true WHERE id=$1',[duplicate.rows[0].id]);
    return duplicate.rows[0].id as string;
  }
  const limit=trusted?8:4;
  const active=(await db.query('SELECT count(*)::int n FROM checkout_notifications WHERE payment_id=$1 AND state=\'PENDING\' AND trusted=$2',
    [paymentId,trusted])).rows[0].n;
  if(active>=limit){
    // A finite burst cannot permanently occupy the public queue. Active leases are fenced.
    const evicted=await db.query(`UPDATE checkout_notifications SET state='FAILED',lease_token=NULL,lease_until=NULL WHERE id IN (
      SELECT id FROM checkout_notifications WHERE payment_id=$1 AND state='PENDING' AND trusted=$2
        AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY created_at,id LIMIT 1
    ) RETURNING id`,[paymentId,trusted]);
    if(!evicted.rowCount)return null;
  }
  const id=randomUUID();
  await db.query('INSERT INTO checkout_notifications(id,payment_id,transaction_nsu,invoice_slug,trusted) VALUES($1,$2,$3,$4,$5)',
    [id,paymentId,hints.transactionNsu,hints.slug,trusted]);
  // Bounded, unverified transport history. Financial events and operator requests stay append-only.
  const total=(await db.query('SELECT count(*)::int n FROM checkout_notifications WHERE payment_id=$1',[paymentId])).rows[0].n;
  if(total>64)await db.query(`WITH removed AS (
    DELETE FROM checkout_notifications WHERE id IN (
      SELECT id FROM checkout_notifications WHERE payment_id=$1 AND state='FAILED'
      ORDER BY created_at,id LIMIT $2
    ) RETURNING id
  ) INSERT INTO notification_discard_counts(payment_id,discarded)
    SELECT $1,count(*) FROM removed HAVING count(*)>0
    ON CONFLICT(payment_id) DO UPDATE SET discarded=notification_discard_counts.discarded+EXCLUDED.discarded,updated_at=clock_timestamp()`,
    [paymentId,total-64]);
  return id;
}
