import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/infinitepay-live-validation.mjs');
const helpers = () => import(pathToFileURL(script).href);
const config = () => ({ provider: 'infinitepay', credentials: [{ applicationId: 'app-test',
  receiverIds: ['receiver-test'], maxAmountCents: 500, permissions: ['payments:create'] }],
  infinitepay: { receiverId: 'receiver-test', handle: 'emmanuel-humberto',
    liveCreationEnabled: false, redirectUrl: 'https://os.ligadotattoo.com.br/portal' } });

test('live validation plan pins account, amount and effects and refuses unreviewed configuration', async () => {
  const { validationPlan } = await helpers();
  const original = config();
  const before = JSON.stringify(original);
  const plan = validationPlan(original);
  assert.equal(plan.amountCents, 100);
  assert.equal(plan.maximumProviderRequests, 1);
  assert.equal(plan.automaticPayment, false);
  assert.equal(plan.webhookRegistration, false);
  assert.equal(plan.customerNotification, false);
  assert.equal(plan.permanentCreationEnabled, false);
  assert.equal(JSON.stringify(original), before);
  for (const change of [{ handle: 'another-account' }, { liveCreationEnabled: true },
    { redirectUrl: 'https://evil.example.com/' }, { receiverId: 'another-receiver' }]) {
    assert.throws(() => validationPlan({ ...original, infinitepay: { ...original.infinitepay, ...change } }));
  }
  assert.throws(() => validationPlan({ ...original, provider: 'simulated' }));
  assert.throws(() => validationPlan({ ...original, credentials: [] }));
});

test('exclusive durable marker blocks concurrent validation and retry after uncertain failure', async () => {
  const { oneAttempt } = await helpers();
  const directory = await mkdtemp(join(tmpdir(), 'ligado-validation-'));
  const marker = join(directory, 'attempt.jsonl');
  let calls = 0;
  try {
    const create = async (reference: string) => {
      calls++;
      const record = JSON.parse(await readFile(marker, 'utf8'));
      assert.equal(record.reference, reference);
      assert.equal(record.status, 'ATTEMPT_RESERVED_DO_NOT_REPEAT');
      throw new Error('synthetic timeout after upstream creation');
    };
    const results = await Promise.allSettled([
      oneAttempt(marker, { amountCents: 100 }, create), oneAttempt(marker, { amountCents: 100 }, create),
    ]);
    assert.ok(results.every(result => result.status === 'rejected'));
    assert.equal(calls, 1);
    await assert.rejects(oneAttempt(marker, { amountCents: 100 }, create));
    assert.equal(calls, 1);
  } finally { await unlink(marker); await rmdir(directory); }
});

test('completed validation appends result and also prevents a second creation', async () => {
  const { oneAttempt } = await helpers();
  const directory = await mkdtemp(join(tmpdir(), 'ligado-validation-'));
  const marker = join(directory, 'attempt.jsonl');
  try {
    const result = await oneAttempt(marker, { amountCents: 100 }, async () => ({ state: 'PENDING' }));
    assert.equal(result.state, 'PENDING');
    const lines = (await readFile(marker, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines[1].result.state, 'PENDING');
    await assert.rejects(oneAttempt(marker, {}, async () => assert.fail('duplicate operation')));
  } finally { await unlink(marker); await rmdir(directory); }
});

test('execution without explicit operation confirmation fails before loading any configuration or key', () => {
  const result = spawnSync(process.execPath, [script, '--execute'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No secret displayed/);
  assert.equal(result.stdout, '');
});
