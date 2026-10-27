import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { parseConfig } from '../src/config.js';
import { authenticate, IngressLimiter } from '../src/http/authentication.js';
import { createServer } from '../src/http/server.js';
import { SimulatedProvider } from '../src/infrastructure/simulated-provider.js';
import type { PaymentRepository } from '../src/application/ports.js';
import { resolve } from 'node:path';
import type { InfinitePayNotifications } from '../src/infrastructure/infinitepay/notifications.js';

const token = randomBytes(32).toString('base64url');
const configuration = () => ({ mode: 'local', provider: 'simulated', environment: 'sandbox', port: 3305,
  databaseUrl: 'postgresql://runtime:local-test-only@127.0.0.1:55439/ligado_pay_test',
  credentials: [{ applicationId: 'app-one', receiverIds: ['receiver-one'],
    keyHash: createHash('sha256').update(token).digest('hex'), permissions: ['payments:create','payments:read'],
    maxAmountCents: 1000, requestsPerMinute: 20 }] });

test('private production is explicit and preserves financial identity and limits', () => {
  const raw = { ...configuration(), mode: 'private-production', provider: 'infinitepay', environment: 'production',
    credentials: [{...configuration().credentials[0]!, permissions:['payments:create','payments:read','payments:check']}],
    infinitepay: { receiverId:'receiver-one', handle:'merchant-contract', liveCreationEnabled:false,
      apiKeyFile:resolve('.local/fixture.dpapi'), redirectUrl:'https://portal.example.com/payment-return',
      webhookUrl:'https://portal.example.com/ligado-pay/webhooks/infinitepay', webhookApplicationId:'app-one',
      notificationProxyKeyFile:resolve('.local/proxy.dpapi') } };
  const parsed = parseConfig(raw, 'production');
  assert.equal(parsed.infinitepay?.receiverId, 'receiver-one');
  assert.equal(parsed.infinitepay?.liveCreationEnabled, false);
  assert.equal(parsed.credentials[0]?.keyHash, raw.credentials[0]?.keyHash);
  assert.equal(parsed.credentials[0]?.maxPayments, undefined);
  for (const env of [undefined,'development','test']) assert.throws(() => parseConfig(raw, env));
  for (const change of [{mode:'local'}, {provider:'simulated'}, {environment:'sandbox'},
    {databaseUrl:'postgresql://runtime:secret@example.com/ligado_pay_test'}]) {
    assert.throws(() => parseConfig({...raw,...change}, 'production'));
  }
  for (const change of [{notificationProxyKeyFile:undefined}, {notificationProxyKeyFile:'relative'},
    {webhookApplicationId:'unknown-app'}, {receiverId:'unknown-receiver'},
    {redirectUrl:'http://portal.example.com/'}, {redirectUrl:'https://user:secret@portal.example.com/'},
    {webhookUrl:'https://another.example.com/ligado-pay/webhooks/infinitepay'}]) {
    assert.throws(() => parseConfig({...raw,infinitepay:{...raw.infinitepay,...change}}, 'production'));
  }
  assert.throws(() => parseConfig({...raw,mode:'local',infinitepay:{...raw.infinitepay,notificationProxyKeyFile:undefined}}, 'development'));
});

test('HTTP notification construction fails closed and rejects absent, expired and wrong proxy signatures', async t => {
  let accepted = 0;
  const notifications = {async enqueue() { accepted++; }} as unknown as InfinitePayNotifications;
  const repository = {} as PaymentRepository;
  const credentials = parseConfig(configuration(), 'test').credentials;
  for (const key of [undefined,'','short','x'.repeat(31),'x'.repeat(32)+'\n']) {
    assert.throws(() => createServer(repository,new SimulatedProvider(),credentials,undefined,notifications,undefined,key));
  }
  const key = randomBytes(32).toString('hex');
  const api = createServer(repository,new SimulatedProvider(),credentials,undefined,notifications,undefined,key);
  t.after(() => api.close());
  const payload = {order_nsu:'11111111-1111-4111-8111-111111111111',transaction_nsu:'22222222-2222-4222-8222-222222222222',invoice_slug:'synthetic-slug'};
  function headers(secret:string,time=Date.now()) {
    const timestamp=String(time),source='192.0.2.1';
    const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return {'x-lp-time':timestamp,'x-lp-source':source,'x-lp-signature':createHmac('sha256',secret)
      .update(['POST','/webhooks/infinitepay',timestamp,source,digest].join('\n')).digest('hex')};
  }
  for (const h of [{},headers('wrong-key'),headers(key,Date.now()-120000)]) {
    assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',headers:h,payload})).statusCode,403);
  }
  assert.equal(accepted,0);
  assert.equal((await api.inject({method:'POST',url:'/webhooks/infinitepay',headers:headers(key),payload})).statusCode,200);
  assert.equal(accepted,1);
});

test('optional lifetime cap is validated and retained in the authenticated principal', () => {
  const raw = configuration();
  const withCap = (maxPayments: unknown) => ({...raw, credentials: [{...raw.credentials[0], maxPayments}]});
  const credentials = parseConfig(withCap(1), 'test').credentials;
  assert.equal(authenticate(`Bearer ${token}`, credentials)?.maxPayments, 1);
  assert.equal(Object.hasOwn(authenticate(`Bearer ${token}`, credentials)!, 'keyHash'), false);
  for (const value of [0,-1,1.2,'1',null,100001]) assert.throws(() => parseConfig(withCap(value), 'test'));
  assert.equal(parseConfig(raw, 'test').credentials[0]?.maxPayments, undefined);
});

test('configuration refuses production service, incomplete real provider, remote database and missing limits', () => {
  assert.throws(() => parseConfig(configuration(), 'production'));
  for (const replacement of [{ provider: 'mercadopago' }, { provider: 'infinitepay' }, { mode: 'production' }, { environment: 'production' },
    { databaseUrl: 'postgresql://u:p@example.com/ligado_pay_test' }, { databaseUrl: 'postgresql://u:p@127.0.0.1/systemos' },
    { credentials: [{ ...configuration().credentials[0], requestsPerMinute: undefined }] },
    { credentials: [...configuration().credentials, ...configuration().credentials] }]) {
    assert.throws(() => parseConfig({ ...configuration(), ...replacement }, 'test'));
  }
});

test('InfinitePay local configuration requires production account label, explicit creation switch and a bound receiver', () => {
  const config = { ...configuration(), provider: 'infinitepay', environment: 'production',
    infinitepay: { receiverId: 'receiver-one', handle: 'merchant-contract',
      redirectUrl: 'https://portal.example.com/payment-return', apiKeyFile: resolve('.local/fixture.dpapi'),
      liveCreationEnabled: false } };
  const parsed = parseConfig(config, 'development');
  assert.equal(parsed.provider, 'infinitepay'); assert.equal(parsed.infinitepay?.liveCreationEnabled, false);
  for (const change of [{ liveCreationEnabled: undefined }, { liveCreationEnabled: 'false' },
    { receiverId: 'other-receiver' }, { apiKeyFile: './relative.key' }]) {
    assert.throws(() => parseConfig({ ...config, infinitepay: { ...config.infinitepay, ...change } }, 'development'));
  }
  assert.throws(() => parseConfig({ ...config, environment: 'sandbox' }, 'development'));
  assert.throws(() => parseConfig(config, 'production'));
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
    async find() { return null; }, async findByReference() { return null; }, async finish() { throw new Error('unused'); },
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
    async reserve() { throw new Error(secret); }, async find() { throw new Error(secret); }, async findByReference() { throw new Error(secret); },
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
