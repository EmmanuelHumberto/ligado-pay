import policy from '../../../contracts/infinitepay-credential-policy.json' with { type: 'json' };

/** Credentials are opaque. Syntax checks prevent unsafe headers, not validate the provider account. */
export function normalizeInfinitePayCredential(input: string): string {
  const key = input.trim();
  if (!key || key.length > policy.maxLength || !new RegExp(policy.pattern).test(key)) {
    throw new Error('Invalid InfinitePay credential.');
  }
  return key;
}
