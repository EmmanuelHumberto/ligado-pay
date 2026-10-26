import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('.local');
await mkdir(directory, { recursive: true });
try {
  await access(resolve(directory, 'runtime.json'));
  throw new Error('Local configuration already exists. No files overwritten.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const adminPassword = randomBytes(32).toString('hex');
const runtimePassword = randomBytes(32).toString('hex');
const token = randomBytes(32).toString('base64url');
const base = { mode: 'local', provider: 'simulated', environment: 'sandbox', port: 3305,
  credentials: [{ applicationId: 'systemos-local', receiverIds: ['ligado-local'],
    keyHash: createHash('sha256').update(token).digest('hex'), permissions: ['payments:create','payments:read'],
    maxAmountCents: 100000, requestsPerMinute: 60 }] };
const files = {
  'postgres.env': `POSTGRES_USER=postgres\nPOSTGRES_PASSWORD=${adminPassword}\nPOSTGRES_DB=ligado_pay_local\n`,
  'runtime.json': JSON.stringify({ ...base,
    databaseUrl: `postgresql://ligado_pay_runtime:${runtimePassword}@127.0.0.1:55439/ligado_pay_local` }, null, 2),
  'migrations.json': JSON.stringify({ ...base,
    databaseUrl: `postgresql://postgres:${adminPassword}@127.0.0.1:55439/ligado_pay_local` }, null, 2),
  'test-admin.json': JSON.stringify({ databaseUrl: `postgresql://postgres:${adminPassword}@127.0.0.1:55439/ligado_pay_test` }, null, 2),
  'client.json': JSON.stringify({ applicationId: 'systemos-local', receiverId: 'ligado-local', token }, null, 2),
};
for (const [name, content] of Object.entries(files)) {
  await writeFile(resolve(directory, name), content + '\n', { mode: 0o600, flag: 'wx' });
}
console.log('Local configuration created in .local/. Secrets were not printed. Protect this directory with your OS user ACL.');
