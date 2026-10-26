import Fastify from 'fastify';
import type { Principal, CreatePayment } from '../domain/payment.js';
import { PaymentError } from '../domain/payment.js';
import type { Credential } from '../config.js';
import type { PaymentRepository, PaymentProvider } from '../application/ports.js';
import { PaymentService } from '../application/payment-service.js';
import { authenticate, IngressLimiter } from './authentication.js';
import { idempotencyKey, paymentBody, checkoutHintsBody, referenceParams,operationBody } from './schemas.js';
import type { CheckoutService } from '../application/checkout-service.js';
import type { CheckoutHints } from '../application/checkout-connector.js';
import {notificationPath,notificationHints,type InfinitePayNotifications} from '../infrastructure/infinitepay/notifications.js';
import type {PaymentOperations,OperationInput} from '../application/payment-operations.js';
import { CheckoutError } from '../application/checkout-connector.js';

declare module 'fastify' { interface FastifyRequest { principal: Principal | null } }
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };

export function createServer(repository: PaymentRepository, provider: PaymentProvider, credentials: Credential[], checkout?: CheckoutService,
  notifications?:InfinitePayNotifications,operations?:PaymentOperations) {
  const api = Fastify({ logger: false, trustProxy: false, bodyLimit: 4096,
    requestTimeout: 10_000, connectionTimeout: 10_000, keepAliveTimeout: 5000,
    maxRequestsPerSocket: 100, ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  const service = new PaymentService(repository, provider);
  const ingress = new IngressLimiter();
  const notificationIngress=new IngressLimiter();
  const metadata = { provider: checkout ? 'infinitepay' : provider.name, simulated: !checkout,
    realPaymentsEnabled: checkout?.creationEnabled ?? false };
  api.decorateRequest('principal', null);
  api.addHook('onRequest', async (request, reply) => {
    reply.headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer' });
    const isNotification=notifications&&request.method==='POST'&&request.routeOptions.url===notificationPath;
    if (!(isNotification?notificationIngress:ingress).allow(request.ip)) throw new PaymentError(429, 'RATE_LIMITED');
    if (request.headers.origin || request.headers['sec-fetch-site']) throw new PaymentError(403, 'SERVER_CLIENT_REQUIRED');
    if (request.routeOptions.url === '/health/live') return;
    if(notifications&&request.method==='POST'&&request.routeOptions.url===notificationPath)return;
    request.principal = authenticate(request.headers.authorization, credentials);
    if (!request.principal) throw new PaymentError(401, 'UNAUTHORIZED');
    if (!await repository.consumeRequest(request.principal)) throw new PaymentError(429, 'RATE_LIMITED');
  });
  api.setErrorHandler((error, _request, reply) => {
    if (error instanceof PaymentError) return reply.code(error.status).send({ error: error.code });
    if (error instanceof CheckoutError) return reply.code(
      error.code === 'INVALID_CHECKOUT_HINTS' || error.code === 'INVALID_CHECKOUT_INTENT' ? 400 : 503,
    ).send({ error: error.code });
    const e = error as { validation?: unknown; statusCode?: number };
    if (e.validation || e.statusCode === 400 || e.statusCode === 415 || e.statusCode === 413) {
      return reply.code(e.statusCode ?? 400).send({ error: 'INVALID_REQUEST' });
    }
    // Internal errors are not serialized: driver errors may contain submitted data.
    return reply.code(503).send({ error: 'SERVICE_UNAVAILABLE' });
  });
  api.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'NOT_FOUND' }));
  api.get('/health/live', async () => ({ status: 'alive' }));
  if(notifications)api.post(notificationPath,{bodyLimit:32768},async request=>{
    try{
      const event=request.body&&typeof request.body==='object'?request.body as Record<string,unknown>:{};
      if(operations&&(event['event']==='refunded'||event['event']==='canceled')){
        if(typeof event['order_nsu']!=='string'||!new RegExp(uuid.pattern).test(event['order_nsu']))throw new PaymentError(400,'INVALID_NOTIFICATION');
        await notifications.notice(operations,event['order_nsu'],
          event['event']==='refunded'?'REFUND_NOTICE':'CANCEL_NOTICE');
        return {accepted:true};
      }
      await notifications.enqueue(notificationHints(request.body));
      console.info(JSON.stringify({event:'infinitepay.notification.received',at:new Date().toISOString(),accepted:true}));
      return {accepted:true};
    }catch(error){
      const body=request.body&&typeof request.body==='object'?request.body as Record<string,unknown>:{};
      console.warn(JSON.stringify({event:'infinitepay.notification.rejected',at:new Date().toISOString(),
        hasOrder:typeof body['order_nsu']==='string',hasTransaction:typeof body['transaction_nsu']==='string',
        hasSlug:typeof (body['invoice_slug']??body['slug'])==='string',hasData:!!body['data']&&typeof body['data']==='object'}));
      throw error;
    }
  });
  api.get('/health/ready', async () => {
    await repository.ready();
    return { status: 'ready', environment: checkout ? 'production' : 'sandbox', ...metadata };
  });
  api.post<{ Body: CreatePayment; Headers: { 'idempotency-key': string } }>('/v1/payments', {
    schema: {
      headers: { type: 'object', required: ['idempotency-key'], properties: {
        'idempotency-key': idempotencyKey } },
      body: paymentBody,
    },
  }, async (request, reply) => {
    const result = await (checkout ?? service).create(request.principal!, request.body, request.headers['idempotency-key']);
    return reply.code(result.created ? 201 : 200).send({ ...result.payment, ...metadata });
  });
  api.get<{ Params: { receiverId: string; externalReference: string } }>(
    '/v1/payment-references/:receiverId/:externalReference', { schema: { params: referenceParams } },
    async request => ({ ...await (checkout ?? service).lookup(request.principal!,
      request.params.receiverId, request.params.externalReference), ...metadata }));
  api.get<{ Params: { id: string } }>('/v1/payments/:id', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } },
  }, async request => ({ ...await (checkout ?? service).get(request.principal!, request.params.id), ...metadata }));
  if (checkout) api.post<{ Params: { id: string }; Body: CheckoutHints }>('/v1/payments/:id/check', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } },
      body: checkoutHintsBody },
  }, async request => {
    if(request.params.id!==request.body.orderNsu)throw new PaymentError(400,'INVALID_CHECKOUT_HINTS');
    if(!request.principal!.permissions.includes('payments:check'))throw new PaymentError(403,'OPERATION_NOT_ALLOWED');
    await checkout.get(request.principal!,request.params.id);
    if(notifications)await notifications.enqueue(request.body);
    return { ...await checkout.check(request.principal!, request.params.id, request.body), ...metadata };
  });
  if(operations){
    const params={type:'object',additionalProperties:false,required:['id'],properties:{id:uuid}};
    const headers={type:'object',required:['idempotency-key'],properties:{'idempotency-key':idempotencyKey}};
    api.get('/v1/operations',async request=>operations.report(request.principal!));
    api.get<{Params:{id:string}}>('/v1/payments/:id/operations',{schema:{params}},async request=>operations.report(request.principal!,request.params.id));
    api.post<{Params:{id:string};Body:OperationInput;Headers:{'idempotency-key':string}}>('/v1/payments/:id/operations',{
      schema:{params,headers,body:operationBody}},
      async request=>operations.request(request.principal!,request.params.id,request.headers['idempotency-key'],request.body));
    api.post<{Params:{id:string};Body:CheckoutHints;Headers:{'idempotency-key':string}}>('/v1/payments/:id/reconciliation',
      {schema:{params,headers,body:checkoutHintsBody}},async request=>operations.retry(request.principal!,request.params.id,request.headers['idempotency-key'],request.body));
  }
  return api;
}
