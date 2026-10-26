import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { InfinitePayCheckout } from '../src/infrastructure/infinitepay/checkout.js';
import { InfinitePayTransport } from '../src/infrastructure/infinitepay/transport.js';
import type { ProviderFetch } from '../src/infrastructure/infinitepay/transport.js';
import type { CheckoutIntent } from '../src/application/checkout-connector.js';

const fakeKey = 'inchk_contract_test_not_a_real_credential';
const account = { receiverId: 'receiver-contract', handle: 'merchant-contract', maxAmountCents: 10000,
  redirectUrl: 'https://portal.example.com/payment-return' };
const now = Date.parse('2026-10-25T12:00:00Z');
const intent = (): CheckoutIntent => ({ paymentId: randomUUID(), receiverId: account.receiverId,
  amountCents: 1500, expiresAt: '2026-10-25T13:00:00Z' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json' } });
function fixture(fetchImplementation: ProviderFetch) {
  return new InfinitePayCheckout(account, new InfinitePayTransport(fakeKey, fetchImplementation), () => now);
}
const paid = { success: true, paid: true, amount: 1500, paid_amount: 1500, installments: 1, capture_method: 'pix' };

test('link request binds receiver credential, cents, opaque ID, single use and expiration without personal data', async () => {
  const p = intent(); let calls = 0;
  const connector = fixture(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.checkout.infinitepay.io/links');
    assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal((options.headers as Record<string, string>)['X-Api-Key'], fakeKey);
    assert.deepEqual(JSON.parse(String(options.body)), {
      order_nsu: p.paymentId, redirect_url: account.redirectUrl,
      items: [{ quantity: 1, price: 1500, description: 'Pagamento Ligado' }],
      options: { single_payment: true, valid_until: p.expiresAt.replace('00Z','00.000Z'),
        payment_methods_enabled: ['pix', 'credit_card'], require_delivery_address: false },
    });
    return json({ checkout_url: 'https://checkout.infinitepay.io/merchant-contract/fixture-link' });
  });
  const result = await connector.createLink(p);
  assert.equal(result.orderNsu, p.paymentId); assert.equal(result.exclusivePix, false);
  assert.equal(result.directQrAvailable, false); assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes(fakeKey), false);
  assert.equal(JSON.stringify(new InfinitePayTransport(fakeKey, async () => json({}))).includes(fakeKey), false);
});

test('receiver, amount, ID, expiration and redirects are refused before any provider request', async () => {
  let calls = 0; const connector = fixture(async () => { calls++; return json({}); });
  for (const change of [{ receiverId: 'attacker' }, { amountCents: 0 }, { amountCents: 1.5 }, { amountCents: 10001 },
    { paymentId: '../admin' }, { expiresAt: 'not-a-date' }, { expiresAt: '2026-10-25T11:00:00Z' },
    { expiresAt: '2026-10-27T13:00:00Z' }]) {
    await assert.rejects(connector.createLink({ ...intent(), ...change }));
  }
  for (const redirectUrl of ['http://portal.example.com/', 'https://user:password@portal.example.com/',
    'https://127.0.0.1/', 'https://localhost/', 'https://portal.example.com/?next=evil']) {
    assert.throws(() => new InfinitePayCheckout({ ...account, redirectUrl },
      new InfinitePayTransport(fakeKey, async () => json({}))));
  }
  assert.equal(calls, 0);
});

test('malicious, conflicting or wrong-receiver checkout URLs are uncertain, never exposed', async () => {
  for (const body of [
    { checkout_url: 'https://evil.example.com/merchant-contract/a' },
    { checkout_url: 'https://checkout.infinitepay.io.evil.example.com/merchant-contract/a' },
    { checkout_url: 'https://checkout.infinitepay.io@evil.example.com/merchant-contract/a' },
    { checkout_url: 'http://checkout.infinitepay.io/merchant-contract/a' },
    { checkout_url: 'https://checkout.infinitepay.io/other-receiver/a' },
    { checkout_url: 'https://checkout.infinitepay.io/merchant-contract/a?redirect=https://evil.example.com' },
    { checkout_url: 'https://checkout.infinitepay.io/merchant-contract/a', url: 'https://evil.example.com/a' },
    { checkout_url: 'https://checkout.infinitepay.io/merchant-contract/a', order_nsu: randomUUID() },
    { checkout_url: ['https://checkout.infinitepay.io/merchant-contract/a'] }, {}, [], null,
  ]) {
    await assert.rejects(fixture(async () => json(body)).createLink(intent()), { code: 'CREATE_RESULT_UNCERTAIN' });
  }
});

test('creation transport errors never retry and never leak provider payload or credentials', async () => {
  for (const response of [json({ secret: fakeKey }, 500), json({ secret: fakeKey }, 400),
    new Response('<html>private upstream message</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    json({ url: 'x'.repeat(40000) }),
  ]) {
    let calls = 0;
    await assert.rejects(fixture(async () => { calls++; return response; }).createLink(intent()), error => {
      assert.equal((error as Error).message, 'CREATE_RESULT_UNCERTAIN');
      assert.equal(String(error).includes(fakeKey), false); return true;
    });
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(fixture(async () => { calls++; throw new Error(`network failure ${fakeKey}`); }).createLink(intent()),
    { code: 'CREATE_RESULT_UNCERTAIN' });
  assert.equal(calls, 1);
});

test('payment is checked with server credential and bound receipt hints, never with receipt_url', async () => {
  const p = intent(), transactionNsu = randomUUID();
  const connector = fixture(async (url, options) => {
    assert.equal(url, 'https://api.checkout.infinitepay.io/payment_check');
    assert.deepEqual(JSON.parse(String(options.body)), {
      handle: account.handle, order_nsu: p.paymentId, transaction_nsu: transactionNsu, slug: 'fixture-slug',
    });
    assert.equal((options.headers as Record<string, string>)['X-Api-Key'], fakeKey);
    return json(paid);
  });
  assert.deepEqual(await connector.checkPayment(p, { orderNsu: p.paymentId, transactionNsu, slug: 'fixture-slug' }), {
    state: 'PAID_PIX', orderNsu: p.paymentId, transactionNsu, amountCents: 1500, paidAmountCents: 1500,
  });
});

test('mismatched order, invalid transaction or unsafe slug do not reach the provider', async () => {
  let calls = 0; const connector = fixture(async () => { calls++; return json(paid); });
  const p = intent(), hints = { orderNsu: p.paymentId, transactionNsu: randomUUID(), slug: 'fixture' };
  for (const change of [{ orderNsu: randomUUID() }, { transactionNsu: '../payments' }, { slug: 'https://127.0.0.1/' },
    { slug: 'x'.repeat(129) }]) {
    await assert.rejects(connector.checkPayment(p, { ...hints, ...change }), { code: 'INVALID_CHECKOUT_HINTS' });
  }
  assert.equal(calls, 0);
});

test('pending remains pending, late confirmation is allowed and card or amount mismatch requires review', async () => {
  const p = { ...intent(), expiresAt: '2026-10-25T11:00:00Z' };
  const hints = { orderNsu: p.paymentId, transactionNsu: randomUUID(), slug: 'fixture' };
  assert.equal((await fixture(async () => json({ success: true, paid: false })).checkPayment(p, hints)).state, 'PENDING');
  assert.equal((await fixture(async () => json(paid)).checkPayment(p, hints)).state, 'PAID_PIX');
  for (const change of [{ capture_method: 'credit_card' }, { amount: 1499 }, { paid_amount: 1510 },
    { paid_amount: '1500' }, { paid_amount: 1500.1 }, { installments: 2 }, { amount: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal((await fixture(async () => json({ ...paid, ...change })).checkPayment(p, hints)).state, 'REVIEW_REQUIRED');
  }
});

test('invalid or conflicting provider responses never confirm a payment', async () => {
  const p = intent(), hints = { orderNsu: p.paymentId, transactionNsu: randomUUID(), slug: 'fixture' };
  for (const change of [{ success: 'true' }, { success: false }, { paid: 'true' }, { order_nsu: randomUUID() },
    { transaction_nsu: randomUUID() }, { handle: 'other-account' }, { currency: 'USD' }, { slug: 'other-slug' }]) {
    await assert.rejects(fixture(async () => json({ ...paid, ...change })).checkPayment(p, hints), { code: 'UNSAFE_PROVIDER_RESPONSE' });
  }
});

test('check failures are sanitized and only fixed official endpoints are requested', async () => {
  const p = intent(), hints = { orderNsu: p.paymentId, transactionNsu: randomUUID(), slug: 'fixture' };
  assert.throws(() => new InfinitePayTransport('', async () => json({})));
  await assert.rejects(fixture(async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.checkout.infinitepay.io');
    assert.equal(options.redirect, 'error'); throw new Error(`private upstream ${fakeKey}`);
  }).checkPayment(p, hints), { code: 'PROVIDER_UNAVAILABLE' });
  await assert.rejects(fixture(async () => json({}, 302)).checkPayment(p, hints), { code: 'PROVIDER_UNAVAILABLE' });
  await assert.rejects(fixture(async () => new Response('{}', { headers: {
    'content-type': 'application/json', 'content-length': '999999',
  } })).checkPayment(p, hints), { code: 'UNSAFE_PROVIDER_RESPONSE' });
});
