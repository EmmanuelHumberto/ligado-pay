import { createHash, timingSafeEqual } from 'node:crypto';
import type { Credential } from '../config.js';
import type { Principal } from '../domain/payment.js';

export function authenticate(header: string | undefined, credentials: readonly Credential[], now = Date.now()): Principal | null {
  if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) return null;
  const hash = createHash('sha256').update(header.slice(7)).digest();
  let found: Credential | undefined;
  for (const credential of credentials) {
    const matches = timingSafeEqual(hash, Buffer.from(credential.keyHash, 'hex'));
    const active = Number.isFinite(now) &&
      (credential.notBefore === undefined || now >= Date.parse(credential.notBefore)) &&
      (credential.expiresAt === undefined || now < Date.parse(credential.expiresAt)) &&
      (credential.revokedAt === undefined || now < Date.parse(credential.revokedAt));
    if (matches && active) found = credential;
  }
  if (!found) return null;
  // Never attach the credential hash to the request or response.
  return { applicationId: found.applicationId, receiverIds: found.receiverIds, permissions: found.permissions,
    maxAmountCents: found.maxAmountCents, requestsPerMinute: found.requestsPerMinute,
    ...(found.readRequestsPerMinute===undefined?{}:{readRequestsPerMinute:found.readRequestsPerMinute}),
    ...(found.checkRequestsPerMinute===undefined?{}:{checkRequestsPerMinute:found.checkRequestsPerMinute}),
    ...(found.maxPayments === undefined ? {} : {maxPayments: found.maxPayments}) };
}

export class IngressLimiter {
  private readonly buckets = new Map<string, { window: number; attempts: number }>();
  allow(ip: string, now = Date.now()) {
    const window = Math.floor(now / 60_000);
    if (this.buckets.size >= 10_000) {
      for (const [key, value] of this.buckets) if (value.window !== window) this.buckets.delete(key);
      if (!this.buckets.has(ip) && this.buckets.size >= 10_000) return false;
    }
    const bucket = this.buckets.get(ip);
    if (!bucket || bucket.window !== window) {
      this.buckets.set(ip, { window, attempts: 1 }); return true;
    }
    bucket.attempts = Math.min(bucket.attempts + 1, 121);
    return bucket.attempts <= 120;
  }
}
