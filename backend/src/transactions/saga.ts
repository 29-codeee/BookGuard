import { query, withTransaction } from '../db/client.js';
import {
  getDatasetProviderAdapter,
  createMockProviderRegistry,
  type DatasetProviderAdapter,
  type InjectedFailures,
  type ProviderContext,
  type ProviderItem,
  type ProviderRegistry
} from '../providers/datasetAdapters.js';
import { reserveTransactionResources } from './reservationLocks.js';
import { createBookingTransaction, getBookingTransaction, transitionBookingTransaction } from './store.js';
import { TransactionEngineError } from './errors.js';
import { canTransitionProvider, canTransitionTransaction, type ProviderOperationState, type TransactionState } from './stateMachine.js';
import type { CreateTransactionInput, ResourceType } from './types.js';
import type { MockPaymentService, PaymentResult } from './payment.js';
import {
  assessTransactionRisk,
  persistRiskAssessment,
  getRiskAssessmentByTransactionId,
  type TransactionRiskAssessment,
  type ProviderTelemetryOverride
} from '../ai/transactionRisk.js';
import {
  generateRecoveryAdvisory,
  persistRecoveryAdvisory,
  getRecoveryAdvisoryByTransactionId,
  type RecoveryAdvisory,
  type RecoveryAdvisorOptions
} from '../ai/recoveryAdvisor.js';

export type { ProviderRegistry } from '../providers/datasetAdapters.js';

export interface SagaDependencies {
  providers?: ProviderRegistry;
  lockTtlSeconds?: number;
  failureSimulation?: InjectedFailures;
  paymentService?: MockPaymentService;
  paymentMethod?: string;
  riskOverrides?: Record<string, ProviderTelemetryOverride>;
  simulateRiskError?: boolean;
  recoveryOverrides?: RecoveryAdvisorOptions['providerOverrides'];
  simulateRecoveryError?: boolean;
}

export interface SagaProviderOperationResult {
  itemId: string;
  type: ResourceType;
  operation: 'RESERVE' | 'CONFIRM';
  status: string;
  provider: string;
  reference?: string;
  error?: string;
}

export interface SagaCompensationResult {
  itemId: string;
  provider: string;
  status: 'CANCELLED' | 'FAILED' | 'SKIPPED';
  reference?: string;
  error?: string;
}

export interface SagaItemSummary {
  id: string;
  type: ResourceType;
  resourceId: string;
  quantity: number;
  status: string;
  provider: string | null;
  unitPrice: number | null;
}

export interface BookingSagaResult {
  transactionId: string;
  state: TransactionState;
  items: SagaItemSummary[];
  itemStates: Record<string, string>;
  providerOperationResults: SagaProviderOperationResult[];
  compensationResults: SagaCompensationResult[];
  payment?: PaymentResult;
  failure?: { phase: string; itemId?: string; message: string };
  recoveryRequired: Array<{ itemId: string; provider: string; reference: string | null; error: string | null }>;
  riskAssessment?: TransactionRiskAssessment;
  recoveryAdvisory?: RecoveryAdvisory | null;
}

export interface SagaOperation {
  item: ProviderItem;
  type: ResourceType;
  provider: string;
  context: ProviderContext;
  adapter: DatasetProviderAdapter;
  reference: string;
}

async function persistProviderTransition(args: {
  transactionId: string;
  itemId: string;
  operation: 'RESERVE' | 'CONFIRM' | 'CANCEL';
  to: ProviderOperationState;
  provider?: string;
  reference?: string;
  error?: string;
  itemState?: string;
  event?: string;
}): Promise<void> {
  await withTransaction(async tx => {
    const result = await tx.query<{
      status: ProviderOperationState;
      provider_name: string;
      provider_reference: string | null;
    }>(
      'SELECT status, provider_name, provider_reference FROM booking_transaction_providers WHERE transaction_id=$1 AND item_id=$2 FOR UPDATE',
      [args.transactionId, args.itemId]
    );
    const current = result.rows[0];
    if (!current) throw new TransactionEngineError('Provider operation record was not found', 'PROVIDER_OPERATION_NOT_FOUND', 404);
    if (!canTransitionProvider(current.status, args.to)) {
      throw new TransactionEngineError(`Invalid provider transition ${current.status} -> ${args.to}`, 'INVALID_PROVIDER_TRANSITION', 409);
    }
    await tx.query(
      `UPDATE booking_transaction_providers SET status=$3, operation_type=$4, provider_name=COALESCE($5,provider_name), provider_reference=COALESCE($6,provider_reference), error_message=$7, updated_at=CURRENT_TIMESTAMP WHERE transaction_id=$1 AND item_id=$2`,
      [args.transactionId, args.itemId, args.to, args.operation, args.provider ?? null, args.reference ?? null, args.error ?? null]
    );
    if (args.itemState) {
      await tx.query('UPDATE booking_transaction_items SET status=$2 WHERE id=$1', [args.itemId, args.itemState]);
    }
    await tx.query(
      'INSERT INTO booking_transaction_events (transaction_id, item_id, from_state, to_state, detail) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [
        args.transactionId,
        args.itemId,
        current.status,
        args.to,
        JSON.stringify({
          event: args.event ?? `${args.operation}_${args.to}`,
          operation: args.operation,
          provider: args.provider ?? current.provider_name,
          reference: args.reference ?? current.provider_reference,
          error: args.error ?? null
        })
      ]
    );
    if (args.operation === 'RESERVE' && args.to === 'RESERVED') {
      await tx.query(
        `UPDATE booking_resource_locks SET status='CONFIRMED' WHERE transaction_id=$1 AND item_id=$2 AND status='ACTIVE'`,
        [args.transactionId, args.itemId]
      );
      await tx.query(
        `INSERT INTO booking_transaction_events (transaction_id, item_id, from_state, to_state, detail) VALUES ($1,$2,'CONFIRMED','CONFIRMED','{"event":"PROVIDER_RESERVATION_HOLDS_RESOURCE"}'::jsonb)`,
        [args.transactionId, args.itemId]
      );
    }
    if (args.operation === 'CONFIRM' && args.to === 'CONFIRMED') {
      await tx.query(`UPDATE booking_transaction_items SET status='COMPLETED' WHERE id=$1`, [args.itemId]);
    }
  });
}

async function startProviderOperation(
  transactionId: string,
  itemId: string,
  operation: 'RESERVE' | 'CONFIRM',
  to: ProviderOperationState
): Promise<void> {
  if (operation === 'RESERVE') {
    // Renew outstanding provisional locks before crossing the external boundary.
    await withTransaction(async tx => {
      await tx.query(
        `UPDATE booking_resource_locks SET expires_at=CURRENT_TIMESTAMP + INTERVAL '10 minutes' WHERE transaction_id=$1 AND status='ACTIVE'`,
        [transactionId]
      );
    });
  }
  await persistProviderTransition({ transactionId, itemId, operation, to, event: `${operation}_STARTED` });
}

async function claimCompensation(
  transactionId: string,
  itemId: string,
  reference: string
): Promise<{ claimed: boolean; provider: string; reference: string; reason?: string }> {
  return withTransaction(async tx => {
    const transaction = await tx.query<{ status: TransactionState }>(
      'SELECT status FROM booking_transactions WHERE id=$1 FOR UPDATE',
      [transactionId]
    );
    const provider = await tx.query<{
      status: ProviderOperationState;
      operation_type: string;
      provider_name: string;
      provider_reference: string | null;
      error_message: string | null;
    }>(
      'SELECT status, operation_type, provider_name, provider_reference, error_message FROM booking_transaction_providers WHERE transaction_id=$1 AND item_id=$2 FOR UPDATE',
      [transactionId, itemId]
    );
    const row = provider.rows[0];
    if (!row) throw new TransactionEngineError('Provider operation record was not found', 'PROVIDER_OPERATION_NOT_FOUND', 404);
    if (row.status === 'CANCELLED') return { claimed: false, provider: row.provider_name, reference: row.provider_reference ?? reference, reason: 'already_compensated' };
    if (row.status === 'CANCELLING') return { claimed: false, provider: row.provider_name, reference: row.provider_reference ?? reference, reason: 'compensation_in_progress' };
    if (row.status === 'FAILED' && row.operation_type === 'CANCEL') return { claimed: false, provider: row.provider_name, reference: row.provider_reference ?? reference, reason: 'compensation_requires_recovery' };
    if (transaction.rows[0]?.status !== 'ROLLING_BACK') throw new TransactionEngineError('Transaction must be rolling back before compensation', 'INVALID_TRANSACTION_STATE', 409);
    if (!['RESERVED', 'CONFIRMED', 'FAILED'].includes(row.status) || !canTransitionProvider(row.status, 'CANCELLING')) {
      return { claimed: false, provider: row.provider_name, reference, reason: 'provider_not_reserved' };
    }
    const providerReference = row.provider_reference ?? reference;
    if (!providerReference) return { claimed: false, provider: row.provider_name, reference, reason: 'provider_reference_missing' };
    await tx.query(
      `UPDATE booking_transaction_providers SET status='CANCELLING', operation_type='CANCEL', provider_reference=$3, error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE transaction_id=$1 AND item_id=$2`,
      [transactionId, itemId, providerReference]
    );
    await tx.query(
      `INSERT INTO booking_transaction_events (transaction_id, item_id, from_state, to_state, detail) VALUES ($1,$2,$3,'CANCELLING',$4::jsonb)`,
      [transactionId, itemId, row.status, JSON.stringify({ event: 'COMPENSATION_STARTED', operation: 'CANCEL', provider: row.provider_name, reference: providerReference })]
    );
    return { claimed: true, provider: row.provider_name, reference: providerReference };
  });
}

/** Idempotently claims and executes one cancellation. Calls to the provider happen outside SQL transactions. */
export async function compensateSagaItem(transactionId: string, operation: SagaOperation): Promise<SagaCompensationResult> {
  const claim = await claimCompensation(transactionId, operation.item.id, operation.reference);
  if (!claim.claimed) return { itemId: operation.item.id, provider: claim.provider, status: 'SKIPPED', reference: claim.reference, error: claim.reason };
  try {
    const result = await operation.adapter.cancel(operation.item, operation.context, claim.reference);
    await withTransaction(async tx => {
      const provider = await tx.query<{ status: ProviderOperationState }>(
        'SELECT status FROM booking_transaction_providers WHERE transaction_id=$1 AND item_id=$2 FOR UPDATE',
        [transactionId, operation.item.id]
      );
      const from = provider.rows[0]?.status;
      if (!from || !canTransitionProvider(from, 'CANCELLED')) {
        throw new TransactionEngineError('Provider state changed while compensation was in progress', 'INVALID_PROVIDER_TRANSITION', 409);
      }
      await tx.query(
        `UPDATE booking_transaction_providers SET status='CANCELLED', operation_type='CANCEL', provider_reference=$3, error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE transaction_id=$1 AND item_id=$2`,
        [transactionId, operation.item.id, result.reference]
      );
      await tx.query(
        `UPDATE booking_transaction_items SET status='RELEASED' WHERE id=$1 AND status IN ('RESERVED','COMPLETED')`,
        [operation.item.id]
      );
      await tx.query(
        `UPDATE booking_resource_locks SET status='RELEASED' WHERE transaction_id=$1 AND item_id=$2 AND status IN ('ACTIVE','CONFIRMED')`,
        [transactionId, operation.item.id]
      );
      await tx.query(
        `INSERT INTO booking_transaction_events (transaction_id, item_id, from_state, to_state, detail) VALUES ($1,$2,$3,'CANCELLED',$4::jsonb)`,
        [transactionId, operation.item.id, from, JSON.stringify({ event: 'COMPENSATION_SUCCEEDED', operation: 'CANCEL', provider: claim.provider, reference: result.reference })]
      );
      await tx.query(
        `INSERT INTO booking_transaction_events (transaction_id, item_id, from_state, to_state, detail) VALUES ($1,$2,'ACTIVE','RELEASED','{"event":"RESOURCE_LOCK_RELEASED"}'::jsonb)`,
        [transactionId, operation.item.id]
      );
    });
    return { itemId: operation.item.id, provider: claim.provider, status: 'CANCELLED', reference: result.reference };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTransaction(async tx => {
      await tx.query(
        `UPDATE booking_transaction_providers SET status='FAILED', operation_type='CANCEL', error_message=$3, updated_at=CURRENT_TIMESTAMP WHERE transaction_id=$1 AND item_id=$2 AND status='CANCELLING'`,
        [transactionId, operation.item.id, message]
      );
      // Preserve capacity while external cancellation is unresolved, preventing a double booking.
      await tx.query(
        `UPDATE booking_resource_locks SET status='CONFIRMED' WHERE transaction_id=$1 AND item_id=$2 AND status IN ('ACTIVE','CONFIRMED')`,
        [transactionId, operation.item.id]
      );
      await tx.query(
        `INSERT INTO booking_transaction_events (transaction_id, item_id, from_state, to_state, detail) VALUES ($1,$2,'CANCELLING','FAILED',$3::jsonb)`,
        [transactionId, operation.item.id, JSON.stringify({ event: 'COMPENSATION_FAILED', operation: 'CANCEL', provider: claim.provider, reference: claim.reference, error: message, recoveryRequired: true })]
      );
    });
    return { itemId: operation.item.id, provider: claim.provider, status: 'FAILED', reference: claim.reference, error: message };
  }
}

async function finalizeSaga(
  transactionId: string,
  to: 'COMPLETED' | 'ROLLED_BACK' | 'ROLLBACK_FAILED',
  detail: Record<string, unknown>
): Promise<void> {
  await withTransaction(async tx => {
    const current = await tx.query<{ status: TransactionState }>(
      'SELECT status FROM booking_transactions WHERE id=$1 FOR UPDATE',
      [transactionId]
    );
    const from = current.rows[0]?.status;
    if (!from || !canTransitionTransaction(from, to)) {
      throw new TransactionEngineError(`Invalid transaction transition ${from ?? 'UNKNOWN'} -> ${to}`, 'INVALID_TRANSITION', 409);
    }
    if (to === 'COMPLETED') {
      const retained = await tx.query<{ item_id: string }>(
        `UPDATE booking_resource_locks SET status='CONFIRMED' WHERE transaction_id=$1 AND status='ACTIVE' RETURNING item_id`,
        [transactionId]
      );
      for (const lock of retained.rows) {
        await tx.query(
          `INSERT INTO booking_transaction_events (transaction_id, item_id, from_state, to_state, detail) VALUES ($1,$2,'ACTIVE','CONFIRMED','{"event":"SUCCESS_LOCK_RETAINED"}'::jsonb)`,
          [transactionId, lock.item_id]
        );
      }
    } else {
      const released = await tx.query<{ item_id: string }>(
        `UPDATE booking_resource_locks l SET status='RELEASED' WHERE l.transaction_id=$1 AND l.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM booking_transaction_providers p WHERE p.item_id=l.item_id AND p.status='FAILED' AND p.operation_type='CANCEL') RETURNING item_id`,
        [transactionId]
      );
      for (const lock of released.rows) {
        await tx.query(
          `INSERT INTO booking_transaction_events (transaction_id, item_id, from_state, to_state, detail) VALUES ($1,$2,'ACTIVE','RELEASED','{"event":"ROLLBACK_LOCK_RELEASED"}'::jsonb)`,
          [transactionId, lock.item_id]
        );
      }
      const itemRows = await tx.query<{ id: string }>(
        `UPDATE booking_transaction_items i SET status='RELEASED' WHERE i.transaction_id=$1 AND i.status='RESERVED' AND NOT EXISTS (SELECT 1 FROM booking_transaction_providers p WHERE p.item_id=i.id AND p.status='FAILED' AND p.operation_type='CANCEL') RETURNING i.id`,
        [transactionId]
      );
      for (const item of itemRows.rows) {
        await tx.query(
          `INSERT INTO booking_transaction_events (transaction_id, item_id, from_state, to_state, detail) VALUES ($1,$2,'RESERVED','RELEASED','{"event":"UNPROCESSED_ITEM_RELEASED"}'::jsonb)`,
          [transactionId, item.id]
        );
      }
    }
    await tx.query('UPDATE booking_transactions SET status=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1', [transactionId, to]);
    await tx.query(
      'INSERT INTO booking_transaction_events (transaction_id, from_state, to_state, detail) VALUES ($1,$2,$3,$4::jsonb)',
      [transactionId, from, to, JSON.stringify(detail)]
    );
  });
}

async function buildResult(
  transactionId: string,
  operations: SagaProviderOperationResult[],
  compensations: SagaCompensationResult[],
  failure?: BookingSagaResult['failure'],
  payment?: PaymentResult
): Promise<BookingSagaResult> {
  const transaction = (await getBookingTransaction(transactionId)) as any;
  const recovery = await query<{
    item_id: string;
    provider_name: string;
    provider_reference: string | null;
    error_message: string | null;
  }>(
    `SELECT item_id, provider_name, provider_reference, error_message FROM booking_transaction_providers WHERE transaction_id=$1 AND status='FAILED' AND operation_type='CANCEL' ORDER BY item_id`,
    [transactionId]
  );
  const items = (transaction.items ?? []) as SagaItemSummary[];
  const itemStates: Record<string, string> = {};
  for (const item of items) {
    itemStates[item.id] = item.status;
  }
  const riskAssessment = (await getRiskAssessmentByTransactionId(transactionId)) ?? undefined;
  const recoveryAdvisory = (await getRecoveryAdvisoryByTransactionId(transactionId)) ?? null;
  return {
    transactionId,
    state: transaction.status,
    items,
    itemStates,
    providerOperationResults: operations,
    compensationResults: compensations,
    payment,
    failure,
    recoveryRequired: recovery.rows.map(row => ({
      itemId: row.item_id,
      provider: row.provider_name,
      reference: row.provider_reference,
      error: row.error_message
    })),
    riskAssessment,
    recoveryAdvisory
  };
}

/**
 * Service entry point for multi-provider Saga orchestration.
 * Coordinates independent provider operations and payments without long SQL transactions,
 * persisting operation states, acquiring/releasing locks, and executing reverse-order
 * compensation on any forward failure. Designed for safe invocation via idempotent APIs.
 */
export async function executeBookingSaga(
  request: CreateTransactionInput,
  dependencies: SagaDependencies = {}
): Promise<BookingSagaResult> {
  const providers = dependencies.providers ?? (
    dependencies.failureSimulation
      ? createMockProviderRegistry({ failures: dependencies.failureSimulation })
      : {
          hotel: getDatasetProviderAdapter('hotel'),
          flight: getDatasetProviderAdapter('flight'),
          transport: getDatasetProviderAdapter('transport'),
          activity: getDatasetProviderAdapter('activity')
        }
  );

  const created = await createBookingTransaction(request);

  // Phase 6A: Advisory transaction risk assessment
  // Evaluated and persisted after transaction creation but BEFORE provider execution.
  // Note: Risk assessment is strictly advisory and failures must NEVER abort the booking.
  try {
    const assessment = await assessTransactionRisk(request, {
      transactionId: created.id,
      providerOverrides: dependencies.riskOverrides,
      simulateError: dependencies.simulateRiskError
    });
    await persistRiskAssessment(created.id, assessment);
  } catch (err) {
    console.error('[RiskAssessment] Advisory assessment failed (continuing transaction):', err);
  }

  let reservation;
  try {
    reservation = await reserveTransactionResources(created.id, request.items, dependencies.lockTtlSeconds ?? 600);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await transitionBookingTransaction(created.id, 'FAILED', { event: 'RESOURCE_RESERVATION_FAILED', error: message });
    return buildResult(created.id, [], [], { phase: 'RESOURCE_RESERVATION', message });
  }

  // Payment authorization (outside SQL transaction)
  let paymentResult: PaymentResult | undefined;
  if (dependencies.paymentService) {
    paymentResult = await dependencies.paymentService.authorize({
      transactionId: created.id,
      amount: reservation.amount,
      currency: reservation.currency,
      paymentMethod: dependencies.paymentMethod
    });
    if (!paymentResult.ok) {
      await withTransaction(async tx => {
        await tx.query(
          'INSERT INTO booking_transaction_events (transaction_id, to_state, detail) VALUES ($1, $2, $3::jsonb)',
          [created.id, 'FAILED', JSON.stringify({ event: 'PAYMENT_AUTHORIZATION_FAILED', error: paymentResult?.error })]
        );
      });
      await transitionBookingTransaction(created.id, 'ROLLING_BACK', { event: 'PAYMENT_AUTHORIZATION_FAILED', error: paymentResult.error });
      await finalizeSaga(created.id, 'ROLLED_BACK', { event: 'PAYMENT_AUTHORIZATION_FAILED', error: paymentResult.error });
      return buildResult(created.id, [], [], { phase: 'PAYMENT_AUTHORIZATION', message: paymentResult.error ?? 'Payment authorization failed' }, paymentResult);
    }
    await withTransaction(async tx => {
      await tx.query(
        'INSERT INTO booking_transaction_events (transaction_id, to_state, detail) VALUES ($1, $2, $3::jsonb)',
        [created.id, 'PAYMENT', JSON.stringify({ event: 'PAYMENT_AUTHORIZED', paymentId: paymentResult?.paymentId, amount: reservation.amount, currency: reservation.currency })]
      );
    });
  }

  const providerOperationResults: SagaProviderOperationResult[] = [];
  const compensationResults: SagaCompensationResult[] = [];
  const successful: SagaOperation[] = [];
  let failure: BookingSagaResult['failure'];
  let failurePhase = 'PROVIDER_RESERVE';

  try {
    // Preserve the request order for provider calls while locks were acquired in deadlock-safe order.
    const reservationById = new Map(reservation.items.map(item => [item.itemId, item]));
    const forward = request.items.map((requested, index) => {
      const persisted = reservationById.get(created.itemIds[index]);
      if (!persisted) throw new TransactionEngineError('Reserved item result was missing', 'ITEM_MISMATCH', 500);
      const adapter = providers[requested.type];
      const item: ProviderItem = { id: created.itemIds[index], resourceId: requested.resourceId, type: requested.type, quantity: requested.quantity };
      const context: ProviderContext = { provider: persisted.provider, unitPrice: persisted.unitPrice, currency: reservation.currency };
      return { item, type: requested.type, provider: persisted.provider, context, adapter };
    });

    for (const operation of forward) {
      failurePhase = 'PROVIDER_RESERVE';
      await startProviderOperation(created.id, operation.item.id, 'RESERVE', 'RESERVING');
      try {
        const result = await operation.adapter.reserve(operation.item, operation.context);
        await persistProviderTransition({
          transactionId: created.id,
          itemId: operation.item.id,
          operation: 'RESERVE',
          to: 'RESERVED',
          provider: result.provider,
          reference: result.reference,
          event: 'PROVIDER_RESERVED'
        });
        const completed = { ...operation, reference: result.reference };
        successful.push(completed);
        providerOperationResults.push({
          itemId: operation.item.id,
          type: operation.type,
          operation: 'RESERVE',
          status: 'RESERVED',
          provider: result.provider,
          reference: result.reference
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const current = await query<{ status: ProviderOperationState }>(
          'SELECT status FROM booking_transaction_providers WHERE transaction_id=$1 AND item_id=$2',
          [created.id, operation.item.id]
        );
        if (current.rows[0]?.status === 'RESERVING') {
          await persistProviderTransition({
            transactionId: created.id,
            itemId: operation.item.id,
            operation: 'RESERVE',
            to: 'FAILED',
            provider: operation.provider,
            error: message,
            itemState: 'FAILED',
            event: 'PROVIDER_RESERVE_FAILED'
          });
        }
        providerOperationResults.push({
          itemId: operation.item.id,
          type: operation.type,
          operation: 'RESERVE',
          status: 'FAILED',
          provider: operation.provider,
          error: message
        });
        failure = { phase: failurePhase, itemId: operation.item.id, message };
        throw error;
      }
    }

    await transitionBookingTransaction(created.id, 'PROCESSING', { event: 'ALL_PROVIDERS_RESERVED', providerCount: successful.length });

    // Capture payment before final provider confirmations if payment was authorized
    if (dependencies.paymentService && paymentResult?.ok) {
      const captureResult = await dependencies.paymentService.capture(created.id);
      if (!captureResult.ok) {
        failurePhase = 'PAYMENT_CAPTURE';
        failure = { phase: 'PAYMENT_CAPTURE', message: captureResult.error ?? 'Payment capture failed' };
        await withTransaction(async tx => {
          await tx.query(
            'INSERT INTO booking_transaction_events (transaction_id, to_state, detail) VALUES ($1, $2, $3::jsonb)',
            [created.id, 'FAILED', JSON.stringify({ event: 'PAYMENT_CAPTURE_FAILED', error: captureResult.error })]
          );
        });
        throw new Error(captureResult.error ?? 'Payment capture failed');
      }
      paymentResult = captureResult;
      await withTransaction(async tx => {
        await tx.query(
          'INSERT INTO booking_transaction_events (transaction_id, to_state, detail) VALUES ($1, $2, $3::jsonb)',
          [created.id, 'PAYMENT', JSON.stringify({ event: 'PAYMENT_CAPTURED', paymentId: captureResult.paymentId })]
        );
      });
    }

    for (const operation of successful) {
      failurePhase = 'PROVIDER_CONFIRM';
      await startProviderOperation(created.id, operation.item.id, 'CONFIRM', 'CONFIRMING');
      try {
        const result = await operation.adapter.confirm(operation.item, operation.context, operation.reference);
        await persistProviderTransition({
          transactionId: created.id,
          itemId: operation.item.id,
          operation: 'CONFIRM',
          to: 'CONFIRMED',
          provider: result.provider,
          reference: result.reference,
          event: 'PROVIDER_CONFIRMED'
        });
        providerOperationResults.push({
          itemId: operation.item.id,
          type: operation.type,
          operation: 'CONFIRM',
          status: 'CONFIRMED',
          provider: result.provider,
          reference: result.reference
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const current = await query<{ status: ProviderOperationState }>(
          'SELECT status FROM booking_transaction_providers WHERE transaction_id=$1 AND item_id=$2',
          [created.id, operation.item.id]
        );
        if (current.rows[0]?.status === 'CONFIRMING') {
          await persistProviderTransition({
            transactionId: created.id,
            itemId: operation.item.id,
            operation: 'CONFIRM',
            to: 'FAILED',
            provider: operation.provider,
            reference: operation.reference,
            error: message,
            event: 'PROVIDER_CONFIRM_FAILED'
          });
        }
        providerOperationResults.push({
          itemId: operation.item.id,
          type: operation.type,
          operation: 'CONFIRM',
          status: 'FAILED',
          provider: operation.provider,
          reference: operation.reference,
          error: message
        });
        failure = { phase: failurePhase, itemId: operation.item.id, message };
        throw error;
      }
    }

    await finalizeSaga(created.id, 'COMPLETED', { event: 'SAGA_COMPLETED', providerCount: successful.length });
    return buildResult(created.id, providerOperationResults, compensationResults, undefined, paymentResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!failure) failure = { phase: failurePhase, message };
    const state = await query<{ status: TransactionState }>('SELECT status FROM booking_transactions WHERE id=$1', [created.id]);
    if (state.rows[0]?.status === 'RESERVING' || state.rows[0]?.status === 'PROCESSING') {
      await transitionBookingTransaction(created.id, 'ROLLING_BACK', {
        event: 'SAGA_ROLLBACK_STARTED',
        phase: failure.phase,
        error: failure.message
      });
    } else {
      throw error;
    }

    // Reverse compensation of successful provider reservations
    for (const operation of [...successful].reverse()) {
      const result = await compensateSagaItem(created.id, operation);
      compensationResults.push(result);
    }

    // Refund / void payment outside SQL transaction if authorized/captured
    let paymentRefundFailed = false;
    if (dependencies.paymentService && paymentResult && paymentResult.status !== 'FAILED') {
      const refundRes = await dependencies.paymentService.refund(created.id);
      if (refundRes.ok) {
        paymentResult = refundRes;
        await withTransaction(async tx => {
          await tx.query(
            'INSERT INTO booking_transaction_events (transaction_id, to_state, detail) VALUES ($1, $2, $3::jsonb)',
            [created.id, 'PAYMENT', JSON.stringify({ event: 'PAYMENT_REFUNDED', paymentId: refundRes.paymentId, status: refundRes.status })]
          );
        });
      } else {
        paymentRefundFailed = true;
        await withTransaction(async tx => {
          await tx.query(
            'INSERT INTO booking_transaction_events (transaction_id, to_state, detail) VALUES ($1, $2, $3::jsonb)',
            [created.id, 'FAILED', JSON.stringify({ event: 'PAYMENT_REFUND_FAILED', paymentId: refundRes.paymentId, error: refundRes.error, recoveryRequired: true })]
          );
        });
      }
    }

    const providerCompensationFailed = compensationResults.some(result => result.status === 'FAILED');
    const compensationFailed = providerCompensationFailed || paymentRefundFailed;
    const finalState = compensationFailed ? 'ROLLBACK_FAILED' : 'ROLLED_BACK';
    await finalizeSaga(created.id, finalState, {
      event: finalState === 'ROLLED_BACK' ? 'SAGA_ROLLED_BACK' : 'SAGA_RECOVERY_REQUIRED',
      failure,
      compensationCount: compensationResults.length
    });

    if (finalState === 'ROLLBACK_FAILED') {
      try {
        const advisory = await generateRecoveryAdvisory(created.id, {
          providerOverrides: dependencies.recoveryOverrides,
          simulateError: dependencies.simulateRecoveryError
        });
        if (advisory) {
          await persistRecoveryAdvisory(created.id, advisory);
        }
      } catch (err) {
        console.error('[RecoveryAdvisor] Advisory generation failed (non-blocking):', err);
      }
    }

    return buildResult(created.id, providerOperationResults, compensationResults, failure, paymentResult);
  }
}

/**
 * Cancels and compensates a completed transaction safely and idempotently.
 * Reverses provider reservations in strict LIFO order, refunds payment, and releases locks.
 */
export async function cancelCompletedBookingTransaction(
  transactionId: string,
  dependencies: {
    providers?: ProviderRegistry;
    paymentService?: MockPaymentService;
    recoveryOverrides?: RecoveryAdvisorOptions['providerOverrides'];
    simulateRecoveryError?: boolean;
  } = {}
): Promise<{
  success: boolean;
  transactionId: string;
  state: TransactionState;
  alreadyCancelled?: boolean;
  compensationResults: SagaCompensationResult[];
  payment?: PaymentResult;
  recoveryRequired: Array<{ itemId: string; provider: string; reference: string | null; error: string | null }>;
  recoveryAdvisory?: RecoveryAdvisory | null;
}> {
  const current = await query<{ status: TransactionState }>(
    'SELECT status FROM booking_transactions WHERE id = $1',
    [transactionId]
  );
  if (!current.rows[0]) {
    throw new TransactionEngineError('Transaction was not found', 'TRANSACTION_NOT_FOUND', 404);
  }
  if (current.rows[0].status === 'ROLLED_BACK') {
    const recovery = await query<{
      item_id: string;
      provider_name: string;
      provider_reference: string | null;
      error_message: string | null;
    }>(
      `SELECT item_id, provider_name, provider_reference, error_message FROM booking_transaction_providers WHERE transaction_id=$1 AND status='FAILED' AND operation_type='CANCEL'`,
      [transactionId]
    );
    return {
      success: true,
      transactionId,
      state: 'ROLLED_BACK',
      alreadyCancelled: true,
      compensationResults: [],
      recoveryRequired: recovery.rows.map(r => ({
        itemId: r.item_id,
        provider: r.provider_name,
        reference: r.provider_reference,
        error: r.error_message
      }))
    };
  }
  if (current.rows[0].status !== 'COMPLETED') {
    throw new TransactionEngineError(
      `Cannot cancel transaction in state ${current.rows[0].status}`,
      'INVALID_TRANSACTION_STATE',
      409
    );
  }

  await transitionBookingTransaction(transactionId, 'ROLLING_BACK', { event: 'TRANSACTION_CANCEL_REQUESTED' });

  const itemsRes = await query<{
    id: string;
    resource_type: ResourceType;
    resource_id: string;
    quantity: number;
    provider_name: string;
    unit_price: number;
    currency: string;
    provider_reference: string | null;
  }>(
    `SELECT i.id, i.resource_type, i.resource_id, i.quantity, i.provider_name, i.unit_price, i.currency, p.provider_reference
     FROM booking_transaction_items i
     JOIN booking_transaction_providers p ON p.item_id = i.id
     WHERE i.transaction_id = $1
     ORDER BY i.position DESC`,
    [transactionId]
  );

  const providers = dependencies.providers ?? {
    hotel: getDatasetProviderAdapter('hotel'),
    flight: getDatasetProviderAdapter('flight'),
    transport: getDatasetProviderAdapter('transport'),
    activity: getDatasetProviderAdapter('activity')
  };

  const compensationResults: SagaCompensationResult[] = [];
  for (const row of itemsRes.rows) {
    const operation: SagaOperation = {
      item: { id: row.id, resourceId: row.resource_id, type: row.resource_type, quantity: row.quantity },
      type: row.resource_type,
      provider: row.provider_name,
      context: { provider: row.provider_name, unitPrice: Number(row.unit_price), currency: row.currency || 'INR' },
      adapter: providers[row.resource_type],
      reference: row.provider_reference || ''
    };
    const compRes = await compensateSagaItem(transactionId, operation);
    compensationResults.push(compRes);
  }

  let paymentResult: PaymentResult | undefined;
  if (dependencies.paymentService) {
    const refundRes = await dependencies.paymentService.refund(transactionId);
    paymentResult = refundRes;
    await withTransaction(async tx => {
      await tx.query(
        'INSERT INTO booking_transaction_events (transaction_id, to_state, detail) VALUES ($1, $2, $3::jsonb)',
        [transactionId, 'PAYMENT', JSON.stringify({ event: refundRes.ok ? 'PAYMENT_REFUNDED' : 'PAYMENT_REFUND_FAILED', status: refundRes.status })]
      );
    });
  }

  const anyFailed = compensationResults.some(c => c.status === 'FAILED') || (paymentResult && !paymentResult.ok);
  const finalState: TransactionState = anyFailed ? 'ROLLBACK_FAILED' : 'ROLLED_BACK';
  await finalizeSaga(transactionId, finalState, { event: finalState === 'ROLLED_BACK' ? 'SAGA_ROLLED_BACK' : 'SAGA_RECOVERY_REQUIRED' });

  if (finalState === 'ROLLBACK_FAILED') {
    try {
      const advisory = await generateRecoveryAdvisory(transactionId, {
        providerOverrides: dependencies.recoveryOverrides,
        simulateError: dependencies.simulateRecoveryError
      });
      if (advisory) {
        await persistRecoveryAdvisory(transactionId, advisory);
      }
    } catch (err) {
      console.error('[RecoveryAdvisor] Advisory generation failed (non-blocking):', err);
    }
  }

  const recovery = await query<{
    item_id: string;
    provider_name: string;
    provider_reference: string | null;
    error_message: string | null;
  }>(
    `SELECT item_id, provider_name, provider_reference, error_message FROM booking_transaction_providers WHERE transaction_id=$1 AND status='FAILED' AND operation_type='CANCEL'`,
    [transactionId]
  );

  const recoveryAdvisory = (await getRecoveryAdvisoryByTransactionId(transactionId)) ?? null;

  return {
    success: finalState === 'ROLLED_BACK',
    transactionId,
    state: finalState,
    compensationResults,
    payment: paymentResult,
    recoveryRequired: recovery.rows.map(r => ({
      itemId: r.item_id,
      provider: r.provider_name,
      reference: r.provider_reference,
      error: r.error_message
    })),
    recoveryAdvisory
  };
}

/**
 * Returns complete auditable details for a transaction:
 * status, items, providers, events, payment, and recovery information.
 */
export async function getTransactionDetails(transactionId: string) {
  const txRes = await query<{
    id: string;
    customer_id: string;
    status: TransactionState;
    currency: string;
    total_amount: number;
    created_at: Date;
    updated_at: Date;
  }>('SELECT id, customer_id, status, currency, total_amount, created_at, updated_at FROM booking_transactions WHERE id = $1', [transactionId]);

  if (!txRes.rows[0]) {
    throw new TransactionEngineError('Transaction was not found', 'TRANSACTION_NOT_FOUND', 404);
  }
  const tx = txRes.rows[0];

  const itemsRes = await query<{
    id: string;
    position: number;
    resource_type: ResourceType;
    resource_id: string;
    quantity: number;
    status: string;
    provider_name: string | null;
    unit_price: number | null;
    currency: string | null;
    created_at: Date;
  }>('SELECT id, position, resource_type, resource_id, quantity, status, provider_name, unit_price, currency, created_at FROM booking_transaction_items WHERE transaction_id = $1 ORDER BY position ASC', [transactionId]);

  const providersRes = await query<{
    id: string;
    item_id: string;
    provider_name: string;
    status: string;
    operation_type: string;
    provider_reference: string | null;
    error_message: string | null;
    updated_at: Date;
  }>('SELECT id, item_id, provider_name, status, operation_type, provider_reference, error_message, updated_at FROM booking_transaction_providers WHERE transaction_id = $1 ORDER BY item_id', [transactionId]);

  const eventsRes = await query<{
    id: string;
    item_id: string | null;
    from_state: string | null;
    to_state: string;
    detail: any;
    created_at: Date;
  }>('SELECT id, item_id, from_state, to_state, detail, created_at FROM booking_transaction_events WHERE transaction_id = $1 ORDER BY id ASC', [transactionId]);

  const recovery = await query<{
    item_id: string;
    provider_name: string;
    provider_reference: string | null;
    error_message: string | null;
  }>(
    `SELECT item_id, provider_name, provider_reference, error_message FROM booking_transaction_providers WHERE transaction_id=$1 AND status='FAILED' AND operation_type='CANCEL' ORDER BY item_id`,
    [transactionId]
  );

  // Read-only view of resource locks so operators can see unresolved (CONFIRMED) locks.
  const locksRes = await query<{
    id: string;
    item_id: string;
    resource_type: ResourceType;
    resource_id: string;
    quantity: number;
    status: string;
    expires_at: Date;
    created_at: Date;
  }>('SELECT id, item_id, resource_type, resource_id, quantity, status, expires_at, created_at FROM booking_resource_locks WHERE transaction_id = $1 ORDER BY created_at ASC, id ASC', [transactionId]);

  const itemStates: Record<string, string> = {};
  for (const it of itemsRes.rows) {
    itemStates[it.id] = it.status;
  }

  return {
    transaction: {
      id: tx.id,
      customerId: tx.customer_id,
      status: tx.status,
      currency: tx.currency,
      totalAmount: Number(tx.total_amount),
      createdAt: tx.created_at,
      updatedAt: tx.updated_at
    },
    items: itemsRes.rows.map(i => ({
      id: i.id,
      position: i.position,
      type: i.resource_type,
      resourceId: i.resource_id,
      quantity: i.quantity,
      status: i.status,
      provider: i.provider_name,
      unitPrice: i.unit_price ? Number(i.unit_price) : null,
      currency: i.currency
    })),
    itemStates,
    providers: providersRes.rows.map(p => ({
      id: p.id,
      itemId: p.item_id,
      provider: p.provider_name,
      status: p.status,
      operation: p.operation_type,
      reference: p.provider_reference,
      error: p.error_message,
      updatedAt: p.updated_at
    })),
    events: eventsRes.rows.map(e => ({
      id: e.id,
      itemId: e.item_id,
      fromState: e.from_state,
      toState: e.to_state,
      detail: e.detail,
      createdAt: e.created_at
    })),
    locks: locksRes.rows.map(l => ({
      id: l.id,
      itemId: l.item_id,
      resourceType: l.resource_type,
      resourceId: l.resource_id,
      quantity: l.quantity,
      status: l.status,
      expiresAt: l.expires_at,
      createdAt: l.created_at
    })),
    recoveryRequired: recovery.rows.map(r => ({
      itemId: r.item_id,
      provider: r.provider_name,
      reference: r.provider_reference,
      error: r.error_message
    })),
    riskAssessment: (await getRiskAssessmentByTransactionId(transactionId)) ?? null,
    recoveryAdvisory: (await getRecoveryAdvisoryByTransactionId(transactionId)) ?? null
  };
}

export interface TransactionListOptions {
  limit?: number;
  offset?: number;
}

/**
 * Read-only, paginated transaction summaries for the operations dashboard.
 * Deliberately omits customer identifiers and item/provider details; callers
 * load full details through getTransactionDetails.
 */
export async function listTransactions(options: TransactionListOptions = {}) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);

  const totalRes = await query<{ total: number }>('SELECT count(*)::int AS total FROM booking_transactions');
  const rows = await query<{
    id: string;
    status: TransactionState;
    currency: string;
    total_amount: number;
    created_at: Date;
    updated_at: Date;
    item_count: number;
    risk_score: number | null;
    risk_level: string | null;
    recommendation: string | null;
    recovery_severity: string | null;
  }>(
    `SELECT t.id, t.status, t.currency, t.total_amount, t.created_at, t.updated_at,
            (SELECT count(*)::int FROM booking_transaction_items i WHERE i.transaction_id = t.id) AS item_count,
            r.risk_score, r.risk_level, a.recommendation, a.severity AS recovery_severity
       FROM booking_transactions t
       LEFT JOIN LATERAL (
         SELECT risk_score, risk_level FROM booking_transaction_risk_assessments
          WHERE transaction_id = t.id ORDER BY calculated_at DESC LIMIT 1
       ) r ON true
       LEFT JOIN LATERAL (
         SELECT recommendation, severity FROM booking_transaction_recovery_advisories
          WHERE transaction_id = t.id ORDER BY generated_at DESC LIMIT 1
       ) a ON true
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return {
    total: totalRes.rows[0]?.total ?? 0,
    limit,
    offset,
    transactions: rows.rows.map(r => ({
      transactionId: r.id,
      state: r.status,
      currency: r.currency,
      totalAmount: Number(r.total_amount),
      itemCount: r.item_count,
      riskScore: r.risk_score === null ? null : Number(r.risk_score),
      riskLevel: r.risk_level,
      recoveryRecommendation: r.recommendation,
      recoverySeverity: r.recovery_severity,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  };
}
