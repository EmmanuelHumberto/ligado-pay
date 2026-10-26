export const idempotencyKey = { type: 'string', minLength: 16, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' };
export const paymentBody = {
  type: 'object', additionalProperties: false,
  required: ['receiverId','externalReference','amountCents','currency','method'], properties: {
    receiverId: { type: 'string', pattern: '^[a-z][a-z0-9_-]{2,63}$' },
    externalReference: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' },
    amountCents: { type: 'integer', minimum: 1, maximum: 100_000_000 },
    currency: { const: 'BRL' }, method: { const: 'pix' },
  },
};
