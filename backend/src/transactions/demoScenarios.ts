import { query } from '../db/client.js';
import { FailureScenarioSimulations, type InjectedFailures } from '../providers/datasetAdapters.js';
import type { PaymentFailureConfig } from './payment.js';
import type { RequestedItem, ResourceType } from './types.js';
import type { TransactionState } from './stateMachine.js';
import { TransactionEngineError } from './errors.js';

/**
 * Read-only catalog of deterministic demo scenarios for the operations dashboard.
 *
 * This module never creates transactions. It only resolves real research-dataset
 * resource IDs (without locking or mutating them) and returns request payloads that
 * the operator may explicitly submit to POST /api/transactions. Failure injection
 * reuses the Phase 4 FailureScenarioSimulations and the MockPaymentService failure
 * config, so every result is produced by the real Saga engine and persisted normally.
 */

export interface DemoScenarioRequest {
  customerId: string;
  items: RequestedItem[];
  paymentMethod: string;
  failureSimulation?: InjectedFailures;
  paymentFailureSimulation?: PaymentFailureConfig;
}

export interface DemoScenario {
  id: 'SUCCESSFUL_BOOKING' | 'PROVIDER_FAILURE_ROLLBACK' | 'PAYMENT_FAILURE' | 'ROLLBACK_FAILURE';
  label: string;
  description: string;
  expectedState: TransactionState;
  source: string;
  request: DemoScenarioRequest;
}

// Mirrors the capacity accounting in reserveTransactionResources: CONFIRMED and unexpired ACTIVE locks consume capacity.
const lockedQuantity = (type: ResourceType, idColumn: string) => `COALESCE((
  SELECT SUM(l.quantity) FROM booking_resource_locks l
   WHERE l.resource_type='${type}' AND l.resource_id=${idColumn}
     AND (l.status='CONFIRMED' OR (l.status='ACTIVE' AND l.expires_at>CURRENT_TIMESTAMP))
), 0)`;

const RESOURCE_QUERIES: Record<'hotel' | 'flight' | 'transport', string> = {
  hotel: `SELECT i.room_inventory_id AS resource_id FROM dataset_room_inventory i
           WHERE i.currency='INR' AND i.available_rooms - ${lockedQuantity('hotel', 'i.room_inventory_id')} >= 1
           ORDER BY i.room_inventory_id LIMIT 1`,
  flight: `SELECT f.flight_id AS resource_id FROM dataset_flights f
            WHERE f.currency='INR' AND f.available_seats - ${lockedQuantity('flight', 'f.flight_id')} >= 1
            ORDER BY f.flight_id LIMIT 1`,
  transport: `SELECT i.transport_inventory_id AS resource_id FROM dataset_transport_inventory i
               JOIN dataset_vehicles v ON v.vehicle_id=i.vehicle_id
               WHERE v.currency='INR' AND i.available_units - ${lockedQuantity('transport', 'i.transport_inventory_id')} >= 1
               ORDER BY i.transport_inventory_id LIMIT 1`
};

async function firstResourceId(type: 'hotel' | 'flight' | 'transport'): Promise<string | null> {
  const res = await query<{ resource_id: string }>(RESOURCE_QUERIES[type]);
  return res.rows[0]?.resource_id ?? null;
}

export async function getDemoScenarioCatalog(): Promise<DemoScenario[]> {
  const customer = await query<{ customer_id: string }>('SELECT customer_id FROM dataset_customers ORDER BY customer_id LIMIT 1');
  const customerId = customer.rows[0]?.customer_id;
  const [hotel, flight, transport] = await Promise.all([
    firstResourceId('hotel'),
    firstResourceId('flight'),
    firstResourceId('transport')
  ]);

  if (!customerId || !hotel || !flight || !transport) {
    throw new TransactionEngineError(
      'Research dataset has no customer or no available INR hotel/flight/transport resources for demo scenarios',
      'DEMO_RESOURCES_UNAVAILABLE',
      503
    );
  }

  // Hotel -> flight -> transport, so failures and LIFO compensation match the Phase 4 scenario definitions.
  const items: RequestedItem[] = [
    { type: 'hotel', resourceId: hotel, quantity: 1 },
    { type: 'flight', resourceId: flight, quantity: 1 },
    { type: 'transport', resourceId: transport, quantity: 1 }
  ];
  const base = { customerId, items, paymentMethod: 'card_mock' };

  return [
    {
      id: 'SUCCESSFUL_BOOKING',
      label: 'Successful Booking',
      description: 'All three providers reserve and confirm; payment is authorized and captured.',
      expectedState: 'COMPLETED',
      source: 'FailureScenarios.scenarioC',
      request: { ...base, failureSimulation: FailureScenarioSimulations.scenarioC }
    },
    {
      id: 'PROVIDER_FAILURE_ROLLBACK',
      label: 'Provider Failure → Rollback Success',
      description: 'Transport reservation fails; flight and hotel are compensated in reverse order and payment is voided.',
      expectedState: 'ROLLED_BACK',
      source: 'FailureScenarios.scenarioD',
      request: { ...base, failureSimulation: FailureScenarioSimulations.scenarioD }
    },
    {
      id: 'PAYMENT_FAILURE',
      label: 'Payment Failure',
      description: 'Payment authorization is declined before any provider is contacted; locks are released.',
      expectedState: 'ROLLED_BACK',
      source: 'MockPaymentService authorize failure',
      request: { ...base, paymentFailureSimulation: { authorize: 'Demo: payment authorization declined' } }
    },
    {
      id: 'ROLLBACK_FAILURE',
      label: 'Rollback Failure',
      description: 'Transport reservation fails and flight cancellation also fails; the flight lock stays CONFIRMED and recovery is advised.',
      expectedState: 'ROLLBACK_FAILED',
      source: 'FailureScenarios.scenarioE',
      request: { ...base, failureSimulation: FailureScenarioSimulations.scenarioE }
    }
  ];
}
