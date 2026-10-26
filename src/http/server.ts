import Fastify from 'fastify';
import type { Principal, CreatePayment } from '../domain/payment.js';
import { PaymentError } from '../domain/payment.js';
import type { Credential } from '../config.js';
import type { PaymentRepository, PaymentProvider } from '../application/ports.js';
import { PaymentService } from '../application/payment-service.js';
import { authenticate, IngressLimiter } from './authentication.js';
import { idempotencyKey, paymentBody } from './schemas.js';

declare module 'fastify' { interface FastifyRequest { principal: Principal | null } }
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };

export function createServer(repository: PaymentRepository, provider: PaymentProvider, credentials: Credential[]) {
  const api = Fastify({ logger: false, trustProxy: false, bodyLimit: 4096,
    requestTimeout: 10_000, connectionTimeout: 10_000, keepAliveTimeout: 5000,
    maxRequestsPerSocket: 100, ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  const service = new PaymentService(repository, provider);
  const ingress = new IngressLimiter();
  api.decorateRequest('principal', null);
  api.addHook('onRequest', async (request, reply) => {
    reply.headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer' });
    if (!ingress.allow(request.ip)) throw new PaymentError(429, 'RATE_LIMITED');
    if (request.headers.origin || request.headers['sec-fetch-site']) throw new PaymentError(403, 'SERVER_CLIENT_REQUIRED');
    if (request.routeOptions.url === '/health/live') return;
    request.principal = authenticate(request.headers.authorization, credentials);
    if (!request.principal) throw new PaymentError(401, 'UNAUTHORIZED');
    if (!await repository.consumeRequest(request.principal)) throw new PaymentError(429, 'RATE_LIMITED');
  });
  api.setErrorHandler((error, _request, reply) => {
    if (error instanceof PaymentError) return reply.code(error.status).send({ error: error.code });
    const e = error as { validation?: unknown; statusCode?: number };
    if (e.validation || e.statusCode === 400 || e.statusCode === 415 || e.statusCode === 413) {
      return reply.code(e.statusCode ?? 400).send({ error: 'INVALID_REQUEST' });
    }
    // Internal errors are not serialized: driver errors may contain submitted data.
    return reply.code(503).send({ error: 'SERVICE_UNAVAILABLE' });
  });
  api.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'NOT_FOUND' }));
  api.get('/health/live', async () => ({ status: 'alive' }));
  api.get('/health/ready', async () => {
    await repository.ready();
    return { status: 'ready', environment: 'sandbox', provider: 'simulated', realPaymentsEnabled: false };
  });
  api.post<{ Body: CreatePayment; Headers: { 'idempotency-key': string } }>('/v1/payments', {
    schema: {
      headers: { type: 'object', required: ['idempotency-key'], properties: {
        'idempotency-key': idempotencyKey } },
      body: paymentBody,
    },
  }, async (request, reply) => {
    const result = await service.create(request.principal!, request.body, request.headers['idempotency-key']);
    return reply.code(result.created ? 201 : 200).send({ ...result.payment, provider: provider.name,
      simulated: true, realPaymentsEnabled: false });
  });
  api.get<{ Params: { id: string } }>('/v1/payments/:id', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } },
  }, async request => ({ ...await service.get(request.principal!, request.params.id),
    provider: provider.name, simulated: true, realPaymentsEnabled: false }));
  return api;
}
