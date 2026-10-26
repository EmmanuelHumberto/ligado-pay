import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../config.js';

export async function migrate(pool: pg.Pool, directory = resolve('migrations')) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('ligado-pay-migrations',0))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations
      (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    const names = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const name of names) {
      const source = await readFile(resolve(directory, name), 'utf8');
      const hash = createHash('sha256').update(source).digest('hex');
      const applied = await client.query<{ sha256: string }>('SELECT sha256 FROM schema_migrations WHERE name=$1', [name]);
      if (applied.rows[0]) {
        if (applied.rows[0].sha256 !== hash) throw new Error('Migration checksum mismatch.');
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(source);
        await client.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)', [name, hash]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended('ligado-pay-migrations',0))").catch(() => undefined);
    client.release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let pool: pg.Pool | undefined;
  try {
    pool = new pg.Pool({ connectionString: loadConfig().databaseUrl, connectionTimeoutMillis: 3000,
      max: 1, statement_timeout: 10_000, lock_timeout: 3000 });
    await migrate(pool);
    console.log('Local migrations applied.');
  } catch { console.error('Migration failed. Check local configuration and migration checksums.'); process.exitCode = 1; }
  finally { await pool?.end(); }
}
