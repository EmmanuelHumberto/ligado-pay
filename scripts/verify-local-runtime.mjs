import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';

const configFile = resolve('.local/runtime.json');
const config = JSON.parse(await readFile(configFile, 'utf8'));
const client = JSON.parse(await readFile('.local/client.json', 'utf8'));
const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000 });
let processHandle;
try {
  const role = (await pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.equal(Object.values(role).some(Boolean), false);
  const privileges = (await pool.query(`SELECT
    has_table_privilege(current_user,'payment_events','UPDATE') AS update_events,
    has_table_privilege(current_user,'payment_events','DELETE') AS delete_events,
    has_table_privilege(current_user,'payment_events','TRUNCATE') AS truncate_events,
    has_column_privilege(current_user,'payments','amount_cents','UPDATE') AS update_amount,
    has_column_privilege(current_user,'payments','receiver_id','UPDATE') AS update_receiver,
    has_schema_privilege(current_user,'public','CREATE') AS create_objects`)).rows[0];
  assert.equal(Object.values(privileges).some(Boolean), false);
  let output = '';
  processHandle = spawn(process.execPath, ['dist/src/main.js'], {
    env: { ...process.env, NODE_ENV: 'development', LIGADO_PAY_CONFIG_FILE: configFile }, stdio: ['ignore','pipe','pipe'],
  });
  processHandle.stdout.on('data', data => { output += data.toString(); });
  processHandle.stderr.on('data', () => {});
  for (let attempt = 0; attempt < 30 && !output.includes('listening on'); attempt++) {
    if (processHandle.exitCode !== null) throw new Error('Local API exited during startup.');
    await delay(100);
  }
  assert.match(output, /listening on 127.0.0.1/);
  const origin = `http://127.0.0.1:${config.port}`;
  const request = (path, options = {}) => fetch(origin + path, { ...options, signal: AbortSignal.timeout(3000) });
  const live = await request('/health/live'); assert.equal(live.status, 200);
  const unauthorized = await request('/health/ready'); assert.equal(unauthorized.status, 401);
  const reference = `runtime-${randomUUID()}`;
  const headers = { authorization: `Bearer ${client.token}`, 'content-type': 'application/json', 'idempotency-key': reference };
  const ready = await request('/health/ready', { headers }); assert.equal(ready.status, 200);
  const body = JSON.stringify({ receiverId: client.receiverId, externalReference: reference, amountCents: 100, currency: 'BRL', method: 'pix' });
  const created = await request('/v1/payments', { method: 'POST', headers, body });
  assert.equal(created.status, 201);
  const payment = await created.json();
  assert.equal(payment.simulated, true); assert.equal(payment.realPaymentsEnabled, false);
  const read = await request(`/v1/payments/${payment.id}`, { headers }); assert.equal(read.status, 200);
  const replay = await request('/v1/payments', { method: 'POST', headers, body }); assert.equal(replay.status, 200);
  assert.equal((await replay.json()).id, payment.id);
  console.log(JSON.stringify({ result: 'PASSOU', restrictedDatabaseRole: true, loopback: true,
    unauthorizedRejected: true, simulatedPayment: true, realPaymentsEnabled: false, replaySamePayment: true }));
} finally {
  if (processHandle && processHandle.exitCode === null) {
    const ended = new Promise(resolveEnd => processHandle.once('exit', resolveEnd));
    processHandle.kill(); await ended;
  }
  await pool.end();
}
