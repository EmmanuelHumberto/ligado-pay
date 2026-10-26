import { CheckoutError } from '../../application/checkout-connector.js';
import { normalizeInfinitePayCredential } from './credential.js';

/** Injected only by an explicit composition root; live creation remains an explicit configuration. */
export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;
export type InfinitePayOperation = 'create-link' | 'check-payment';
const paths = { 'create-link': '/links', 'check-payment': '/payment_check' } as const;
const origin = 'https://api.checkout.infinitepay.io';

async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(type) || !response.body) throw new CheckoutError('UNSAFE_PROVIDER_RESPONSE');
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 32768)) {
    await response.body.cancel(); throw new CheckoutError('UNSAFE_PROVIDER_RESPONSE');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 32768) { await reader.cancel(); throw new CheckoutError('UNSAFE_PROVIDER_RESPONSE'); }
      chunks.push(chunk.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
    catch { throw new CheckoutError('UNSAFE_PROVIDER_RESPONSE'); }
  } finally { reader.releaseLock(); }
}

export class InfinitePayTransport {
  readonly #key: string;
  readonly #fetch: ProviderFetch;

  constructor(apiKey: string, fetchImplementation: ProviderFetch) {
    // A key is mandatory even though a legacy, unauthenticated link flow exists.
    this.#key = normalizeInfinitePayCredential(apiKey); this.#fetch = fetchImplementation;
  }

  async post(operation: InfinitePayOperation, body: object): Promise<unknown> {
    const signal = AbortSignal.timeout(8000);
    try {
      const response = await this.#fetch(origin + paths[operation], {
        method: 'POST', redirect: 'error', signal,
        headers: { 'X-Api-Key': this.#key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status !== 200 && response.status !== 201) {
        await response.body?.cancel(); throw new CheckoutError('PROVIDER_UNAVAILABLE');
      }
      return await readJson(response);
    } catch (error) {
      // Creation may have succeeded before *any* transport/parse failure. Never retry it here.
      if (operation === 'create-link') throw new CheckoutError('CREATE_RESULT_UNCERTAIN');
      if (error instanceof CheckoutError) throw error;
      throw new CheckoutError('PROVIDER_UNAVAILABLE');
    }
  }
}
