// Non-destructive audit harness. Only disposable PostgreSQL + synthetic provider.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash,createHmac} from 'node:crypto';
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
  await assert.rejects(service.check(principal,correlation.id,
    {orderNsu:correlation.id,transactionNsu:randomUUID(),slug:'different_invoice'}),{code:'INVALID_CHECKOUT_HINTS'});
  assert.equal(syntheticChecks,0);
  result.observations.invoiceBinding={differentSlugRejected:true,noProviderCallForMismatchedSlug:true};
  await assert.rejects(service.get({...principal,applicationId:'other-app'},correlation.id),{code:'PAYMENT_NOT_FOUND'});
  await assert.rejects(service.get({...principal,receiverIds:['other-receiver']},correlation.id),{code:'PAYMENT_NOT_FOUND'});
  result.observations.objectIsolation={otherApplicationDenied:true,otherReceiverDenied:true};

  const pending=await make();
  const notifications=new InfinitePayNotifications(pool,service,principal);
  const legitimate={orderNsu:pending.id,transactionNsu:randomUUID(),slug:'correct_invoice'};
  for(let i=0;i<100;i++)await notifications.enqueue({...legitimate,transactionNsu:randomUUID()});
  assert.ok((await pool.query('SELECT count(*)::int n FROM checkout_notifications WHERE payment_id=$1',[pending.id])).rows[0].n<=64);
  assert.equal((await service.get(principal,pending.id)).state,'PENDING');
  await notifications.enqueue(legitimate);
  const operations=new PaymentOperations(pool,service);
  await operations.retry(principal,pending.id,randomUUID(),legitimate);
  assert.equal((await pool.query('SELECT trusted FROM checkout_notifications WHERE payment_id=$1 AND transaction_nsu=$2',[pending.id,legitimate.transactionNsu])).rows[0].trusted,true);
  result.observations.queuePoisoning={hundredHintsCannotPermanentlyBlock:true,operatorRetryAccepted:true,boundedHistory:true,paymentNotFalselyApproved:true};
  const proxyKey=randomUUID(),payload={};
  api=createServer(repository,new SimulatedProvider(),[],service,notifications,operations,proxyKey);
  const signed=source=>{const time=String(Date.now());return {'x-lp-time':time,'x-lp-source':source,'x-lp-signature':createHmac('sha256',proxyKey).update(['POST','/webhooks/infinitepay',time,source,createHash('sha256').update(JSON.stringify(payload)).digest('hex')].join('\n')).digest('hex')};};
  assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',payload})).statusCode,403);
  for(let i=0;i<120;i++)assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',payload,headers:signed('198.51.100.1')})).statusCode,400);
  assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',payload,headers:signed('198.51.100.1')})).statusCode,429);
  assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',payload,headers:signed('198.51.100.2')})).statusCode,400);
  result.observations.sharedWebhookRateLimit={authenticatedSourceIsolation:true,unsignedHeaderRejected:true,noLiveHttpFlood:true};
  await api.close();api=undefined;

  await operations.notice(principal,correlation.id,'REFUND_NOTICE');
  assert.equal((await service.get(principal,correlation.id)).state,'PENDING');
  result.observations.refundNotice={unverifiedNoticeCannotChangeFinancialState:true,
    automaticVerifiedRefundAccountingImplemented:false};

  const monitorPrincipal={...principal,applicationId:'audit-monitor-app'};
  for(let i=0;i<100;i++)await make(monitorPrincipal);
  const review=await make(monitorPrincipal);
  await repository.applyObservation(review,{orderNsu:review.id,transactionNsu:randomUUID(),state:'REVIEW_REQUIRED',reason:'AMOUNT_MISMATCH'});
  const report=await operations.report(monitorPrincipal);
  assert.equal(report.truncated,false);assert.equal(report.alerts.length,1);
  assert.ok(report.summary.codes.includes('FINANCIAL_REVIEW_REQUIRED'));
  const monitor=require('../../os-system-web/scripts/operacao/ligado-pay.cjs').avaliar(report);
  assert.ok(monitor.codes.includes('FINANCIAL_REVIEW_REQUIRED'));
  result.observations.monitorTruncation={record101NeedsReview:true,reportComplete:true,monitorReturnedReviewAlert:true};
  result.syntheticProviderChecks=syntheticChecks;
  await fs.mkdir('evidencias',{recursive:true});
  await fs.writeFile('evidencias/correcoes-integracao-2026-10-26.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {
  await api?.close();await pool?.end();
  if(created){assert.match(database,/^ligado_pay_audit_[a-f0-9]{32}$/);await admin.query(`DROP DATABASE "${database}"`);}
  await admin.end();
}
