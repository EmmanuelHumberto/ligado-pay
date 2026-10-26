import pg from 'pg';
import { loadConfig } from './config.js';
import { PostgresRepository } from './infrastructure/postgres-repository.js';
import { SimulatedProvider } from './infrastructure/simulated-provider.js';
import { createServer } from './http/server.js';

let pool: pg.Pool | undefined;
try {
  const config = loadConfig();
  pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10_000, statement_timeout: 5000, lock_timeout: 3000 });
  pool.on('error', () => { console.error('Database connection unavailable.'); });
  const role = await pool.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolbypassrls: boolean }>(
    'SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  if (!role.rows[0] || Object.values(role.rows[0]).some(Boolean)) throw new Error('Privileged role refused.');
  const repository = new PostgresRepository(pool);
  await repository.ready();
  const api = createServer(repository, new SimulatedProvider(), config.credentials);
  await api.listen({ port: config.port, host: '127.0.0.1' });
  console.log(`Ligado Pay local sandbox listening on 127.0.0.1:${config.port}. Real payments disabled.`);
  const stop = async () => { await api.close(); await pool?.end(); };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
} catch {
  console.error('Startup refused. Check local configuration, database permissions and migrations.');
  await pool?.end(); process.exitCode = 1;
}
