import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { Payment, Principal } from '../src/domain/payment.js';
import type { CheckoutRepository } from '../src/application/checkout-service.js';
import { CheckoutService } from '../src/application/checkout-service.js';
import { PaymentService } from '../src/application/payment-service.js';
import { SimulatedProvider } from '../src/infrastructure/simulated-provider.js';
import { createServer } from '../src/http/server.js';

test('read-only reference recovery works with creation disabled and never reserves or calls the provider', async t => {
  const token = randomBytes(32).toString('base64url');
  const principal: Principal = { applicationId: 'app-one', receiverIds: ['receiver-one'],
    permissions: ['payments:read'], maxAmountCents: 10000, requestsPerMinute: 60 };
  const payment: Payment = { id: randomUUID(), applicationId: principal.applicationId, receiverId: 'receiver-one',
    externalReference: randomUUID(), provider: 'infinitepay', environment: 'production', amountCents: 100,
    currency: 'BRL', state: 'UNCERTAIN', createdAt: new Date().toISOString(), providerReference: null,
    checkout: { url: null, expiresAt: new Date().toISOString(), exclusivePix: false, directQrAvailable: false } };
  let reads = 0;
  const unused = async (): Promise<never> => { throw new Error('Recovery must never mutate or call a provider'); };
  const repository: CheckoutRepository = {
    reserve: unused, finish: unused, finishCheckout: unused, applyObservation: unused, find: unused,
    async findByReference(p, receiver, reference) {
      reads++;
      return p.applicationId === payment.applicationId && receiver === payment.receiverId &&
        reference === payment.externalReference ? payment : null;
    }, async consumeRequest() { return true; }, async ready() {},
  };
  const checkout = new CheckoutService(repository, { createLink: unused, checkPayment: unused }, 'receiver-one', false);
  assert.equal((await checkout.lookup(principal, 'receiver-one', payment.externalReference)).state, 'UNCERTAIN');
  await assert.rejects(checkout.lookup({ ...principal, permissions: [] }, 'receiver-one', payment.externalReference), { code: 'OPERATION_NOT_ALLOWED' });
  await assert.rejects(checkout.lookup(principal, 'receiver-two', payment.externalReference), { code: 'OPERATION_NOT_ALLOWED' });
  assert.equal(reads, 1);
  await assert.rejects(checkout.lookup({ ...principal, applicationId: 'another-app' }, 'receiver-one', payment.externalReference), { code: 'PAYMENT_NOT_FOUND' });
  await assert.rejects(checkout.lookup(principal, 'receiver-one', randomUUID()), { code: 'PAYMENT_NOT_FOUND' });
  const api = createServer(repository, new SimulatedProvider(), [{ ...principal,
    keyHash: createHash('sha256').update(token).digest('hex') }], checkout);
  t.after(() => api.close());
  const url = '/v1/payment-references/receiver-one/' + payment.externalReference;
  const headers = { authorization: 'Bearer ' + token };
  assert.equal((await api.inject({ url })).statusCode, 401);
  assert.equal((await api.inject({ url, headers: { ...headers, origin: 'https://evil.example' } })).statusCode, 403);
  const response = await api.inject({ url, headers });
  assert.equal(response.statusCode, 200); assert.equal(response.json().id, payment.id);
  assert.equal(response.json().realPaymentsEnabled, false);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal((await api.inject({ url: '/v1/payment-references/receiver-one/' + randomUUID(), headers })).statusCode, 404);
  assert.equal((await api.inject({ url: '/v1/payment-references/receiver-one/not%20opaque', headers })).statusCode, 400);
  const simulated = new PaymentService(repository, new SimulatedProvider());
  assert.equal((await simulated.lookup(principal, 'receiver-one', payment.externalReference)).id, payment.id);
});
