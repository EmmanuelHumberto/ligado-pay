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
