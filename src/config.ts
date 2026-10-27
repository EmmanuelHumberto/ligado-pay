import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Principal } from './domain/payment.js';

export interface Credential extends Principal { keyHash: string }
export interface Config {
  databaseUrl: string;
  port: number;
  credentials: Credential[];
  provider: 'simulated' | 'infinitepay';
  infinitepay?: { receiverId: string; handle: string; redirectUrl: string; apiKeyFile: string; liveCreationEnabled: boolean;
    webhookUrl?:string; webhookApplicationId?:string; notificationProxyKeyFile?:string };
}
const identifier = /^[a-z][a-z0-9_-]{2,63}$/;
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;

export function parseConfig(value: unknown, nodeEnv: string | undefined): Config {
  const fail = (): never => { throw new Error('Invalid local configuration. Production is not supported.'); };
  if (nodeEnv === 'production' || !value || typeof value !== 'object') return fail();
  const raw = value as Record<string, unknown>;
  const simulated = raw['mode'] === 'local' && raw['provider'] === 'simulated' && raw['environment'] === 'sandbox';
  const infinite = raw['mode'] === 'local' && raw['provider'] === 'infinitepay' && raw['environment'] === 'production';
  if (!simulated && !infinite) return fail();
  if (typeof raw['databaseUrl'] !== 'string' || !integer(raw['port'], 1024, 65535)) return fail();
  let url: URL;
  try { url = new URL(raw['databaseUrl']); } catch { return fail(); }
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
      !/^\/ligado_pay_[a-z0-9_]+$/.test(url.pathname) || !url.password || url.search || url.hash) return fail();
  if (!Array.isArray(raw['credentials']) || !raw['credentials'].length || raw['credentials'].length > 20) return fail();
  const hashes = new Set<string>();
  const applications = new Set<string>();
  const credentials: Credential[] = [];
  for (const item of raw['credentials']) {
    if (!item || typeof item !== 'object') return fail();
    const c = item as Record<string, unknown>;
    if (typeof c['applicationId'] !== 'string' || !identifier.test(c['applicationId']) ||
        typeof c['keyHash'] !== 'string' || !/^[a-f0-9]{64}$/.test(c['keyHash']) ||
        !Array.isArray(c['receiverIds']) || !c['receiverIds'].length || c['receiverIds'].length > 10 ||
        !c['receiverIds'].every((v: unknown) => typeof v === 'string' && identifier.test(v)) ||
        !Array.isArray(c['permissions']) || !c['permissions'].length ||
        !c['permissions'].every((v: unknown) => v === 'payments:create' || v === 'payments:read' || v === 'payments:check' || v === 'payments:operations') ||
        !integer(c['maxAmountCents'], 1, 100_000_000) || !integer(c['requestsPerMinute'], 1, 600) ||
        hashes.has(c['keyHash']) || applications.has(c['applicationId'])) return fail();
    hashes.add(c['keyHash']); applications.add(c['applicationId']);
    if (c['maxPayments'] !== undefined && !integer(c['maxPayments'], 1, 100000)) return fail();
    for(const field of ['readRequestsPerMinute','checkRequestsPerMinute'])if(c[field]!==undefined&&!integer(c[field],1,10000))return fail();
    credentials.push({ applicationId: c['applicationId'], keyHash: c['keyHash'],
      receiverIds: [...c['receiverIds']] as string[], permissions: [...c['permissions']] as Credential['permissions'],
      maxAmountCents: c['maxAmountCents'], requestsPerMinute: c['requestsPerMinute'],
      ...(c['readRequestsPerMinute']===undefined?{}:{readRequestsPerMinute:c['readRequestsPerMinute'] as number}),
      ...(c['checkRequestsPerMinute']===undefined?{}:{checkRequestsPerMinute:c['checkRequestsPerMinute'] as number}),
      ...(c['maxPayments'] === undefined ? {} : {maxPayments: c['maxPayments'] as number}) });
  }
  const result: Config = { databaseUrl: raw['databaseUrl'], port: raw['port'], credentials,
    provider: infinite ? 'infinitepay' : 'simulated' };
  if (infinite) {
    const c = raw['infinitepay'] as Record<string, unknown> | undefined;
    if (!c || typeof c['receiverId'] !== 'string' || !identifier.test(c['receiverId']) ||
        typeof c['handle'] !== 'string' || !/^[A-Za-z0-9_-]{3,80}$/.test(c['handle']) ||
        typeof c['redirectUrl'] !== 'string' || typeof c['apiKeyFile'] !== 'string' || !isAbsolute(c['apiKeyFile']) ||
        typeof c['liveCreationEnabled'] !== 'boolean' ||
        !credentials.every(credential => credential.receiverIds.every(id => id === c['receiverId']))) return fail();
    result.infinitepay = { receiverId: c['receiverId'], handle: c['handle'], redirectUrl: c['redirectUrl'],
      apiKeyFile: c['apiKeyFile'], liveCreationEnabled: c['liveCreationEnabled'] };
    if(c['notificationProxyKeyFile']!==undefined){
      if(typeof c['notificationProxyKeyFile']!=='string'||!isAbsolute(c['notificationProxyKeyFile']))return fail();
      result.infinitepay.notificationProxyKeyFile=c['notificationProxyKeyFile'];
    }
    if(c['webhookUrl']!==undefined||c['webhookApplicationId']!==undefined){
      if(typeof c['webhookUrl']!=='string'||typeof c['webhookApplicationId']!=='string')return fail();
      let hook:URL,redirect:URL;
      try{hook=new URL(c['webhookUrl']);redirect=new URL(c['redirectUrl']);}catch{return fail();}
      const principal=credentials.find(p=>p.applicationId===c['webhookApplicationId']);
      if(hook.protocol!=='https:'||hook.origin!==redirect.origin||hook.pathname!=='/ligado-pay/webhooks/infinitepay'||
        hook.search||hook.hash||hook.username||hook.password||!principal||
        !principal.permissions.includes('payments:read')||!principal.permissions.includes('payments:check'))return fail();
      result.infinitepay.webhookUrl=hook.href;result.infinitepay.webhookApplicationId=principal.applicationId;
    }
  }
  return result;
}

export function loadConfig() {
  const path = process.env['LIGADO_PAY_CONFIG_FILE'];
  if (!path) throw new Error('LIGADO_PAY_CONFIG_FILE is required.');
  try { return parseConfig(JSON.parse(readFileSync(path, 'utf8')), process.env['NODE_ENV']); }
  catch { throw new Error('Invalid local configuration. Production is not supported.'); }
}
