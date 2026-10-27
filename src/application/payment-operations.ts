import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {Principal} from '../domain/payment.js';
import {PaymentError} from '../domain/payment.js';
import type {CheckoutService} from './checkout-service.js';
import type {CheckoutHints} from './checkout-connector.js';
import {queueNotification} from '../infrastructure/notification-queue.js';

export type OperationInput={kind:'REFUND_REQUEST'|'CANCEL_REQUEST'|'EVIDENCE_RECORDED';reasonCode:string;amountCents?:number;evidenceSha256?:string};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class PaymentOperations {
 constructor(private readonly pool:Pool,private readonly checkout:CheckoutService){}
 private requireOperator(p:Principal){if(!p.permissions.includes('payments:operations'))throw new PaymentError(403,'OPERATION_NOT_ALLOWED');}
 private async transaction<T>(fn:(db:PoolClient)=>Promise<T>){const db=await this.pool.connect();try{await db.query('BEGIN');const r=await fn(db);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK').catch(()=>undefined);throw e;}finally{db.release();}}
 async report(p:Principal,id?:string){
  if(!p.permissions.includes('payments:read'))throw new PaymentError(403,'OPERATION_NOT_ALLOWED');
  if(id)await this.checkout.get(p,id);
  const result=(await this.pool.query(`WITH scoped AS (
    SELECT p.*,
      EXISTS(SELECT 1 FROM checkout_notifications n WHERE n.payment_id=p.id AND n.state='FAILED') failed_checks,
      EXISTS(SELECT 1 FROM checkout_notifications n WHERE n.payment_id=p.id) known_hints,
      EXISTS(SELECT 1 FROM payment_operations o WHERE o.payment_id=p.id
        AND o.kind IN ('REFUND_REQUEST','CANCEL_REQUEST','REFUND_NOTICE','CANCEL_NOTICE','EVIDENCE_RECORDED')
        AND NOT EXISTS(SELECT 1 FROM operation_resolutions r WHERE r.operation_id=o.id)) operator_actions
    FROM payments p WHERE application_id=$1 AND receiver_id=ANY($2::text[])
      AND provider='infinitepay' AND environment='production' AND provider_account=$4
      AND ($3::uuid IS NULL OR p.id=$3)
  ), classified AS (
    SELECT id,state,amount_cents,created_at,
      coalesce(checkout_expires_at<=clock_timestamp(),false) expired,
      array_remove(ARRAY[
        CASE WHEN state IN ('PROCESSING','UNCERTAIN') AND created_at<now()-interval '5 minutes' THEN 'CREATION_UNCERTAIN' END,
        CASE WHEN state='REVIEW_REQUIRED' THEN 'FINANCIAL_REVIEW_REQUIRED' END,
        CASE WHEN state NOT IN ('PAID_PIX','REVIEW_REQUIRED') AND failed_checks THEN 'CHECK_RETRIES_EXHAUSTED' END,
        CASE WHEN state NOT IN ('PAID_PIX','REVIEW_REQUIRED') AND NOT known_hints AND created_at<now()-interval '15 minutes' THEN 'MISSING_PROVIDER_CORRELATION' END,
        CASE WHEN state NOT IN ('PAID_PIX','REVIEW_REQUIRED') AND checkout_expires_at<=now() THEN 'EXPIRED_UNCONFIRMED' END,
        CASE WHEN operator_actions THEN 'OPERATOR_REVIEW_PENDING' END
      ],NULL) alerts FROM scoped
  ), actionable AS (SELECT * FROM classified WHERE $3::uuid IS NOT NULL OR cardinality(alerts)>0),
  details AS (SELECT * FROM actionable ORDER BY (state='REVIEW_REQUIRED') DESC,created_at DESC,id LIMIT 100)
  SELECT (SELECT count(*)::int FROM actionable) total,
    coalesce((SELECT json_agg(d) FROM details d),'[]') details,
    coalesce((SELECT json_agg(code) FROM (SELECT DISTINCT unnest(alerts) code FROM actionable) c),'[]') codes`,
    [p.applicationId,p.receiverIds,id??null,this.checkout.operationalAccount??null])).rows[0];
  const visible=result.details.map((row:{id:string;state:string;amount_cents:string;alerts:string[];expired:boolean})=>({
    paymentId:row.id,state:row.state,amountCents:Number(row.amount_cents),alerts:row.alerts,checkoutExpired:row.expired,
    nextAction:row.alerts.includes('MISSING_PROVIDER_CORRELATION')?'OBTAIN_CHECKOUT_TRANSACTION_AND_INVOICE':row.alerts.length?'RECONCILE_EXISTING_PAYMENT':'NONE'}));
  const requests=id?(await this.pool.query(`SELECT id,kind,amount_cents,reason_code,evidence_sha256,created_at
    FROM payment_operations o WHERE application_id=$1 AND payment_id=$2
    ORDER BY EXISTS(SELECT 1 FROM operation_resolutions r WHERE r.operation_id=o.id),created_at DESC LIMIT 100`,[p.applicationId,id])).rows:[];
  return {capabilities:{automaticRefund:false,automaticCancellation:false,lookupWithoutProviderHints:false},alerts:visible,requests,truncated:result.total>100,summary:{complete:true,total:result.total,codes:result.codes},
    notice:'Expiry, a request or evidence never proves a cancellation/refund. Provider action and reconciliation are required.'};
 }
 async resolve(p:Principal,id:string,operationId:string,reasonCode:string,evidenceSha256:string){
  this.requireOperator(p);await this.checkout.get(p,id);
  if(!/^[A-Z_]{3,64}$/.test(reasonCode)||!/^[a-f0-9]{64}$/.test(evidenceSha256))throw new PaymentError(422,'INVALID_OPERATION');
  const r=await this.pool.query(`INSERT INTO operation_resolutions(operation_id,application_id,reason_code,evidence_sha256)
    SELECT id,$2,$4,$5 FROM payment_operations WHERE id=$3 AND payment_id=$1 AND application_id=$2
    ON CONFLICT(operation_id) DO NOTHING RETURNING operation_id`,[id,p.applicationId,operationId,reasonCode,evidenceSha256]);
  if(!r.rowCount){
    const prior=(await this.pool.query('SELECT reason_code,evidence_sha256 FROM operation_resolutions WHERE operation_id=$1 AND application_id=$2',[operationId,p.applicationId])).rows[0];
    if(!prior)throw new PaymentError(404,'OPERATION_NOT_FOUND');
    if(prior.reason_code!==reasonCode||prior.evidence_sha256!==evidenceSha256)throw new PaymentError(409,'IDEMPOTENCY_CONFLICT');
  }
  return {resolved:true,financialStateChanged:false};
 }
 async request(p:Principal,id:string,key:string,input:OperationInput){
  if(!['REFUND_REQUEST','CANCEL_REQUEST','EVIDENCE_RECORDED'].includes(input.kind)||!/^[A-Z_]{3,64}$/.test(input.reasonCode)||
    (input.evidenceSha256!==undefined&&!/^[a-f0-9]{64}$/.test(input.evidenceSha256)))throw new PaymentError(422,'INVALID_OPERATION');
  this.requireOperator(p);const payment=await this.checkout.get(p,id);
  if(input.kind==='REFUND_REQUEST'&&(payment.state!=='PAID_PIX'||!Number.isSafeInteger(input.amountCents)||input.amountCents!<1||input.amountCents!>payment.amountCents))throw new PaymentError(409,'REFUND_NOT_ALLOWED');
  if(input.kind==='CANCEL_REQUEST'&&payment.state==='PAID_PIX')throw new PaymentError(409,'USE_REFUND_REQUEST');
  if(input.kind!=='REFUND_REQUEST'&&input.amountCents!==undefined)throw new PaymentError(422,'AMOUNT_NOT_ALLOWED');
  if(input.kind==='EVIDENCE_RECORDED'&&!input.evidenceSha256)throw new PaymentError(422,'EVIDENCE_HASH_REQUIRED');
  return this.transaction(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payment-operation:'+id]);
   const digest=hash([input.kind,input.reasonCode,input.amountCents??null,input.evidenceSha256??null]);
   const previous=(await db.query('SELECT id,request_hash FROM payment_operations WHERE application_id=$1 AND payment_id=$2 AND idempotency_key=$3',[p.applicationId,id,key])).rows[0];
   if(previous){if(previous.request_hash!==digest)throw new PaymentError(409,'IDEMPOTENCY_CONFLICT');return {id:previous.id,status:'NEEDS_PROVIDER_ACTION',financialStateChanged:false};}
   if(input.kind==='REFUND_REQUEST'){
    const sum=(await db.query("SELECT coalesce(sum(amount_cents),0)::text amount FROM payment_operations WHERE payment_id=$1 AND kind='REFUND_REQUEST'",[id])).rows[0];
    if(Number(sum.amount)+input.amountCents!>payment.amountCents)throw new PaymentError(409,'REFUND_AMOUNT_ALREADY_RESERVED');
   }
   const op=randomUUID();await db.query(`INSERT INTO payment_operations(id,payment_id,application_id,kind,amount_cents,reason_code,evidence_sha256,idempotency_key,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[op,id,p.applicationId,input.kind,input.amountCents??null,input.reasonCode,input.evidenceSha256??null,key,digest]);
   return {id:op,status:'NEEDS_PROVIDER_ACTION',financialStateChanged:false};
  });
 }
 async retry(p:Principal,id:string,key:string,hints:CheckoutHints){
  this.requireOperator(p);const payment=await this.checkout.get(p,id);
  if(hints.orderNsu!==id)throw new PaymentError(400,'INVALID_CHECKOUT_HINTS');
  this.checkout.validateInvoice(payment,hints);
  if(payment.state==='PAID_PIX'||payment.state==='REVIEW_REQUIRED')return {queued:false,state:payment.state};
  return this.transaction(async db=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['notification:'+id]);
   const digest=hash(hints),previous=(await db.query('SELECT request_hash FROM payment_operations WHERE application_id=$1 AND payment_id=$2 AND idempotency_key=$3',[p.applicationId,id,key])).rows[0];
   if(previous){if(previous.request_hash!==digest)throw new PaymentError(409,'IDEMPOTENCY_CONFLICT');return {queued:false,idempotentReplay:true};}
   const queued=await queueNotification(db,id,hints,true);
   if(!queued)throw new PaymentError(409,'RECONCILIATION_IN_PROGRESS');
   const n=await db.query(`INSERT INTO checkout_notifications(id,payment_id,transaction_nsu,invoice_slug)
    VALUES($1,$2,$3,$4) ON CONFLICT(payment_id,transaction_nsu,invoice_slug) DO UPDATE
    SET state='PENDING',trusted=true,attempts=0,next_check_at=clock_timestamp(),lease_token=NULL,lease_until=NULL
    WHERE checkout_notifications.lease_until IS NULL OR checkout_notifications.lease_until<clock_timestamp() RETURNING id`,[randomUUID(),id,hints.transactionNsu,hints.slug]);
   if(!n.rowCount)throw new PaymentError(409,'RECONCILIATION_IN_PROGRESS');
   await db.query(`INSERT INTO payment_operations(id,payment_id,application_id,kind,reason_code,idempotency_key,request_hash)
    VALUES($1,$2,$3,'RETRY_REQUEST','OPERATOR_RECHECK',$4,$5)`,[randomUUID(),id,p.applicationId,key,digest]);
   return {queued:true,financialStateChanged:false};
  });
 }
 async notice(p:Principal,id:string,kind:'REFUND_NOTICE'|'CANCEL_NOTICE'){
  try{await this.checkout.get(p,id);}catch(e){if(e instanceof PaymentError&&e.status===404)return;throw e;}
  const key=hash([id,kind]);await this.pool.query(`INSERT INTO payment_operations(id,payment_id,application_id,kind,reason_code,idempotency_key,request_hash)
    VALUES($1,$2,$3,$4,'UNVERIFIED_PROVIDER_NOTICE',$5,$5) ON CONFLICT DO NOTHING`,[randomUUID(),id,p.applicationId,kind,key]);
 }
}
