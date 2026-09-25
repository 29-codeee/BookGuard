import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  executeBookingSaga,
  cancelCompletedBookingTransaction,
  getTransactionDetails,
  listTransactions
} from '../transactions/saga.js';
import { getDemoScenarioCatalog } from '../transactions/demoScenarios.js';
import { buildReplacementRequest, getCustomerResolution } from '../transactions/customerResolution.js';
import {
  readIdempotencyKey,
  beginTransactionIdempotency,
  completeTransactionIdempotency,
  abandonTransactionIdempotency
} from '../transactions/idempotency.js';
import { TransactionEngineError } from '../transactions/errors.js';
import { defaultPaymentService, MockPaymentService, type PaymentFailureConfig } from '../transactions/payment.js';
import type { ResourceType } from '../transactions/types.js';
import type { InjectedFailures } from '../providers/datasetAdapters.js';
import type { ProviderTelemetryOverride } from '../ai/transactionRisk.js';
import type { RecoveryAdvisorOptions } from '../ai/recoveryAdvisor.js';

interface CreateTransactionBody {
  customerId?: string;
  items?: Array<{
    type?: ResourceType;
    resourceId?: string;
    quantity?: number;
  }>;
  paymentMethod?: string;
  failureSimulation?: InjectedFailures;
  paymentFailureSimulation?: PaymentFailureConfig;
  riskOverrides?: Record<string, ProviderTelemetryOverride>;
  simulateRiskError?: boolean;
  recoveryOverrides?: RecoveryAdvisorOptions['providerOverrides'];
  simulateRecoveryError?: boolean;
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof TransactionEngineError) {
    return reply.status(err.statusCode).send({
      success: false,
      error: err.code,
      message: err.message
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return reply.status(500).send({
    success: false,
    error: 'INTERNAL_SERVER_ERROR',
    message
  });
}

const VALID_TYPES: ResourceType[] = ['hotel', 'flight', 'transport', 'activity'];

/**
 * Claims the idempotency key, runs the Saga with the request's payment configuration, and stores the
 * response for replay. Shared by POST /api/transactions and replacement bookings so neither bypasses
 * idempotency, locking, risk assessment, payment or compensation.
 */
async function executeIdempotentTransaction(
  reply: FastifyReply,
  idempotencyKey: string,
  body: CreateTransactionBody,
  extraResponse: Record<string, unknown> = {}
) {
  let claim;
  try {
    claim = await beginTransactionIdempotency(idempotencyKey, body, 'transaction');
  } catch (err) {
    return sendError(reply, err);
  }

  if (claim.kind === 'replay') {
    return reply.status(claim.statusCode).send(claim.body);
  }

  const paymentService = body.paymentFailureSimulation
    ? new MockPaymentService(body.paymentFailureSimulation)
    : defaultPaymentService;

  try {
    const result = await executeBookingSaga(
      {
        customerId: body.customerId!,
        items: body.items as Array<{ type: ResourceType; resourceId: string; quantity: number }>
      },
      {
        failureSimulation: body.failureSimulation,
        paymentService,
        paymentMethod: body.paymentMethod,
        riskOverrides: body.riskOverrides,
        simulateRiskError: body.simulateRiskError,
        recoveryOverrides: body.recoveryOverrides,
        simulateRecoveryError: body.simulateRecoveryError
      }
    );

    const statusCode = result.state === 'COMPLETED' ? 201 : 409;
    const responsePayload = {
      success: result.state === 'COMPLETED',
      transactionId: result.transactionId,
      state: result.state,
      items: result.items,
      itemStates: result.itemStates,
      providerOperationResults: result.providerOperationResults,
      compensationResults: result.compensationResults,
      payment: result.payment,
      failure: result.failure,
      recoveryRequired: result.recoveryRequired,
      riskAssessment: result.riskAssessment,
      recoveryAdvisory: result.recoveryAdvisory,
      ...extraResponse
    };

    await completeTransactionIdempotency(idempotencyKey, statusCode, responsePayload, result.transactionId);
    return reply.status(statusCode).send(responsePayload);
  } catch (err) {
    await abandonTransactionIdempotency(idempotencyKey);
    return sendError(reply, err);
  }
}

export default async function transactionRoutes(app: FastifyInstance): Promise<void> {
  // 1. POST /api/transactions
  app.post('/api/transactions', async (req: FastifyRequest<{ Body: CreateTransactionBody }>, reply: FastifyReply) => {
    // 1. Validate Idempotency-Key header
    let idempotencyKey: string | undefined;
    try {
      idempotencyKey = readIdempotencyKey(req.headers as Record<string, unknown>, req.body);
    } catch (err) {
      return sendError(reply, err);
    }

    if (!idempotencyKey) {
      return reply.status(400).send({
        success: false,
        error: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required'
      });
    }

    // 2. Validate request body shape
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({
        success: false,
        error: 'MALFORMED_REQUEST',
        message: 'Request body must be a valid JSON object'
      });
    }

    if (!body.customerId || typeof body.customerId !== 'string' || body.customerId.trim() === '') {
      return reply.status(400).send({
        success: false,
        error: 'INVALID_REQUEST',
        message: 'customerId is required'
      });
    }

    if (!Array.isArray(body.items)) {
      return reply.status(400).send({
        success: false,
        error: 'MALFORMED_REQUEST',
        message: 'items must be an array'
      });
    }

    if (body.items.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'EMPTY_ITEMS_LIST',
        message: 'Item list cannot be empty'
      });
    }

    // Validate each item and check for duplicates
    const seenResourceIds = new Set<string>();
    for (const item of body.items) {
      if (!item || typeof item !== 'object') {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ITEM',
          message: 'Item must be a valid object'
        });
      }
      if (!item.type || !VALID_TYPES.includes(item.type)) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ITEM',
          message: `Item type must be one of: ${VALID_TYPES.join(', ')}`
        });
      }
      if (!item.resourceId || typeof item.resourceId !== 'string' || item.resourceId.trim() === '') {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ITEM',
          message: 'item resourceId is required'
        });
      }
      if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ITEM',
          message: 'item quantity must be an integer between 1 and 50'
        });
      }

      const dedupeKey = `${item.type}:${item.resourceId}`;
      if (seenResourceIds.has(dedupeKey)) {
        return reply.status(400).send({
          success: false,
          error: 'DUPLICATE_RESOURCE_ITEM',
          message: `Duplicate item in booking request: ${dedupeKey}`
        });
      }
      seenResourceIds.add(dedupeKey);
    }

    return executeIdempotentTransaction(reply, idempotencyKey, body);
  });

  // GET /api/transactions — read-only, paginated summaries for the operations dashboard.
  app.get('/api/transactions', async (req: FastifyRequest<{ Querystring: { limit?: string; offset?: string } }>, reply: FastifyReply) => {
    const parse = (raw: string | undefined, fallback: number, min: number, max: number): number | null => {
      if (raw === undefined || raw === '') return fallback;
      if (!/^\d+$/.test(raw)) return null;
      const value = Number(raw);
      return value >= min && value <= max ? value : null;
    };
    const limit = parse(req.query?.limit, 20, 1, 100);
    const offset = parse(req.query?.offset, 0, 0, 1_000_000);
    if (limit === null || offset === null) {
      return reply.status(400).send({
        success: false,
        error: 'INVALID_PAGINATION',
        message: 'limit must be an integer from 1 to 100 and offset a non-negative integer'
      });
    }
    try {
      const page = await listTransactions({ limit, offset });
      return reply.status(200).send({ success: true, ...page });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // GET /api/transactions/demo-scenarios — read-only catalog; submitting a scenario is an explicit POST.
  app.get('/api/transactions/demo-scenarios', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const scenarios = await getDemoScenarioCatalog();
      return reply.status(200).send({ success: true, scenarios });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // 2. GET /api/transactions/:id
  app.get('/api/transactions/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      return reply.status(400).send({
        success: false,
        error: 'INVALID_REQUEST',
        message: 'Transaction ID is required'
      });
    }

    try {
      const details = await getTransactionDetails(id);
      return reply.status(200).send({
        success: true,
        transactionId: details.transaction.id,
        state: details.transaction.status,
        currency: details.transaction.currency,
        totalAmount: details.transaction.totalAmount,
        createdAt: details.transaction.createdAt,
        updatedAt: details.transaction.updatedAt,
        items: details.items,
        itemStates: details.itemStates,
        providers: details.providers,
        events: details.events,
        locks: details.locks,
        recoveryRequired: details.recoveryRequired,
        riskAssessment: details.riskAssessment,
        recoveryAdvisory: details.recoveryAdvisory
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // GET /api/transactions/:id/resolution — read-only customer options and real dataset alternatives.
  app.get('/api/transactions/:id/resolution', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const resolution = await getCustomerResolution(req.params.id);
      return reply.status(200).send({ success: true, ...resolution });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // POST /api/transactions/:id/replacement — books a NEW transaction with the failed service swapped for a
  // validated alternative, through the same idempotent Saga path as POST /api/transactions.
  app.post('/api/transactions/:id/replacement', async (req: FastifyRequest<{
    Params: { id: string };
    Body?: { alternativeResourceId?: string };
  }>, reply: FastifyReply) => {
    let idempotencyKey: string | undefined;
    try {
      idempotencyKey = readIdempotencyKey(req.headers as Record<string, unknown>);
    } catch (err) {
      return sendError(reply, err);
    }
    if (!idempotencyKey) {
      return reply.status(400).send({ success: false, error: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' });
    }
    const alternativeResourceId = req.body?.alternativeResourceId;
    if (!alternativeResourceId || typeof alternativeResourceId !== 'string') {
      return reply.status(400).send({ success: false, error: 'INVALID_REQUEST', message: 'alternativeResourceId is required' });
    }
    let replacement;
    try {
      replacement = await buildReplacementRequest(req.params.id, alternativeResourceId);
    } catch (err) {
      return sendError(reply, err);
    }
    return executeIdempotentTransaction(reply, idempotencyKey, replacement.request, {
      replacementFor: req.params.id,
      replacedResource: { type: replacement.alternative.type, resourceId: replacement.alternative.resourceId, provider: replacement.alternative.provider }
    });
  });

  // 3. POST /api/transactions/:id/cancel
  app.post('/api/transactions/:id/cancel', async (req: FastifyRequest<{
    Params: { id: string };
    Body?: { paymentFailureSimulation?: PaymentFailureConfig };
  }>, reply: FastifyReply) => {
    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      return reply.status(400).send({
        success: false,
        error: 'INVALID_REQUEST',
        message: 'Transaction ID is required'
      });
    }

    // Optional idempotency header for cancel operations
    const idempotencyKey = readIdempotencyKey(req.headers as Record<string, unknown>, req.body);
    if (idempotencyKey) {
      try {
        const claim = await beginTransactionIdempotency(idempotencyKey, { id, body: req.body }, 'cancel_transaction');
        if (claim.kind === 'replay') {
          return reply.status(claim.statusCode).send(claim.body);
        }
      } catch (err) {
        return sendError(reply, err);
      }
    }

    const paymentService = req.body?.paymentFailureSimulation
      ? new MockPaymentService(req.body.paymentFailureSimulation)
      : defaultPaymentService;

    try {
      const cancellationResult = await cancelCompletedBookingTransaction(id, {
        paymentService
      });

      const statusCode = cancellationResult.state === 'ROLLBACK_FAILED' ? 409 : 200;
      const responsePayload = {
        success: cancellationResult.state === 'ROLLED_BACK',
        transactionId: cancellationResult.transactionId,
        state: cancellationResult.state,
        alreadyCancelled: cancellationResult.alreadyCancelled ?? false,
        compensationResults: cancellationResult.compensationResults,
        payment: cancellationResult.payment,
        recoveryRequired: cancellationResult.recoveryRequired,
        recoveryAdvisory: cancellationResult.recoveryAdvisory
      };

      if (idempotencyKey) {
        await completeTransactionIdempotency(idempotencyKey, statusCode, responsePayload, id);
      }
      return reply.status(statusCode).send(responsePayload);
    } catch (err) {
      if (idempotencyKey) {
        await abandonTransactionIdempotency(idempotencyKey);
      }
      return sendError(reply, err);
    }
  });
}
