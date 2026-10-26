import { readFile, writeFile } from 'node:fs/promises';
import { paymentBody, idempotencyKey } from '../dist/src/http/schemas.js';
const payment = { type: 'object', required: ['id','applicationId','receiverId','environment','externalReference',
  'amountCents','currency','state','providerReference','createdAt','provider','simulated','realPaymentsEnabled'],
  properties: {
    id: { type: 'string', format: 'uuid' }, applicationId: { type: 'string' }, receiverId: { type: 'string' },
    environment: { const: 'sandbox' }, externalReference: { type: 'string' },
    amountCents: { type: 'integer', minimum: 1 }, currency: { const: 'BRL' },
    state: { enum: ['PROCESSING','PENDING','UNCERTAIN'] }, providerReference: { type: ['string','null'] },
    createdAt: { type: 'string', format: 'date-time' }, provider: { const: 'simulated' },
    simulated: { const: true }, realPaymentsEnabled: { const: false },
  } };
const response = description => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } } });
const errorResponse = {
  description: 'Request rejected; no sensitive internal details are returned.',
  content: { 'application/json': { schema: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } } } },
};
const errors = Object.fromEntries([400,401,403,409,413,415,422,429,503].map(code => [code, { $ref: '#/components/responses/Error' }]));
const document = { openapi: '3.1.0', info: { title: 'Ligado Pay local sandbox', version: '0.1.0',
  description: 'Server-to-server API. Simulated payments only. Production is blocked; no payable QR or checkout is generated.' },
  servers: [{ url: 'http://127.0.0.1:3305', description: 'Local development only' }],
  security: [{ serviceToken: [] }], components: { schemas: { Payment: payment }, responses: { Error: errorResponse }, securitySchemes: {
    serviceToken: { type: 'http', scheme: 'bearer', description: 'Local 256-bit service token. Never embed in browser/app.' },
  } }, paths: {
    '/health/live': { get: { security: [], responses: { 200: { description: 'Process alive, no database access' } } } },
    '/health/ready': { get: { responses: { 200: { description: 'Database tables ready; simulated provider only' }, ...errors } } },
    '/v1/payments': { post: { operationId: 'createSimulatedPayment',
      parameters: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: idempotencyKey }],
      requestBody: { required: true, content: { 'application/json': { schema: paymentBody } } },
      responses: { 201: response('New simulated payment'), 200: response('Idempotent replay'), ...errors } } },
    '/v1/payments/{id}': { get: { operationId: 'getSimulatedPayment',
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: response('Payment visible to the authenticated application and receiver'),
        404: { description: 'Unknown or inaccessible payment' }, ...errors } } },
  } };
const path = new URL('../contracts/openapi.json', import.meta.url);
const output = JSON.stringify(document, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== output) throw new Error('OpenAPI contract is out of date.');
  console.log('OpenAPI contract matches HTTP request schemas.');
} else { await writeFile(path, output); console.log('OpenAPI contract generated.'); }
