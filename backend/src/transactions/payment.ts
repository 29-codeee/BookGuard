import { randomUUID } from 'node:crypto';

export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'REFUNDED'
  | 'VOIDED'
  | 'FAILED';

export interface PaymentRecord {
  paymentId: string;
  transactionId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAuthorizeInput {
  transactionId: string;
  amount: number;
  currency: string;
  paymentMethod?: string;
}

export interface PaymentResult {
  ok: boolean;
  paymentId: string;
  status: PaymentStatus;
  amount?: number;
  currency?: string;
  error?: string;
}

export interface PaymentFailureConfig {
  authorize?: string | boolean;
  capture?: string | boolean;
  refund?: string | boolean;
}

/**
 * Deterministic mock payment service for BookGuard transaction lifecycle.
 * Coordinates authorization, capture, and void/refund outside PostgreSQL transactions.
 */
export class MockPaymentService {
  private records = new Map<string, PaymentRecord>();
  private failureConfig: PaymentFailureConfig = {};
  private callLog: string[] = [];

  constructor(initialFailures: PaymentFailureConfig = {}) {
    this.failureConfig = { ...initialFailures };
  }

  setFailureConfig(config: PaymentFailureConfig): void {
    this.failureConfig = { ...config };
  }

  getCalls(): string[] {
    return [...this.callLog];
  }

  clearCalls(): void {
    this.callLog = [];
  }

  async authorize(input: PaymentAuthorizeInput): Promise<PaymentResult> {
    this.callLog.push(`authorize:${input.transactionId}`);
    if (this.failureConfig.authorize) {
      const err = typeof this.failureConfig.authorize === 'string'
        ? this.failureConfig.authorize
        : 'Payment authorization declined';
      const record: PaymentRecord = {
        paymentId: `pay-${randomUUID()}`,
        transactionId: input.transactionId,
        amount: input.amount,
        currency: input.currency,
        status: 'FAILED',
        paymentMethod: input.paymentMethod ?? 'card_mock',
        error: err,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.records.set(input.transactionId, record);
      return { ok: false, paymentId: record.paymentId, status: 'FAILED', error: err };
    }

    const paymentId = `pay-${randomUUID()}`;
    const record: PaymentRecord = {
      paymentId,
      transactionId: input.transactionId,
      amount: input.amount,
      currency: input.currency,
      status: 'AUTHORIZED',
      paymentMethod: input.paymentMethod ?? 'card_mock',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.records.set(input.transactionId, record);
    return { ok: true, paymentId, status: 'AUTHORIZED', amount: input.amount, currency: input.currency };
  }

  async capture(transactionId: string): Promise<PaymentResult> {
    this.callLog.push(`capture:${transactionId}`);
    const record = this.records.get(transactionId);
    if (!record) {
      return { ok: false, paymentId: '', status: 'FAILED', error: 'Payment authorization not found' };
    }
    if (this.failureConfig.capture) {
      const err = typeof this.failureConfig.capture === 'string'
        ? this.failureConfig.capture
        : 'Payment capture failed';
      record.status = 'FAILED';
      record.error = err;
      record.updatedAt = new Date().toISOString();
      return { ok: false, paymentId: record.paymentId, status: 'FAILED', error: err };
    }
    record.status = 'CAPTURED';
    record.updatedAt = new Date().toISOString();
    return { ok: true, paymentId: record.paymentId, status: 'CAPTURED', amount: record.amount, currency: record.currency };
  }

  async refund(transactionId: string): Promise<PaymentResult> {
    this.callLog.push(`refund:${transactionId}`);
    const record = this.records.get(transactionId);
    if (!record) {
      return { ok: false, paymentId: '', status: 'FAILED', error: 'Payment record not found for refund' };
    }
    if (this.failureConfig.refund) {
      const err = typeof this.failureConfig.refund === 'string'
        ? this.failureConfig.refund
        : 'Payment refund failed';
      return { ok: false, paymentId: record.paymentId, status: 'FAILED', error: err };
    }
    const targetStatus: PaymentStatus = record.status === 'AUTHORIZED' ? 'VOIDED' : 'REFUNDED';
    record.status = targetStatus;
    record.updatedAt = new Date().toISOString();
    return { ok: true, paymentId: record.paymentId, status: targetStatus, amount: record.amount, currency: record.currency };
  }

  getRecord(transactionId: string): PaymentRecord | undefined {
    return this.records.get(transactionId);
  }
}

export const defaultPaymentService = new MockPaymentService();
