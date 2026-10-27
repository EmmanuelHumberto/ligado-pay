import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import type {Principal} from '../../domain/payment.js';
import {PaymentError} from '../../domain/payment.js';
import type {CheckoutService} from '../../application/checkout-service.js';
import type {CheckoutHints} from '../../application/checkout-connector.js';
import type {PaymentOperations} from '../../application/payment-operations.js';
import {queueNotification} from '../notification-queue.js';

export const notificationPath='/webhooks/infinitepay';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function notificationHints(value:unknown):CheckoutHints {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new PaymentError(400,'INVALID_NOTIFICATION');
  const body=value as Record<string,unknown>;
  const slug=body['invoice_slug']??body['slug'];
  if(typeof body['order_nsu']!=='string'||!uuid.test(body['order_nsu'])||
    typeof body['transaction_nsu']!=='string'||!uuid.test(body['transaction_nsu'])||
    typeof slug!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(slug)||
    (body['invoice_slug']!==undefined&&body['slug']!==undefined&&body['invoice_slug']!==body['slug'])) {
    throw new PaymentError(400,'INVALID_NOTIFICATION');
  }
  // Amount, paid claims, receipts, items, payer identity and URLs are discarded.
  return {orderNsu:body['order_nsu'],transactionNsu:body['transaction_nsu'],slug};
}

/** Public notification is only a wake-up hint. Financial truth comes from authenticated /payment_check. */
export class InfinitePayNotifications {
  private timer:ReturnType<typeof setInterval>|undefined;
  private active:Promise<void>|undefined;
  constructor(private readonly pool:Pool,private readonly service:CheckoutService,private readonly principal:Principal) {
    if(!principal.permissions.includes('payments:read')||!principal.permissions.includes('payments:check')||
      principal.receiverIds.length!==1)throw new Error('Notification identity must be explicitly scoped.');
  }

  async enqueue(hints:CheckoutHints,trusted=false) {
    let payment;
    try{payment=await this.service.get(this.principal,hints.orderNsu);}
    catch(error){if(error instanceof PaymentError&&error.code==='PAYMENT_NOT_FOUND')return;throw error;}
    if(payment.state==='PAID_PIX'||payment.state==='REVIEW_REQUIRED')return;
    this.service.validateInvoice(payment,hints);
    const db=await this.pool.connect();
    try{
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['notification:'+payment.id]);
      const queued=await queueNotification(db,payment.id,hints,trusted);
      if(!queued)throw new PaymentError(503,'NOTIFICATION_RETRY_LATER');
      await db.query('COMMIT');
    }catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
  }
  async notice(operations:PaymentOperations,id:string,kind:'REFUND_NOTICE'|'CANCEL_NOTICE'){
    await operations.notice(this.principal,id,kind);
  }

  async tick() {
    await this.pool.query(`UPDATE checkout_notifications n SET state='FAILED',lease_token=NULL,lease_until=NULL
      FROM payments p WHERE p.id=n.payment_id AND p.application_id=$1 AND p.receiver_id=$2
        AND p.provider_account=$3 AND n.state='PENDING' AND n.attempts>=8 AND (n.lease_until IS NULL OR n.lease_until<clock_timestamp())`,
    [this.principal.applicationId,this.principal.receiverIds[0],this.service.operationalAccount]);
    const lease=randomUUID();
    const selected=await this.pool.query<{id:string;payment_id:string;transaction_nsu:string;invoice_slug:string;attempts:number}>(`
      WITH due AS (SELECT n.id FROM checkout_notifications n JOIN payments p ON p.id=n.payment_id
        WHERE n.state='PENDING' AND n.attempts<8 AND n.next_check_at<=clock_timestamp()
          AND (n.lease_until IS NULL OR n.lease_until<clock_timestamp())
          AND p.application_id=$1 AND p.receiver_id=$2 AND p.provider_account=$3 AND p.provider='infinitepay' AND p.environment='production'
        ORDER BY n.trusted DESC,n.next_check_at,n.id FOR UPDATE OF n SKIP LOCKED LIMIT 1)
      UPDATE checkout_notifications n SET lease_token=$4,lease_until=clock_timestamp()+interval '30 seconds',
        attempts=attempts+1 FROM due WHERE n.id=due.id RETURNING n.*`,
    [this.principal.applicationId,this.principal.receiverIds[0],this.service.operationalAccount,lease]);
    const job=selected.rows[0];if(!job)return;
    let done=false;
    try{
      const payment=await this.service.check(this.principal,job.payment_id,
        {orderNsu:job.payment_id,transactionNsu:job.transaction_nsu,slug:job.invoice_slug});
      done=payment.state==='PAID_PIX'||payment.state==='REVIEW_REQUIRED';
    }catch{/* Keep uncertainty and retry; never create, refund, or assume a failed payment. */}
    await this.pool.query(`UPDATE checkout_notifications SET state=$3,lease_until=NULL,lease_token=NULL,
      next_check_at=clock_timestamp()+($4::int*interval '1 second') WHERE id=$1 AND lease_token=$2`,
    [job.id,lease,done?'DONE':job.attempts>=8?'FAILED':'PENDING',Math.min(1800,15*2**job.attempts)]);
  }
  start() {
    if(this.timer)return;
    this.timer=setInterval(()=>{if(this.active)return;this.active=this.tick().catch(()=>{
      console.error('Payment notification processing unavailable.');
    }).finally(()=>{this.active=undefined;});},2000);this.timer.unref();
  }
  async stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;await this.active;}
}
