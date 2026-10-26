import pg from 'pg';
import { loadConfig } from './config.js';
import { PostgresRepository } from './infrastructure/postgres-repository.js';
import { SimulatedProvider } from './infrastructure/simulated-provider.js';
import { createServer } from './http/server.js';
import { loadProviderSecret } from './infrastructure/provider-secret.js';
import { InfinitePayTransport } from './infrastructure/infinitepay/transport.js';
import { InfinitePayCheckout } from './infrastructure/infinitepay/checkout.js';
import { CheckoutService } from './application/checkout-service.js';
import { PostgresCheckoutRepository } from './infrastructure/postgres-checkout-repository.js';

let pool: pg.Pool | undefined;
try {
  const config = loadConfig();
  pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10_000, statement_timeout: 5000, lock_timeout: 3000 });
  pool.on('error', () => { console.error('Database connection unavailable.'); });
  const role = await pool.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolbypassrls: boolean }>(
    'SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  if (!role.rows[0] || Object.values(role.rows[0]).some(Boolean)) throw new Error('Privileged role refused.');
  const settings = config.infinitepay;
  const repository = settings ? new PostgresCheckoutRepository(pool, settings.handle) : new PostgresRepository(pool);
  await repository.ready();
  let checkout: CheckoutService | undefined;
  if (settings && repository instanceof PostgresCheckoutRepository) {
    const apiKey = loadProviderSecret(settings.apiKeyFile);
    const connector = new InfinitePayCheckout({ ...settings,
      maxAmountCents: Math.max(...config.credentials.map(credential => credential.maxAmountCents)) },
    new InfinitePayTransport(apiKey, fetch));
    checkout = new CheckoutService(repository, connector, settings.receiverId, settings.liveCreationEnabled);
  }
  const api = createServer(repository, new SimulatedProvider(), config.credentials, checkout);
  await api.listen({ port: config.port, host: '127.0.0.1' });
  console.log(`Ligado Pay listening on 127.0.0.1:${config.port}. Provider: ${config.provider}. Live creation: ${checkout?.creationEnabled ?? false}.`);
  const stop = async () => { await api.close(); await pool?.end(); };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
} catch {
  console.error('Startup refused. Check local configuration, database permissions and migrations.');
  await pool?.end(); process.exitCode = 1;
}
