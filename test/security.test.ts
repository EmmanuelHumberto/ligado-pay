import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { parseConfig } from '../src/config.js';
import { authenticate, IngressLimiter } from '../src/http/authentication.js';
import { createServer } from '../src/http/server.js';
import { SimulatedProvider } from '../src/infrastructure/simulated-provider.js';
import type { PaymentRepository } from '../src/application/ports.js';

const token = randomBytes(32).toString('base64url');
const configuration = () => ({ mode: 'local', provider: 'simulated', environment: 'sandbox', port: 3305,
  databaseUrl: 'postgresql://runtime:local-test-only@127.0.0.1:55439/ligado_pay_test',
  credentials: [{ applicationId: 'app-one', receiverIds: ['receiver-one'],
    keyHash: createHash('sha256').update(token).digest('hex'), permissions: ['payments:create','payments:read'],
    maxAmountCents: 1000, requestsPerMinute: 20 }] });

test('configuration refuses production, real provider, remote database and missing limits', () => {
  assert.throws(() => parseConfig(configuration(), 'production'));
  for (const replacement of [{ provider: 'mercadopago' }, { mode: 'production' }, { environment: 'production' },
    { databaseUrl: 'postgresql://u:p@example.com/ligado_pay_test' }, { databaseUrl: 'postgresql://u:p@127.0.0.1/systemos' },
    { credentials: [{ ...configuration().credentials[0], requestsPerMinute: undefined }] },
    { credentials: [...configuration().credentials, ...configuration().credentials] }]) {
    assert.throws(() => parseConfig({ ...configuration(), ...replacement }, 'test'));
  }
});

test('authentication requires exact high entropy token and never exposes stored hash', () => {
  const credentials = parseConfig(configuration(), 'test').credentials;
  assert.equal(authenticate(undefined, credentials), null);
  assert.equal(authenticate(`Bearer ${randomBytes(32).toString('base64url')}`, credentials), null);
  assert.equal(authenticate(`Bearer ${token} extra`, credentials), null);
  const principal = authenticate(`Bearer ${token}`, credentials);
  assert.equal(principal?.applicationId, 'app-one');
  assert.equal(Object.hasOwn(principal!, 'keyHash'), false);
});

test('ingress buckets enforce limit and recover in a new window', () => {
  const limiter = new IngressLimiter();
  for (let i = 0; i < 120; i++) assert.equal(limiter.allow('127.0.0.1', 0), true);
  assert.equal(limiter.allow('127.0.0.1', 0), false);
  assert.equal(limiter.allow('127.0.0.1', 60_000), true);
});

test('HTTP boundary rejects browsers, missing auth, arbitrary fields, invalid values and unauthorized receiver', async t => {
  let reservationCalls = 0;
  const repository: PaymentRepository = {
    async reserve() { reservationCalls++; throw new Error('must not persist invalid requests'); },
    async find() { return null; }, async finish() { throw new Error('unused'); },
    async consumeRequest() { return true; }, async ready() {},
  };
  const api = createServer(repository, new SimulatedProvider(), parseConfig(configuration(), 'test').credentials);
  t.after(() => api.close());
  const headers = { authorization: `Bearer ${token}`, 'idempotency-key': 'request-key-00001' };
  const body = { receiverId: 'receiver-one', externalReference: 'opaque-001', amountCents: 100, currency: 'BRL', method: 'pix' };
  assert.equal((await api.inject({ method: 'POST', url: '/v1/payments', payload: body })).statusCode, 401);
  assert.equal((await api.inject({ url: '/health/ready' })).statusCode, 401);
  assert.equal((await api.inject({ url: '/health/live', headers: { origin: 'https://evil.example' } })).statusCode, 403);
  for (const change of [{ amountCents: '100' }, { amountCents: 1.5 }, { amountCents: -1 },
    { callbackUrl: 'http://127.0.0.1/' }, { provider: 'real' }, { cardNumber: 'not-accepted' }]) {
    const result = await api.inject({ method: 'POST', url: '/v1/payments', headers, payload: { ...body, ...change } });
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.includes('not-accepted'), false);
  }
  assert.equal((await api.inject({ method: 'POST', url: '/v1/payments', headers,
    payload: { ...body, receiverId: 'receiver-two' } })).statusCode, 403);
  assert.equal((await api.inject({ method: 'POST', url: '/v1/payments', headers,
    payload: { ...body, amountCents: 1001 } })).statusCode, 422);
  assert.equal(reservationCalls, 0);
  const live = await api.inject({ url: '/health/live' });
  assert.equal(live.statusCode, 200);
  assert.equal(live.headers['cache-control'], 'no-store');
  assert.equal(live.headers['access-control-allow-origin'], undefined);
  const large = await api.inject({ method: 'POST', url: '/v1/payments', headers,
    payload: { ...body, externalReference: 'a'.repeat(5000) } });
  assert.equal(large.statusCode, 413);
});

test('HTTP errors do not leak database failure, credentials or unknown URL', async t => {
  const secret = 'sensitive-database-message';
  const repository: PaymentRepository = {
    async reserve() { throw new Error(secret); }, async find() { throw new Error(secret); },
    async finish() { throw new Error(secret); }, async consumeRequest() { return true; }, async ready() { throw new Error(secret); },
  };
  const api = createServer(repository, new SimulatedProvider(), parseConfig(configuration(), 'test').credentials);
  t.after(() => api.close());
  const headers = { authorization: `Bearer ${token}` };
  const result = await api.inject({ url: '/health/ready', headers });
  assert.equal(result.statusCode, 503); assert.equal(result.body.includes(secret), false);
  const unknown = await api.inject({ url: `/unknown?token=${token}`, headers });
  assert.equal(unknown.statusCode, 404); assert.equal(unknown.body.includes(token), false);
});
