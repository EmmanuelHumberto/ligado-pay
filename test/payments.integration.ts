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
