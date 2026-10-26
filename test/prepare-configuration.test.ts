import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('configuration helper never enables creation, overwrites files or writes a provider secret', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ligado-pay-prepare-'));
  const local = join(directory, '.local'); mkdirSync(local);
  const initial = JSON.stringify({ mode: 'local', provider: 'simulated', environment: 'sandbox', port: 3305,
    databaseUrl: 'postgresql://runtime:synthetic@127.0.0.1:55439/ligado_pay_test',
    credentials: [{ applicationId: 'app-fixture', receiverIds: ['receiver-fixture'], keyHash: 'd'.repeat(64),
      permissions: ['payments:create','payments:read'], maxAmountCents: 1000, requestsPerMinute: 10 }] });
  const source = join(local, 'runtime.json'), destination = join(local, 'infinitepay.runtime.json');
  const script = resolve('scripts/prepare-infinitepay.mjs');
  writeFileSync(source, initial, { mode: 0o600 });
  try {
    const args = [script, '--handle', 'merchant-contract', '--redirect', 'https://portal.example.com/payment-return'];
    const result = spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0);
    const output = readFileSync(destination, 'utf8');
    const config = JSON.parse(output) as { provider: string; environment: string; infinitepay: {
      liveCreationEnabled: boolean; apiKeyFile: string } };
    assert.equal(config.provider, 'infinitepay'); assert.equal(config.environment, 'production');
    assert.equal(config.infinitepay.liveCreationEnabled, false);
    assert.equal(typeof config.infinitepay.apiKeyFile, 'string');
    assert.equal(output.includes('inchk_'), false);
    assert.equal(readFileSync(source, 'utf8'), initial);
    assert.notEqual(spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8' }).status, 0);
    assert.equal(readFileSync(destination, 'utf8'), output);
  } finally {
    for (const path of [source, destination]) if (existsSync(path)) unlinkSync(path);
    rmdirSync(local); rmdirSync(directory);
  }
});
