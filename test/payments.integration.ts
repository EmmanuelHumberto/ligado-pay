import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { migrate } from '../src/infrastructure/migrate.js';
import { PostgresRepository } from '../src/infrastructure/postgres-repository.js';
import { PaymentService } from '../src/application/payment-service.js';
import { SimulatedProvider } from '../src/infrastructure/simulated-provider.js';
import { createServer } from '../src/http/server.js';
import type { Principal, CreatePayment } from '../src/domain/payment.js';
import { PostgresCheckoutRepository } from '../src/infrastructure/postgres-checkout-repository.js';
import { CheckoutService } from '../src/application/checkout-service.js';
import { InfinitePayCheckout } from '../src/infrastructure/infinitepay/checkout.js';
import { InfinitePayTransport } from '../src/infrastructure/infinitepay/transport.js';
import {InfinitePayNotifications,notificationHints} from '../src/infrastructure/infinitepay/notifications.js';
import {PaymentOperations} from '../src/application/payment-operations.js';

const token = randomBytes(32).toString('base64url');
let pool: pg.Pool;
let repository: PostgresRepository;
const principal = (): Principal => ({ applicationId: `test-${randomUUID()}`, receiverIds: ['ligado-test'],
  permissions: ['payments:create','payments:read'], maxAmountCents: 10000, requestsPerMinute: 60 });
const input = (): CreatePayment => ({ receiverId: 'ligado-test', externalReference: randomUUID(),
  amountCents: 1500, currency: 'BRL', method: 'pix' });

before(async () => {
  const connectionString = process.env['LIGADO_PAY_TEST_ADMIN_URL'] ??
    (JSON.parse(await readFile('.local/test-admin.json', 'utf8')) as { databaseUrl: string }).databaseUrl;
  const url = new URL(connectionString);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/ligado_pay_test') {
    throw new Error('Integration tests require the dedicated loopback ligado_pay_test database.');
  }
  pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  await migrate(pool);
  await migrate(pool);
  repository = new PostgresRepository(pool);
});
after(async () => { await pool?.end(); });

test('operations recover exhausted checks, preserve payment truth and expose safe expiry alerts',async()=>{
 const p={...principal(),permissions:['payments:read','payments:create','payments:check','payments:operations'] as const};
 const repo=new PostgresCheckoutRepository(pool,'operations-merchant');let calls=0;
 const connector=new InfinitePayCheckout({receiverId:'ligado-test',handle:'operations-merchant',maxAmountCents:10000,redirectUrl:'https://portal.example.com/portal'},
  new InfinitePayTransport('fake-key',async(url,init)=>{
   if(url.endsWith('/links'))return Response.json({checkout_url:'https://checkout.infinitepay.io/operations-merchant/invoice'});
   calls++;const body=JSON.parse(String(init.body));return Response.json({success:true,paid:true,amount:1500,paid_amount:1500,installments:1,capture_method:'pix',order_nsu:body.order_nsu,transaction_nsu:body.transaction_nsu});
  }));
 const service=new CheckoutService(repo,connector,'ligado-test',true),ops=new PaymentOperations(pool,service);
 const a=(await service.create(p,input(),'ops-original')).payment;
 await pool.query("UPDATE payments SET checkout_expires_at=now()-interval '1 hour',created_at=now()-interval '1 day' WHERE id=$1",[a.id]);
 const before=await ops.report(p,a.id);assert.ok(before.alerts[0]!.alerts.includes('EXPIRED_UNCONFIRMED'));
 assert.ok(before.alerts[0]!.alerts.includes('MISSING_PROVIDER_CORRELATION'));
 assert.equal((await service.get(p,a.id)).state,'PENDING');assert.equal(calls,0);
 const hints={orderNsu:a.id,transactionNsu:randomUUID(),slug:'invoice'};
 await assert.rejects(ops.retry({...p,permissions:['payments:read','payments:check']},a.id,'ops-retry-no-permission',hints),{code:'OPERATION_NOT_ALLOWED'});
 const result=await ops.retry(p,a.id,'ops-retry-1',hints);assert.equal(result.queued,true);
 await pool.query("UPDATE checkout_notifications SET state='FAILED',attempts=8 WHERE payment_id=$1",[a.id]);
 await ops.retry(p,a.id,'ops-retry-1',hints);assert.equal((await pool.query('SELECT attempts FROM checkout_notifications WHERE payment_id=$1',[a.id])).rows[0].attempts,8);
 await ops.retry(p,a.id,'ops-retry-2',hints);
 const worker=new InfinitePayNotifications(pool,service,p);await worker.tick();
 assert.equal((await service.get(p,a.id)).state,'PAID_PIX');assert.equal(calls,1);
 await ops.retry(p,a.id,'ops-retry-paid',hints);await worker.tick();assert.equal(calls,1);
 await assert.rejects(ops.report({...p,applicationId:'foreign-app'},a.id),{code:'PAYMENT_NOT_FOUND'});
 await assert.rejects(ops.report({...p,receiverIds:['foreign-receiver']},a.id),{code:'PAYMENT_NOT_FOUND'});
 assert.equal((await ops.report(p,a.id)).capabilities.automaticRefund,false);
});

test('refund/cancel requests and public notices are append-only intentions, never bank movements',async()=>{
 const p={...principal(),permissions:['payments:read','payments:create','payments:check','payments:operations'] as const};
 const repo=new PostgresCheckoutRepository(pool,'ops-request-merchant');
 const connector={async createLink(i:{paymentId:string;expiresAt:string}){return {orderNsu:i.paymentId,checkoutUrl:'https://checkout.infinitepay.io/ops-request-merchant/one',expiresAt:i.expiresAt,exclusivePix:false as const,directQrAvailable:false as const};},async checkPayment(){throw Error('No provider calls allowed');}};
 const service=new CheckoutService(repo,connector,'ligado-test',true),ops=new PaymentOperations(pool,service);
 const a=(await service.create(p,input(),'ops-request-original')).payment;
 const cancel=await ops.request(p,a.id,'cancel-request-1',{kind:'CANCEL_REQUEST',reasonCode:'CUSTOMER_REQUEST'});
 assert.equal(cancel.financialStateChanged,false);assert.equal((await service.get(p,a.id)).state,'PENDING');
 await assert.rejects(ops.request(p,a.id,'refund-before-paid',{kind:'REFUND_REQUEST',reasonCode:'CUSTOMER_REQUEST',amountCents:100}),{code:'REFUND_NOT_ALLOWED'});
 await repo.applyObservation(a,{state:'PAID_PIX',orderNsu:a.id,transactionNsu:randomUUID(),amountCents:1500,paidAmountCents:1500});
 const request={kind:'REFUND_REQUEST' as const,reasonCode:'CUSTOMER_REQUEST',amountCents:1000};
 const one=await ops.request(p,a.id,'refund-request-1',request),replay=await ops.request(p,a.id,'refund-request-1',request);
 assert.equal(one.id,replay.id);assert.equal(one.status,'NEEDS_PROVIDER_ACTION');
 await assert.rejects(ops.request(p,a.id,'refund-request-2',request),{code:'REFUND_AMOUNT_ALREADY_RESERVED'});
 await assert.rejects(ops.request(p,a.id,'refund-request-1',{...request,amountCents:500}),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(ops.request(p,a.id,'cancel-paid',{kind:'CANCEL_REQUEST',reasonCode:'CUSTOMER_REQUEST'}),{code:'USE_REFUND_REQUEST'});
 await ops.notice(p,a.id,'REFUND_NOTICE');await ops.notice(p,a.id,'REFUND_NOTICE');
 assert.equal((await service.get(p,a.id)).state,'PAID_PIX');
 assert.equal((await pool.query("SELECT count(*)::int n FROM payment_operations WHERE payment_id=$1 AND kind='REFUND_NOTICE'",[a.id])).rows[0].n,1);
 await assert.rejects(pool.query("UPDATE payment_operations SET reason_code='CHANGED' WHERE id=$1",[one.id]));
 await assert.rejects(pool.query('DELETE FROM payment_operations WHERE id=$1',[one.id]));
 const api=createServer(repo,new SimulatedProvider(),[{...p,keyHash:createHash('sha256').update(token).digest('hex')}],service,undefined,ops);
 try{
  assert.equal((await api.inject({method:'GET',url:'/v1/operations'})).statusCode,401);
  assert.equal((await api.inject({method:'GET',url:'/v1/operations',headers:{authorization:'Bearer '+token}})).statusCode,200);
  assert.equal((await api.inject({method:'POST',url:'/v1/payments/'+a.id+'/operations',headers:{authorization:'Bearer '+token,'idempotency-key':'invalid-fields-001'},payload:{...request,bankAccount:'forbidden'}})).statusCode,400);
 }finally{await api.close();}
});

test('public notifications persist before acknowledgement and only authenticated provider verification settles',async()=>{
  const p={...principal(),permissions:['payments:create','payments:read','payments:check'] as const};
  const repo=new PostgresCheckoutRepository(pool,'notification-merchant');
  let creates=0,checks=0,paid=false,fail=false;
  const connector=new InfinitePayCheckout({receiverId:'ligado-test',handle:'notification-merchant',maxAmountCents:10000,
    redirectUrl:'https://portal.example.com/portal',webhookUrl:'https://portal.example.com/ligado-pay/webhooks/infinitepay'},
    new InfinitePayTransport('fake-secret',async(url,init)=>{
      const body=JSON.parse(String(init.body));
      if(url.endsWith('/links')){creates++;assert.deepEqual(body.webhook,{url:'https://portal.example.com/ligado-pay/webhooks/infinitepay',events:['paid','settled','refunded','canceled']});
        return Response.json({checkout_url:'https://checkout.infinitepay.io/notification-merchant/invoice'});}
      checks++;if(fail)throw new Error('synthetic provider outage');
      return Response.json({success:true,paid,amount:1500,paid_amount:1500,installments:1,capture_method:'pix',
        order_nsu:body.order_nsu,transaction_nsu:body.transaction_nsu});
    }));
  const service=new CheckoutService(repo,connector,'ligado-test',true);
  const made=await service.create(p,input(),'notification-create');
  const id=made.payment.id,transaction=randomUUID();
  const notifications=new InfinitePayNotifications(pool,service,p);
  const ops=new PaymentOperations(pool,service);
  const api=createServer(repo,new SimulatedProvider(),[
    {...p,applicationId:'foreign-app',keyHash:createHash('sha256').update(token).digest('hex')}
  ],service,notifications,ops);
  const payload={order_nsu:id,transaction_nsu:transaction,invoice_slug:'invoice',paid:true,amount:1};
  try{
    const denied=await api.inject({method:'POST',url:'/v1/payments/'+id+'/check',
      headers:{authorization:'Bearer '+token},payload:{orderNsu:id,transactionNsu:transaction,slug:'invoice'}});
    assert.equal(denied.statusCode,404);
    assert.equal((await pool.query('SELECT count(*)::int n FROM checkout_notifications WHERE payment_id=$1',[id])).rows[0].n,0);
    for(const event of ['refunded','canceled']){
      assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',payload:{event,order_nsu:id}})).statusCode,200);
    }
    assert.equal((await service.get(p,id)).state,'PENDING');
    assert.equal((await pool.query('SELECT count(*)::int n FROM payment_operations WHERE payment_id=$1 AND application_id=$2',[id,p.applicationId])).rows[0].n,2);
    const unknown=await api.inject({method:'POST',url:'/webhooks/infinitepay',payload:{...payload,order_nsu:randomUUID()}});
    assert.equal(unknown.statusCode,200);assert.equal(checks,0);
    const foreign=new InfinitePayNotifications(pool,service,{...p,applicationId:'other-app'});
    await foreign.enqueue(notificationHints(payload));assert.equal(checks,0);
    assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',payload:{paid:true}})).statusCode,400);
    assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',headers:{origin:'https://evil.example'},payload})).statusCode,403);
    for(let i=0;i<3;i++)assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',payload})).statusCode,200);
    assert.equal(checks,0);assert.equal((await service.get(p,id)).state,'PENDING');
    assert.equal((await pool.query('SELECT count(*)::int n FROM checkout_notifications WHERE payment_id=$1',[id])).rows[0].n,1);
    await Promise.all([notifications.tick(),new InfinitePayNotifications(pool,service,p).tick()]);
    assert.equal(checks,1);assert.equal((await service.get(p,id)).state,'PENDING');
    await pool.query("UPDATE checkout_notifications SET next_check_at=now()-interval '1 second' WHERE payment_id=$1",[id]);
    fail=true;await notifications.tick();assert.equal((await service.get(p,id)).state,'PENDING');fail=false;
    await pool.query("UPDATE checkout_notifications SET next_check_at=now()-interval '1 second' WHERE payment_id=$1",[id]);
    paid=true;await notifications.tick();assert.equal((await service.get(p,id)).state,'PAID_PIX');
    await notifications.enqueue(notificationHints(payload));await notifications.tick();
    assert.equal(creates,1);assert.equal(checks,3);
    assert.equal((await pool.query('SELECT count(*)::int n FROM provider_settlements WHERE payment_id=$1',[id])).rows[0].n,1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM payment_events WHERE payment_id=$1 AND event_type='PAID_PIX'",[id])).rows[0].n,1);
  }finally{await api.close();await notifications.stop();}
});

test('lifetime cap reserves exactly once across competing keys, restarts and uncertain results', async () => {
  const p = {...principal(), maxPayments: 1};
  let calls = 0;
  const provider = {name:'simulated' as const, async create() { calls++; throw new Error('synthetic uncertainty'); }};
  const service = new PaymentService(repository, provider);
  const bodies = [input(),input()];
  const results = await Promise.allSettled(bodies.map((b,i) => service.create(p,b,'cap-key-'+i)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1);
  const rejected = results.find(r => r.status === 'rejected');
  assert.equal(rejected?.status === 'rejected' && rejected.reason.code, 'RESERVATION_LIMIT_REACHED');
  const winner = results.findIndex(r => r.status === 'fulfilled');
  const result = results[winner]!;
  assert.equal(result.status === 'fulfilled' && result.value.payment.state, 'UNCERTAIN');
  const restarted = new PaymentService(new PostgresRepository(pool),provider);
  const replay = await restarted.create(p,bodies[winner]!,'cap-key-'+winner);
  assert.equal(replay.created,false);
  await assert.rejects(restarted.create(p,input(),'cap-after-restart'),{code:'RESERVATION_LIMIT_REACHED'});
  assert.equal(calls,1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM payments WHERE application_id=$1',[p.applicationId])).rows[0].n,1);
});

test('concurrent duplicate requests create one durable intent and one provider call', async () => {
  const p = principal(), body = input();
  let calls = 0;
  const service = new PaymentService(repository, { name: 'simulated', async create({ payment }) {
    calls++; await new Promise(resolve => setTimeout(resolve, 40)); return { reference: `simulated:${payment.id}` };
  } });
  const results = await Promise.all(Array.from({ length: 12 }, () => service.create(p, body, 'concurrent-key-001')));
  assert.equal(calls, 1);
  assert.equal(new Set(results.map(r => r.payment.id)).size, 1);
  assert.equal(results.filter(r => r.created).length, 1);
  const final = await service.get(p, results[0]!.payment.id);
  assert.equal(final.state, 'PENDING');
  const counts = await pool.query<{ events: string; outbox: string }>(`SELECT
    (SELECT count(*) FROM payment_events WHERE payment_id=$1) AS events,
    (SELECT count(*) FROM outbox o JOIN payment_events e ON e.id=o.event_id WHERE e.payment_id=$1) AS outbox`, [final.id]);
  assert.deepEqual(counts.rows[0], { events: '2', outbox: '2' });
});

test('changed payload conflicts and another key cannot charge the same reference again', async () => {
  const service = new PaymentService(repository, new SimulatedProvider());
  const p = principal(), body = input();
  await service.create(p, body, 'reference-key-001');
  await assert.rejects(service.create(p, { ...body, amountCents: 1600 }, 'reference-key-001'), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.create(p, body, 'reference-key-002'), { code: 'REFERENCE_ALREADY_CHARGED' });
});

test('provider timeout stays uncertain and replay does not create another charge', async () => {
  let calls = 0;
  const service = new PaymentService(repository, { name: 'simulated', async create() { calls++; throw new Error('network timeout'); } });
  const p = principal(), body = input();
  const first = await service.create(p, body, 'uncertain-key-001');
  assert.equal(first.payment.state, 'UNCERTAIN');
  const replay = await service.create(p, body, 'uncertain-key-001');
  assert.equal(replay.payment.id, first.payment.id);
  assert.equal(replay.payment.state, 'UNCERTAIN'); assert.equal(calls, 1);
});

test('application and receiver authorization hide another payment even for valid credentials', async () => {
  const service = new PaymentService(repository, new SimulatedProvider());
  const p = principal(), body = input();
  const result = await service.create(p, body, 'isolation-key-001');
  await assert.rejects(service.get(principal(), result.payment.id), { code: 'PAYMENT_NOT_FOUND' });
  await assert.rejects(service.get({ ...p, receiverIds: ['other-receiver'] }, result.payment.id), { code: 'PAYMENT_NOT_FOUND' });
  await assert.rejects(service.create(p, { ...input(), receiverId: 'other-receiver' }, 'isolation-key-002'), { code: 'OPERATION_NOT_ALLOWED' });
  await assert.rejects(service.create({ ...p, permissions: ['payments:read'] }, input(), 'isolation-key-003'), { code: 'OPERATION_NOT_ALLOWED' });
});

test('outbox failure rolls back both payment and financial event before calling provider', async () => {
  const p = principal(); let calls = 0;
  const service = new PaymentService(repository, { name: 'simulated', async create() { calls++; return { reference: 'unused' }; } });
  await pool.query('ALTER TABLE outbox ADD CONSTRAINT test_outbox_failure CHECK (false) NOT VALID');
  try {
    await assert.rejects(service.create(p, input(), 'rollback-key-001'));
    const result = await pool.query('SELECT id FROM payments WHERE application_id=$1', [p.applicationId]);
    assert.equal(result.rowCount, 0); assert.equal(calls, 0);
    const events = await pool.query('SELECT id FROM payment_events WHERE application_id=$1', [p.applicationId]);
    assert.equal(events.rowCount, 0);
  } finally { await pool.query('ALTER TABLE outbox DROP CONSTRAINT test_outbox_failure'); }
});

test('crash after durable reservation preserves processing without resubmission', async () => {
  const p = principal(), body = input();
  const reserved = await repository.reserve(p, body, 'crash-key-00001');
  let calls = 0;
  const service = new PaymentService(repository, { name: 'simulated', async create() { calls++; return { reference: 'unused' }; } });
  const result = await service.create(p, body, 'crash-key-00001');
  assert.equal(result.payment.id, reserved.payment.id); assert.equal(result.payment.state, 'PROCESSING'); assert.equal(calls, 0);
});

test('database failure after provider acceptance rolls back state and replay never resends', async () => {
  const p = principal(), body = input(); let calls = 0;
  const service = new PaymentService(repository, { name: 'simulated', async create() {
    calls++;
    await pool.query('ALTER TABLE outbox ADD CONSTRAINT test_finish_failure CHECK (false) NOT VALID');
    return { reference: 'simulated-accepted-before-database-failure' };
  } });
  try {
    await assert.rejects(service.create(p, body, 'finish-failure-001'));
    const replay = await service.create(p, body, 'finish-failure-001');
    assert.equal(replay.payment.state, 'PROCESSING'); assert.equal(calls, 1);
    const events = await pool.query('SELECT event_type FROM payment_events WHERE payment_id=$1', [replay.payment.id]);
    assert.deepEqual(events.rows, [{ event_type: 'PROCESSING' }]);
  } finally { await pool.query('ALTER TABLE outbox DROP CONSTRAINT IF EXISTS test_finish_failure'); }
});

test('migration checksum drift is refused rather than silently accepted', async () => {
  const previous = await pool.query<{ name: string; sha256: string }>('SELECT name,sha256 FROM schema_migrations ORDER BY name LIMIT 1');
  const row = previous.rows[0]!;
  await pool.query('UPDATE schema_migrations SET sha256=$2 WHERE name=$1', [row.name, '0'.repeat(64)]);
  try { await assert.rejects(migrate(pool), /checksum mismatch/); }
  finally { await pool.query('UPDATE schema_migrations SET sha256=$2 WHERE name=$1', [row.name, row.sha256]); }
});

test('financial history rejects mutation and persisted rate limits apply across instances', async () => {
  const service = new PaymentService(repository, new SimulatedProvider());
  const p = principal(); const result = await service.create(p, input(), 'audit-key-00001');
  await assert.rejects(pool.query("UPDATE payment_events SET event_type='UNCERTAIN' WHERE payment_id=$1", [result.payment.id]));
  await assert.rejects(pool.query('DELETE FROM payment_events WHERE payment_id=$1', [result.payment.id]));
  const limited = { ...principal(), requestsPerMinute: 2 };
  const otherInstance = new PostgresRepository(pool);
  assert.equal(await repository.consumeRequest(limited), true);
  assert.equal(await otherInstance.consumeRequest(limited), true);
  assert.equal(await repository.consumeRequest(limited), false);
});

test('HTTP creates and retrieves only simulated payment through restricted credentials', async t => {
  const p = principal();
  const api = createServer(repository, new SimulatedProvider(), [{ ...p, keyHash: createHash('sha256').update(token).digest('hex') }]);
  t.after(() => api.close());
  const headers = { authorization: `Bearer ${token}`, 'idempotency-key': 'http-payment-0001' };
  const body = input();
  const response = await api.inject({ method: 'POST', url: '/v1/payments', headers, payload: body });
  assert.equal(response.statusCode, 201);
  const result = response.json<{ id: string; state: string; simulated: boolean; realPaymentsEnabled: boolean }>();
  assert.equal(result.state, 'PENDING'); assert.equal(result.simulated, true); assert.equal(result.realPaymentsEnabled, false);
  assert.equal((await api.inject({ url: `/v1/payments/${result.id}`, headers })).statusCode, 200);
  assert.equal((await api.inject({ method: 'POST', url: '/v1/payments', headers, payload: body })).statusCode, 200);
  assert.equal((await api.inject({ url: '/health/ready', headers })).statusCode, 200);
});

function checkoutFixture(options: { createFailure?: boolean; checkResult?: Record<string, unknown>; enabled?: boolean } = {}) {
  const p: Principal = { ...principal(), permissions: ['payments:create','payments:read','payments:check'] };
  const repo = new PostgresCheckoutRepository(pool, 'merchant-contract');
  let creates = 0, checks = 0;
  const connector = new InfinitePayCheckout({ receiverId: 'ligado-test', handle: 'merchant-contract',
    maxAmountCents: 10000, redirectUrl: 'https://portal.example.com/payment-return' },
  new InfinitePayTransport('inchk_contract_test_not_a_real_credential', async (url, request) => {
    if (url.endsWith('/links')) {
      creates++;
      if (options.createFailure) throw new Error('timeout after provider may have accepted link');
      const body = JSON.parse(String(request.body)) as { order_nsu: string };
      return Response.json({ checkout_url: `https://checkout.infinitepay.io/merchant-contract/${body.order_nsu}` });
    }
    checks++;
    return Response.json(options.checkResult ?? { success: true, paid: true, amount: 1500,
      paid_amount: 1500, installments: 1, capture_method: 'pix' });
  }));
  return { p, repo, service: new CheckoutService(repo, connector, 'ligado-test', options.enabled ?? true),
    creates: () => creates, checks: () => checks };
}

test('checkout concurrent creation persists once, survives a new service instance and is isolated from sandbox/account', async () => {
  const f = checkoutFixture(), body = input();
  const results = await Promise.all(Array.from({ length: 12 }, () => f.service.create(f.p, body, 'checkout-duplicate-001')));
  assert.equal(f.creates(), 1);
  assert.equal(new Set(results.map(result => result.payment.id)).size, 1);
  const payment = await f.service.get(f.p, results[0]!.payment.id);
  assert.equal(payment.provider, 'infinitepay'); assert.equal(payment.environment, 'production');
  assert.ok(payment.checkout?.url?.startsWith('https://checkout.infinitepay.io/merchant-contract/'));
  assert.equal(payment.checkout?.exclusivePix, false);
  const restarted = new PostgresCheckoutRepository(pool, 'merchant-contract');
  assert.equal((await restarted.find(f.p, payment.id))?.checkout?.url, payment.checkout?.url);
  assert.equal(await repository.find(f.p, payment.id), null);
  assert.equal(await new PostgresCheckoutRepository(pool, 'another-account').find(f.p, payment.id), null);
  await assert.rejects(f.service.get(principal(), payment.id), { code: 'PAYMENT_NOT_FOUND' });
});

test('reference recovery is scoped by account, environment, receiver and application and works while creation is disabled', async () => {
  const f = checkoutFixture(), body = input();
  const { payment } = await f.service.create(f.p, body, 'reference-recovery-001');
  const readOnly = { ...f.p, permissions: ['payments:read'] as const };
  const stopped = new CheckoutService(f.repo, {
    async createLink() { throw new Error('must not create'); },
    async checkPayment() { throw new Error('must not check'); },
  }, body.receiverId, false);
  assert.equal((await stopped.lookup(readOnly, body.receiverId, body.externalReference)).id, payment.id);
  assert.equal(await repository.findByReference(readOnly, body.receiverId, body.externalReference), null);
  assert.equal(await new PostgresCheckoutRepository(pool, 'another-account').findByReference(readOnly, body.receiverId, body.externalReference), null);
  assert.equal(await f.repo.findByReference({ ...readOnly, applicationId: 'other-app' }, body.receiverId, body.externalReference), null);
  assert.equal(await f.repo.findByReference({ ...readOnly, receiverIds: [] }, body.receiverId, body.externalReference), null);
  await assert.rejects(stopped.lookup(readOnly, body.receiverId, randomUUID()), { code: 'PAYMENT_NOT_FOUND' });
  const before = Number((await pool.query('SELECT count(*) n FROM payments')).rows[0].n);
  await assert.rejects(stopped.lookup(readOnly, body.receiverId, randomUUID()), { code: 'PAYMENT_NOT_FOUND' });
  assert.equal(Number((await pool.query('SELECT count(*) n FROM payments')).rows[0].n), before);
  assert.equal(f.creates(), 1); assert.equal(f.checks(), 0);
});

test('checkout disabled creation persists nothing and timeout is durable without any resubmission', async () => {
  const disabled = checkoutFixture({ enabled: false });
  await assert.rejects(disabled.service.create(disabled.p, input(), 'checkout-disabled-001'), { code: 'LIVE_CREATION_DISABLED' });
  assert.equal(disabled.creates(), 0);
  assert.equal((await pool.query('SELECT 1 FROM payments WHERE application_id=$1', [disabled.p.applicationId])).rowCount, 0);
  const f = checkoutFixture({ createFailure: true }), body = input();
  const first = await f.service.create(f.p, body, 'checkout-timeout-001');
  assert.equal(first.payment.state, 'UNCERTAIN'); assert.equal(first.payment.checkout?.url, null);
  const replay = await f.service.create(f.p, body, 'checkout-timeout-001');
  assert.equal(replay.payment.id, first.payment.id); assert.equal(f.creates(), 1);
  await assert.rejects(f.service.create(f.p, body, 'checkout-timeout-002'), { code: 'REFERENCE_ALREADY_CHARGED' });
});

test('confirmed checkout writes settlement and event atomically and does not settle two orders with one transaction', async () => {
  const f = checkoutFixture(), first = await f.service.create(f.p, input(), 'checkout-paid-001');
  const transaction = randomUUID();
  const hints = { orderNsu: first.payment.id, transactionNsu: transaction, slug: 'fixture' };
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.service.check(f.p, first.payment.id, hints)));
  assert.ok(responses.every(payment => payment.state === 'PAID_PIX'));
  const events = await pool.query("SELECT 1 FROM payment_events WHERE payment_id=$1 AND event_type='PAID_PIX'", [first.payment.id]);
  assert.equal(events.rowCount, 1);
  const settlement = await pool.query('SELECT 1 FROM provider_settlements WHERE payment_id=$1', [first.payment.id]);
  assert.equal(settlement.rowCount, 1);
  const second = await f.service.create(f.p, input(), 'checkout-paid-002');
  await assert.rejects(f.service.check(f.p, second.payment.id, { ...hints, orderNsu: second.payment.id }), { code: 'TRANSACTION_ALREADY_USED' });
  assert.equal((await f.service.get(f.p, second.payment.id)).state, 'PENDING');
  assert.equal(f.creates(), 2);
});

test('checkout cannot confirm from wrong order, read-only identity or mismatched financial response', async () => {
  const f = checkoutFixture({ checkResult: { success: true, paid: true, amount: 1500,
    paid_amount: 1499, capture_method: 'pix', installments: 1 } });
  const created = await f.service.create(f.p, input(), 'checkout-review-001');
  const hints = { orderNsu: created.payment.id, transactionNsu: randomUUID(), slug: 'fixture' };
  await assert.rejects(f.service.check({ ...f.p, permissions: ['payments:read'] }, created.payment.id, hints), { code: 'OPERATION_NOT_ALLOWED' });
  await assert.rejects(f.service.check(f.p, created.payment.id, { ...hints, orderNsu: randomUUID() }), { code: 'INVALID_CHECKOUT_HINTS' });
  assert.equal(f.checks(), 0);
  assert.equal((await f.service.check(f.p, created.payment.id, hints)).state, 'REVIEW_REQUIRED');
  assert.equal((await pool.query('SELECT 1 FROM provider_settlements WHERE payment_id=$1', [created.payment.id])).rowCount, 0);
  const later = await f.repo.applyObservation(created.payment, { state: 'PAID_PIX', orderNsu: created.payment.id,
    transactionNsu: randomUUID(), amountCents: 1500, paidAmountCents: 1500 });
  assert.equal(later.state, 'REVIEW_REQUIRED');
  assert.equal((await pool.query('SELECT 1 FROM provider_settlements WHERE payment_id=$1', [created.payment.id])).rowCount, 0);
});

test('checkout confirmation rollback preserves unpaid state and transaction is available for verified retry', async () => {
  const f = checkoutFixture(), created = await f.service.create(f.p, input(), 'checkout-rollback-001');
  const hints = { orderNsu: created.payment.id, transactionNsu: randomUUID(), slug: 'fixture' };
  await pool.query('ALTER TABLE outbox ADD CONSTRAINT test_checkout_failure CHECK (false) NOT VALID');
  try {
    await assert.rejects(f.service.check(f.p, created.payment.id, hints));
    assert.equal((await f.service.get(f.p, created.payment.id)).state, 'PENDING');
    assert.equal((await pool.query('SELECT 1 FROM provider_settlements WHERE transaction_nsu=$1', [hints.transactionNsu])).rowCount, 0);
  } finally { await pool.query('ALTER TABLE outbox DROP CONSTRAINT test_checkout_failure'); }
  assert.equal((await f.service.check(f.p, created.payment.id, hints)).state, 'PAID_PIX');
  assert.equal(f.creates(), 1);
});

test('HTTP checkout flow requires dedicated permission, ignores no fields and exposes true provider capabilities', async t => {
  const f = checkoutFixture(), api = createServer(f.repo, new SimulatedProvider(), [{ ...f.p,
    keyHash: createHash('sha256').update(token).digest('hex') }], f.service);
  t.after(() => api.close());
  const headers = { authorization: `Bearer ${token}`, 'idempotency-key': 'checkout-http-001' };
  const response = await api.inject({ method: 'POST', url: '/v1/payments', headers, payload: input() });
  assert.equal(response.statusCode, 201);
  const result = response.json<{ id: string; provider: string; simulated: boolean; environment: string }>();
  assert.equal(result.provider, 'infinitepay'); assert.equal(result.simulated, false); assert.equal(result.environment, 'production');
  const hints = { orderNsu: result.id, transactionNsu: randomUUID(), slug: 'fixture' };
  const bad = await api.inject({ method: 'POST', url: `/v1/payments/${result.id}/check`, headers,
    payload: { ...hints, paid: true, amountCents: 1 } });
  assert.equal(bad.statusCode, 400); assert.equal(f.checks(), 0);
  const paid = await api.inject({ method: 'POST', url: `/v1/payments/${result.id}/check`, headers, payload: hints });
  assert.equal(paid.statusCode, 200); assert.equal(paid.json<{ state: string }>().state, 'PAID_PIX');
});
