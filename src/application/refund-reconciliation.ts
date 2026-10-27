import type {Pool} from 'pg';
import {PaymentError} from '../domain/payment.js';
export interface BankRefund {id:string;paymentId:string;transactionNsu:string;providerRefundReference:string;amountCents:number;occurredAt:string;evidenceSha256:string}
/** Privileged offline operator entry point. There is deliberately no HTTP route or money movement. */
export function validateBankRefund(input:BankRefund){
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 if(!uuid.test(input.id)||!uuid.test(input.paymentId)||!uuid.test(input.transactionNsu)||
  !/^[A-Za-z0-9_-]{8,128}$/.test(input.providerRefundReference)||!Number.isSafeInteger(input.amountCents)||input.amountCents<1||
  typeof input.occurredAt!=='string'||input.occurredAt.length>40||!Number.isFinite(Date.parse(input.occurredAt))||Date.parse(input.occurredAt)>Date.now()+60000||
  !/^[a-f0-9]{64}$/.test(input.evidenceSha256))throw new PaymentError(422,'INVALID_REFUND_RECONCILIATION');
}
export async function reconcileBankRefund(pool:Pool,input:BankRefund){
 validateBankRefund(input);
 const db=await pool.connect();try{
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['bank-refund:'+input.paymentId]);
  const prior=(await db.query('SELECT * FROM bank_refund_reconciliations WHERE id=$1 OR provider_refund_reference=$2',[input.id,input.providerRefundReference])).rows[0];
  if(prior){
   if(prior.id!==input.id||prior.payment_id!==input.paymentId||prior.transaction_nsu!==input.transactionNsu||
    prior.provider_refund_reference!==input.providerRefundReference||Number(prior.amount_cents)!==input.amountCents||
    new Date(prior.occurred_at).getTime()!==Date.parse(input.occurredAt)||prior.evidence_sha256!==input.evidenceSha256)
     throw new PaymentError(409,'IDEMPOTENCY_CONFLICT');
   await db.query('COMMIT');return {recorded:true,idempotentReplay:true,moneyMoved:false};
  }
  const payment=(await db.query(`SELECT p.amount_cents,p.created_at FROM payments p JOIN provider_settlements s ON s.payment_id=p.id
    WHERE p.id=$1 AND p.provider='infinitepay' AND p.environment='production' AND p.state='PAID_PIX'
    AND s.transaction_nsu=$2 AND s.amount_cents=p.amount_cents`,[input.paymentId,input.transactionNsu])).rows[0];
  if(!payment||Date.parse(input.occurredAt)<new Date(payment.created_at).getTime())throw new PaymentError(409,'REFUND_NOT_ALLOWED');
  const total=Number((await db.query('SELECT coalesce(sum(amount_cents),0)::text amount FROM bank_refund_reconciliations WHERE payment_id=$1',[input.paymentId])).rows[0].amount);
  if(total+input.amountCents>Number(payment.amount_cents))throw new PaymentError(409,'REFUND_AMOUNT_EXCEEDED');
  await db.query(`INSERT INTO bank_refund_reconciliations(id,payment_id,transaction_nsu,provider_refund_reference,amount_cents,occurred_at,evidence_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[input.id,input.paymentId,input.transactionNsu,input.providerRefundReference,input.amountCents,input.occurredAt,input.evidenceSha256]);
  await db.query('COMMIT');return {recorded:true,idempotentReplay:false,moneyMoved:false};
 }catch(e){await db.query('ROLLBACK').catch(()=>undefined);throw e;}finally{db.release();}
}
