import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const directory = await mkdtemp(resolve('.local/infinitepay-runtime-check-'));
const keyPath = join(directory, process.platform === 'win32' ? 'fixture.dpapi' : 'fixture.key');
const configPath = join(directory, 'runtime.json');
const fixtureKey = `inchk_${randomBytes(32).toString('hex')}`;
let handle;
try {
  let stored = fixtureKey;
  if (process.platform === 'win32') {
    const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    stored = execFileSync(powershell, ['-NoProfile','-NonInteractive','-Command',
      '$s=[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force; ConvertFrom-SecureString $s'], {
      env: { ...process.env, PSModulePath: join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') },
      input: fixtureKey, encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'],
    }).trim();
  }
  await writeFile(keyPath, stored, { mode: 0o600 });
  const base = JSON.parse(await readFile('.local/runtime.json', 'utf8'));
  const client = JSON.parse(await readFile('.local/client.json', 'utf8'));
  const config = { ...base, provider: 'infinitepay', environment: 'production',
    infinitepay: { receiverId: client.receiverId, handle: 'merchant-contract',
      redirectUrl: 'https://portal.example.com/payment-return', apiKeyFile: keyPath, liveCreationEnabled: false } };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  let output = '', errors = '';
  // Stronger than a mock credential: this child cannot make a provider request at all.
  const noNetwork = 'data:text/javascript,' + encodeURIComponent(
    'globalThis.fetch=()=>{console.error("UNEXPECTED_OUTBOUND_REQUEST");throw new Error("network disabled for check")};');
  handle = spawn(process.execPath, ['--import', noNetwork, 'dist/src/main.js'], {
    env: { ...process.env, NODE_ENV: 'development', LIGADO_PAY_CONFIG_FILE: configPath }, stdio: ['ignore','pipe','pipe'],
  });
  handle.stdout.on('data', data => { output += data.toString(); });
  handle.stderr.on('data', data => { errors += data.toString(); });
  for (let attempt = 0; attempt < 60 && !output.includes('listening on'); attempt++) {
    if (handle.exitCode !== null) throw new Error('InfinitePay composition failed to start.');
    await delay(100);
  }
  assert.match(output, /Provider: infinitepay. Live creation: false/);
  const origin = `http://127.0.0.1:${config.port}`;
  const headers = { authorization: `Bearer ${client.token}`, 'content-type': 'application/json', 'idempotency-key': 'composition-disabled-001' };
  const ready = await fetch(origin + '/health/ready', { headers, signal: AbortSignal.timeout(3000) });
  assert.equal(ready.status, 200);
  const info = await ready.json(); assert.equal(info.provider, 'infinitepay'); assert.equal(info.realPaymentsEnabled, false);
  const create = await fetch(origin + '/v1/payments', { method: 'POST', headers, signal: AbortSignal.timeout(3000),
    body: JSON.stringify({ receiverId: client.receiverId, externalReference: 'composition-check', amountCents: 100, currency: 'BRL', method: 'pix' }) });
  assert.equal(create.status, 503); assert.equal((await create.json()).error, 'LIVE_CREATION_DISABLED');
  assert.equal(errors.includes('UNEXPECTED_OUTBOUND_REQUEST'), false);
  assert.equal(output.includes(fixtureKey), false); assert.equal(errors.includes(fixtureKey), false);
  console.log(JSON.stringify({ result: 'PASSOU', provider: 'infinitepay', encryptedFixtureCredential: process.platform === 'win32',
    restrictedRuntimeRole: true, liveCreationDisabled: true, providerRequests: 0, realCredentialsUsed: false }));
} finally {
  if (handle && handle.exitCode === null) {
    const ended = new Promise(resolveEnd => handle.once('exit', resolveEnd)); handle.kill(); await ended;
  }
  for (const path of [keyPath, configPath]) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(directory);
}
