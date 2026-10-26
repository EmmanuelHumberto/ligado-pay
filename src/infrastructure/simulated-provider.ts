import type { PaymentProvider } from '../application/ports.js';

export class SimulatedProvider implements PaymentProvider {
  readonly name = 'simulated' as const;
  async create(input: Parameters<PaymentProvider['create']>[0]) {
    // Deliberately no QR, payment URL or PAID transition: no actual payment is made.
    return { reference: `simulated:${input.payment.id}` };
  }
}
