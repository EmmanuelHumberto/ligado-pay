import type { CreatePayment, Payment, Principal } from '../domain/payment.js';

export interface PaymentRepository {
  reserve(principal: Principal, input: CreatePayment, key: string): Promise<{ payment: Payment; created: boolean }>;
  find(principal: Principal, id: string): Promise<Payment | null>;
  findByReference(principal: Principal, receiverId: string, externalReference: string): Promise<Payment | null>;
  finish(id: string, state: 'PENDING' | 'UNCERTAIN', providerReference: string | null): Promise<Payment>;
  consumeRequest(principal: Principal, operation?: 'read'|'create'|'check'|'operations'): Promise<boolean>;
  ready(): Promise<void>;
}
export interface PaymentProvider {
  readonly name: 'simulated';
  create(input: { payment: Payment; idempotencyKey: string }): Promise<{ reference: string }>;
}
