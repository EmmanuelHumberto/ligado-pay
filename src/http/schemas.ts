export const idempotencyKey = { type: 'string', minLength: 16, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' };
export const operationBody={type:'object',additionalProperties:false,required:['kind','reasonCode'],properties:{
  kind:{enum:['REFUND_REQUEST','CANCEL_REQUEST','EVIDENCE_RECORDED']},reasonCode:{type:'string',pattern:'^[A-Z_]{3,64}$'},
  amountCents:{type:'integer',minimum:1,maximum:100000000},evidenceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'}}};
export const referenceParams = {
  type: 'object', additionalProperties: false, required: ['receiverId','externalReference'], properties: {
    receiverId: { type: 'string', pattern: '^[a-z][a-z0-9_-]{2,63}$' },
    externalReference: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' },
  },
};
export const checkoutHintsBody = {
  type: 'object', additionalProperties: false, required: ['orderNsu','transactionNsu','slug'], properties: {
    orderNsu: { type: 'string', format: 'uuid' }, transactionNsu: { type: 'string', format: 'uuid' },
    slug: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
  },
};
export const paymentBody = {
  type: 'object', additionalProperties: false,
  required: ['receiverId','externalReference','amountCents','currency','method'], properties: {
    receiverId: { type: 'string', pattern: '^[a-z][a-z0-9_-]{2,63}$' },
    externalReference: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' },
    amountCents: { type: 'integer', minimum: 1, maximum: 100_000_000 },
    currency: { const: 'BRL' }, method: { const: 'pix' },
  },
};
