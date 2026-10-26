import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { migrate } from '../dist/src/infrastructure/migrate.js';
import { parseConfig } from '../dist/src/config.js';

const read = async name => JSON.parse(await readFile(new URL(`../.local/${name}`, import.meta.url), 'utf8'));
const admin = parseConfig(await read('migrations.json'), process.env.NODE_ENV);
const runtime = parseConfig(await read('runtime.json'), process.env.NODE_ENV);
const pool = new pg.Pool({ connectionString: admin.databaseUrl, max: 1, connectionTimeoutMillis: 3000 });
try {
  await migrate(pool);
  const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname='ligado_pay_runtime'");
  if (!role.rowCount) {
    const password = new URL(runtime.databaseUrl).password;
    if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid local runtime password.');
    // Password generated locally, strictly hex; never accept SQL identifiers/passwords from API input.
    await pool.query(`CREATE ROLE ligado_pay_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  }
  await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await pool.query('GRANT USAGE ON SCHEMA public TO ligado_pay_runtime');
  await pool.query('REVOKE ALL ON payments,request_limits,payment_events,outbox FROM ligado_pay_runtime');
  await pool.query('GRANT SELECT, INSERT ON payments,request_limits TO ligado_pay_runtime');
  await pool.query('GRANT UPDATE(state,provider_reference,updated_at,checkout_url,review_reason) ON payments TO ligado_pay_runtime');
  await pool.query('GRANT SELECT, INSERT ON provider_settlements TO ligado_pay_runtime');
  await pool.query('GRANT UPDATE(attempts) ON request_limits TO ligado_pay_runtime');
  await pool.query('GRANT SELECT, INSERT ON payment_events TO ligado_pay_runtime');
  await pool.query('GRANT SELECT, INSERT ON outbox TO ligado_pay_runtime');
  await pool.query('GRANT UPDATE(delivered_at,attempts) ON outbox TO ligado_pay_runtime');
  const test = await pool.query("SELECT 1 FROM pg_database WHERE datname='ligado_pay_test'");
  if (!test.rowCount) await pool.query('CREATE DATABASE ligado_pay_test');
  console.log('Local migrations, restricted runtime role and isolated test database ready.');
} catch { console.error('Local bootstrap failed. No credentials printed.'); process.exitCode = 1; }
finally { await pool.end(); }
