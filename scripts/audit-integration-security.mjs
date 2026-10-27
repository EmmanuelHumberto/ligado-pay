// Non-destructive audit harness. Only disposable PostgreSQL + synthetic provider.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import pg from 'pg';
import {migrate} from '../dist/src/infrastructure/migrate.js';
import {PostgresCheckoutRepository} from '../dist/src/infrastructure/postgres-checkout-repository.js';
import {CheckoutService} from '../dist/src/application/checkout-service.js';
import {InfinitePayCheckout} from '../dist/src/infrastructure/infinitepay/checkout.js';
import {InfinitePayTransport} from '../dist/src/infrastructure/infinitepay/transport.js';
import {InfinitePayNotifications} from '../dist/src/infrastructure/infinitepay/notifications.js';
import {PaymentOperations} from '../dist/src/application/payment-operations.js';
import {createServer} from '../dist/src/http/server.js';
import {SimulatedProvider} from '../dist/src/infrastructure/simulated-provider.js';

const require=createRequire(import.meta.url);
const config=JSON.parse(await fs.readFile('.local/test-admin.json','utf8'));
const url=new URL(config.databaseUrl);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/ligado_pay_test');
const database='ligado_pay_audit_'+randomUUID().replaceAll('-','');
assert.match(database,/^ligado_pay_audit_[a-f0-9]{32}$/);
const admin=new pg.Pool({connectionString:url.href,max:1});
let pool,api,created=false;
const result={at:new Date().toISOString(),realProviderRequests:0,operationalDatabaseUsed:false,observations:{}};
try {
  await admin.query(`CREATE DATABASE "${database}"`);created=true;
  url.pathname='/'+database;pool=new pg.Pool({connectionString:url.href,max:5});await migrate(pool);
  const principal={applicationId:'audit-app',receiverIds:['audit-receiver'],
    permissions:['payments:read','payments:create','payments:check','payments:operations'],
    maxAmountCents:10000,requestsPerMinute:600};
  const repository=new PostgresCheckoutRepository(pool,'audit-merchant');
  let syntheticChecks=0;
  const connector=new InfinitePayCheckout({receiverId:'audit-receiver',handle:'audit-merchant',maxAmountCents:10000,
    redirectUrl:'https://portal.example.test/portal'},new InfinitePayTransport('SYNTHETIC-NOT-A-CREDENTIAL',async endpoint=>{
      if(endpoint.endsWith('/links'))return Response.json({checkout_url:'https://checkout.infinitepay.io/audit-merchant/correct_invoice'});
      syntheticChecks++;
      // The minimal documented response does not echo order/transaction/invoice identity.
      return Response.json({success:true,paid:true,amount:1500,paid_amount:1500,installments:1,capture_method:'pix'});
    }));
  const service=new CheckoutService(repository,connector,'audit-receiver',true);
  const input=()=>({receiverId:'audit-receiver',externalReference:randomUUID(),amountCents:1500,currency:'BRL',method:'pix'});
  const make=async(p=principal)=>(await service.create(p,input(),randomUUID())).payment;

  const correlation=await make();
  const unbound=await service.check(principal,correlation.id,
    {orderNsu:correlation.id,transactionNsu:randomUUID(),slug:'different_invoice'});
  assert.equal(unbound.state,'PAID_PIX');
  result.observations.invoiceBinding={differentSlugAccepted:true,providerIdentityEchoAbsent:true,
    resultingState:unbound.state,liveProviderCrossBindingTested:false};
  await assert.rejects(service.get({...principal,applicationId:'other-app'},correlation.id),{code:'PAYMENT_NOT_FOUND'});
  await assert.rejects(service.get({...principal,receiverIds:['other-receiver']},correlation.id),{code:'PAYMENT_NOT_FOUND'});
  result.observations.objectIsolation={otherApplicationDenied:true,otherReceiverDenied:true};

  const pending=await make();
  const notifications=new InfinitePayNotifications(pool,service,principal);
  for(let i=0;i<8;i++)await notifications.enqueue({orderNsu:pending.id,transactionNsu:randomUUID(),slug:'forged_invoice_'+i});
  const legitimate={orderNsu:pending.id,transactionNsu:randomUUID(),slug:'correct_invoice'};
  await assert.rejects(notifications.enqueue(legitimate),{code:'NOTIFICATION_QUEUE_LIMIT'});
  assert.equal((await service.get(principal,pending.id)).state,'PENDING');
  // Advance only this disposable fixture's failed-job state to model exhausted retries.
  for(let batch=1;batch<8;batch++){
    await pool.query("UPDATE checkout_notifications SET state='FAILED' WHERE payment_id=$1",[pending.id]);
    for(let i=0;i<8;i++)await notifications.enqueue({orderNsu:pending.id,transactionNsu:randomUUID(),slug:'forged_invoice_'+batch+'_'+i});
  }
  await pool.query("UPDATE checkout_notifications SET state='FAILED' WHERE payment_id=$1",[pending.id]);
  await assert.rejects(notifications.enqueue(legitimate),{code:'NOTIFICATION_QUEUE_LIMIT'});
  const operations=new PaymentOperations(pool,service);
  await assert.rejects(operations.retry(principal,pending.id,randomUUID(),legitimate),{code:'NOTIFICATION_QUEUE_LIMIT'});
  result.observations.queuePoisoning={eightForgedHintsBlockLegitimate:true,sixtyFourFailedHintsBlockNewHints:true,
    operatorCannotInsertNewCorrectHintAtLifetimeCap:true,paymentNotFalselyApproved:true};

  api=createServer(repository,new SimulatedProvider(),[],service,notifications,operations);
  for(let i=0;i<120;i++)assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',payload:{}})).statusCode,400);
  const afterFlood=await api.inject({method:'POST',url:'/webhooks/infinitepay',
    payload:{order_nsu:pending.id,transaction_nsu:randomUUID(),invoice_slug:'correct_invoice'}});
  assert.equal(afterFlood.statusCode,429);
  result.observations.sharedWebhookRateLimit={invalidRequests:120,nextLegitimateRequestStatus:429,
    scope:'Fastify inject, one loopback source; no live HTTP flood'};
  await api.close();api=undefined;

  await operations.notice(principal,correlation.id,'REFUND_NOTICE');
  assert.equal((await service.get(principal,correlation.id)).state,'PAID_PIX');
  result.observations.refundNotice={unverifiedNoticeCannotChangeFinancialState:true,
    automaticVerifiedRefundAccountingImplemented:false};

  const monitorPrincipal={...principal,applicationId:'audit-monitor-app'};
  for(let i=0;i<100;i++)await make(monitorPrincipal);
  const review=await make(monitorPrincipal);
  await repository.applyObservation(review,{orderNsu:review.id,transactionNsu:randomUUID(),state:'REVIEW_REQUIRED',reason:'AMOUNT_MISMATCH'});
  const report=await operations.report(monitorPrincipal);
  assert.equal(report.truncated,true);assert.equal(report.alerts.length,0);
  const monitor=require('../../os-system-web/scripts/operacao/ligado-pay.cjs').avaliar(report);
  assert.deepEqual(monitor.codes,[]);
  result.observations.monitorTruncation={record101NeedsReview:true,reportTruncated:true,monitorReturnedNoAlert:true};
  result.syntheticProviderChecks=syntheticChecks;
  await fs.mkdir('evidencias',{recursive:true});
  await fs.writeFile('evidencias/auditoria-integracao-2026-10-26.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {
  await api?.close();await pool?.end();
  if(created){assert.match(database,/^ligado_pay_audit_[a-f0-9]{32}$/);await admin.query(`DROP DATABASE "${database}"`);}
  await admin.end();
}
