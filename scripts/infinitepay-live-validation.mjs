import { readFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseConfig } from '../dist/src/config.js';
import { loadProviderSecret } from '../dist/src/infrastructure/provider-secret.js';
import { InfinitePayCheckout } from '../dist/src/infrastructure/infinitepay/checkout.js';
import { InfinitePayTransport } from '../dist/src/infrastructure/infinitepay/transport.js';
import { PostgresCheckoutRepository } from '../dist/src/infrastructure/postgres-checkout-repository.js';
import { CheckoutService } from '../dist/src/application/checkout-service.js';

// This operator command is deliberately tied to the reviewed first operation.
// Changing amount/account/return requires a new reviewed plan, not CLI overrides.
export function validationPlan(config) {
  const settings = config.infinitepay;
  const principal = config.credentials[0];
  if (config.provider !== 'infinitepay' || !settings || settings.liveCreationEnabled ||
      settings.handle !== 'emmanuel-humberto' || settings.redirectUrl !== 'https://os.ligadotattoo.com.br/portal' ||
      !principal || !principal.permissions.includes('payments:create') || principal.maxAmountCents < 100 ||
      !principal.receiverIds.includes(settings.receiverId)) throw new Error('VALIDATION_CONFIGURATION_REFUSED');
  return { provider: 'infinitepay', account: settings.handle, receiverId: settings.receiverId,
    applicationId: principal.applicationId, amountCents: 100, currency: 'BRL',
    maximumProviderRequests: 1, requestedValidityMinutes: 60, singlePaymentRequested: true,
    paymentMethods: ['pix', 'credit_card'], redirectUrl: settings.redirectUrl,
    automaticPayment: false, webhookRegistration: false, customerNotification: false,
    permanentCreationEnabled: false };
}

export async function oneAttempt(markerPath, plan, create) {
  // Exclusive creation refuses concurrent execution and all subsequent retries.
  // Persist and fsync BEFORE entering code that can contact the provider.
  const marker = await open(markerPath, 'wx', 0o600);
  const reference = randomUUID();
  try {
    await marker.writeFile(JSON.stringify({ plan, reference, startedAt: new Date().toISOString(),
      status: 'ATTEMPT_RESERVED_DO_NOT_REPEAT' }) + '\n');
    await marker.sync();
    const result = await create(reference);
    // Append rather than erase the reservation. A crash leaves the attempt blocked.
    await marker.writeFile(JSON.stringify({ completedAt: new Date().toISOString(), result }) + '\n');
    await marker.sync();
    return result;
  } finally { await marker.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.length === 2 && args[0] === '--execute' && args[1] === '--confirm=CREATE_ONE_BRL_1_LINK';
  if (args.length && !execute) throw new Error('INVALID_ARGUMENTS');
  const config = parseConfig(JSON.parse(await readFile('.local/infinitepay.runtime.json', 'utf8')), process.env.NODE_ENV);
  const plan = validationPlan(config);
  if (!execute) {
    console.log(JSON.stringify({ mode: 'PLAN_ONLY', ...plan, providerRequests: 0 }));
    return;
  }
  const settings = config.infinitepay;
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1,
    connectionTimeoutMillis: 3000, statement_timeout: 5000, lock_timeout: 3000 });
  pool.on('error', () => {});
  try {
    const role = await pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    if (!role.rows[0] || Object.values(role.rows[0]).some(Boolean)) throw new Error('PRIVILEGED_ROLE_REFUSED');
    const repository = new PostgresCheckoutRepository(pool, settings.handle);
    await repository.ready();
    let requests = 0;
    let status = null;
    const transport = new InfinitePayTransport(loadProviderSecret(settings.apiKeyFile), async (url, init) => {
      if (requests !== 0 || url !== 'https://api.checkout.infinitepay.io/links' || init.method !== 'POST') {
        throw new Error('UNREVIEWED_PROVIDER_OPERATION');
      }
      requests++;
      const response = await fetch(url, init);
      status = response.status;
      return response;
    });
    const connector = new InfinitePayCheckout({ ...settings, maxAmountCents: 100 }, transport);
    const principal = { ...config.credentials[0], maxAmountCents: 100 };
    const service = new CheckoutService(repository, connector, settings.receiverId, true);
    const result = await oneAttempt(resolve('.local/infinitepay-validation-attempt.jsonl'), plan, async reference => {
      const created = await service.create(principal, { receiverId: settings.receiverId,
        externalReference: reference, amountCents: 100, currency: 'BRL', method: 'pix' }, reference);
      return { paymentId: created.payment.id, state: created.payment.state,
        checkoutUrl: created.payment.checkout?.url ?? null,
        requestedExpiresAt: created.payment.checkout?.expiresAt ?? null,
        providerRequests: requests, providerHttpStatus: status };
    });
    console.log(JSON.stringify(result));
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Validation stopped. No secret displayed. If the attempt file exists, do not repeat: reconcile the recorded reference first.');
    process.exitCode = 1;
  });
}
