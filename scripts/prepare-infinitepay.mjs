import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseConfig } from '../dist/src/config.js';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--handle' || args[2] !== '--redirect') {
  throw new Error('Usage: node scripts/prepare-infinitepay.mjs --handle YOUR_INFINITETAG --redirect https://YOUR_DOMAIN/payment-return');
}
const base = JSON.parse(await readFile('.local/runtime.json', 'utf8'));
if (base.provider !== 'simulated' || base.environment !== 'sandbox') throw new Error('Expected the original local configuration.');
const receiverId = base.credentials[0]?.receiverIds[0];
const config = { ...base, provider: 'infinitepay', environment: 'production',
  credentials: base.credentials.map(credential => ({ ...credential, receiverIds: [receiverId],
    permissions: [...new Set([...credential.permissions, 'payments:check'])] })),
  infinitepay: { receiverId, handle: args[1], redirectUrl: args[3], liveCreationEnabled: false,
    apiKeyFile: process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA, 'LigadoTattoo/LigadoPay/infinitepay.dpapi')
      : resolve('.local/infinitepay.key') },
};
parseConfig(config, process.env.NODE_ENV);
await writeFile('.local/infinitepay.runtime.json', JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log('InfinitePay configuration prepared. Live creation is disabled; existing runtime.json was not changed. No network calls made.');
