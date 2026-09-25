import {
  MalformedResponseError,
  parseDemoScenarios,
  parseSystemHealth,
  parseTransactionDetails,
  parseTransactionPage,
  parseCustomerResolution,
  type CustomerResolution,
  type DemoScenario,
  type SystemHealth,
  type TransactionDetails,
  type TransactionPage
} from './transactionModel';

const BASE_URL = import.meta.env.VITE_API_URL || '';

export async function fetchInventory() {
  const res = await fetch(`${BASE_URL}/api/inventory`);
  return await res.json();
}

export async function fetchInvariants() {
  const res = await fetch(`${BASE_URL}/api/inventory/invariants`);
  return await res.json();
}

export async function fetchDashboardSnapshot(inventoryId?: string) {
  const url = inventoryId 
    ? `${BASE_URL}/api/inventory/dashboard-snapshot?inventoryId=${inventoryId}`
    : `${BASE_URL}/api/inventory/dashboard-snapshot`;
  const res = await fetch(url);
  return await res.json();
}

export async function createHold(inventoryId: string, quantity = 1, ttlSeconds = 60, travellerId = 'traveller_priya', idempotencyKey: string = crypto.randomUUID()) {
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    try {
      const res = await fetch(`${BASE_URL}/api/bookings/hold`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({ travellerId, inventoryId, quantity, ttlSeconds })
      });
      const data = await res.json();
      
      if (!res.ok) {
        if (res.status >= 500 && attempt < maxAttempts - 1) {
          attempt++;
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        throw data;
      }
      return data;
    } catch (err: any) {
      if (attempt < maxAttempts - 1 && (!err.error || err.status >= 500)) {
        attempt++;
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
}

export async function confirmBooking(
  bookingId: string, 
  travellerName: string, 
  idempotencyKey: string, 
  language = 'en',
  passengerDetails?: any,
  paymentDetails?: any
) {
  const res = await fetch(`${BASE_URL}/api/bookings/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({ bookingId, travellerName, language, passengerDetails, paymentDetails })
  });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

export async function getBooking(id: string) {
  const res = await fetch(`${BASE_URL}/api/bookings/${id}`);
  return await res.json();
}

export async function fetchActiveHold(travellerId = 'traveller_priya') {
  const res = await fetch(`${BASE_URL}/api/bookings/active-hold?travellerId=${travellerId}`);
  return await res.json();
}

export async function convertCurrency(amountInr: number, to: 'INR' | 'USD' | 'EUR' | 'GBP') {
  const res = await fetch(`${BASE_URL}/api/currency/convert?amount=${encodeURIComponent(String(amountInr))}&to=${to}`);
  const data = await res.json();
  if (!res.ok) throw data;
  return data as { success: boolean; baseAmount: number; currency: string; symbol: string; convertedAmount: number; rateType: 'fixed_demo_rate' };
}

export async function fetchReconciliations() {
  const res = await fetch(`${BASE_URL}/api/reconciliation/pending`);
  return await res.json();
}

export async function applyReconciliation(bookingId: string, decisionId: string | undefined, action: 'CONFIRM' | 'FAIL', operatorName = 'Ops Officer (Lalith)') {
  const res = await fetch(`${BASE_URL}/api/reconciliation/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId, decisionId, action, operatorName })
  });
  return await res.json();
}

export async function getProviderMode() {
  const res = await fetch(`${BASE_URL}/api/demo/provider-mode`);
  return await res.json();
}

export async function setProviderMode(mode: 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'DELAY', timeoutGroundTruth?: 'CONFIRMED' | 'FAILED') {
  const res = await fetch(`${BASE_URL}/api/demo/provider-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, timeoutGroundTruth })
  });
  return await res.json();
}

export async function runDuplicateStorm() {
  const res = await fetch(`${BASE_URL}/api/demo/duplicate-storm`, { method: 'POST' });
  return await res.json();
}

export async function runConcurrencyStampede(totalUsers = 500, inventoryId = 'flt_blr_goi_ix6534') {
  const res = await fetch(`${BASE_URL}/api/demo/concurrency-stampede`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalUsers, inventoryId })
  });
  return await res.json();
}

export async function runAbandonedHoldDemo(ttlSeconds = 15) {
  const res = await fetch(`${BASE_URL}/api/demo/abandon-hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttlSeconds })
  });
  return await res.json();
}

export async function runTwoLegCompensation() {
  const res = await fetch(`${BASE_URL}/api/demo/two-leg-compensation`, { method: 'POST' });
  return await res.json();
}

export async function resetDatabase() {
  const res = await fetch(`${BASE_URL}/api/demo/reset`, { method: 'POST' });
  return await res.json();
}

// Plugin SDK & Double Booking Race Simulator API
export async function simulateRace(inventoryId = 'htl_last_room_suite') {
  const res = await fetch(`${BASE_URL}/api/plugin/simulate-race`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryId })
  });
  return await res.json();
}

export async function fetchPluginSpecs() {
  const res = await fetch(`${BASE_URL}/api/plugin/specs`);
  return await res.json();
}

// Trip Disruption & Hotel Partner Compensation Sentinel API
export async function simulateTripDisruption() {
  const res = await fetch(`${BASE_URL}/api/trip/disruption-simulate`, { method: 'POST' });
  return await res.json();
}

export async function resolveTripDisruption(bookingId: string, action: 'ACCEPT_ALTERNATIVE' | 'DECLINE_CANCEL', alternativeFlightId?: string) {
  const res = await fetch(`${BASE_URL}/api/trip/disruption-resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId, action, alternativeFlightId })
  });
  return await res.json();
}

// Multi-Modal Real-Time Search API
export async function searchInventory(params: {
  resource_type?: string;
  origin?: string;
  destination?: string;
  date?: string;
  min_price?: number;
  max_price?: number;
  sort_by?: string;
}) {
  const query = new URLSearchParams();
  if (params.resource_type) query.set('resource_type', params.resource_type);
  if (params.origin) query.set('origin', params.origin);
  if (params.destination) query.set('destination', params.destination);
  if (params.date) query.set('date', params.date);
  if (params.min_price) query.set('min_price', params.min_price.toString());
  if (params.max_price) query.set('max_price', params.max_price.toString());
  if (params.sort_by) query.set('sort_by', params.sort_by);

  const res = await fetch(`${BASE_URL}/api/inventory/search?${query.toString()}`);
  return await res.json();
}

// Real-Time Live Activity Ticker Feed
export async function fetchLiveActivity() {
  const res = await fetch(`${BASE_URL}/api/inventory/live-activity`);
  return await res.json();
}

// My Trips & Bookings Dashboard API
export async function fetchMyTrips(travellerId = 'traveller_priya') {
  const res = await fetch(`${BASE_URL}/api/bookings/my-trips?travellerId=${travellerId}`);
  return await res.json();
}

// Booking Cancellation API
// Persistent Ops History (survives browser refresh)
export async function fetchTraceHistory(limit = 6000) {
  const res = await fetch(`${BASE_URL}/api/ops/traces?limit=${limit}`);
  return await res.json();
}

export async function fetchBookingEventHistory(limit = 200) {
  const res = await fetch(`${BASE_URL}/api/ops/booking-events?limit=${limit}`);
  return await res.json();
}

export async function cancelBooking(bookingId: string, reason?: string) {
  const res = await fetch(`${BASE_URL}/api/bookings/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId, reason })
  });
  return await res.json();
}



// ---- Booking engine: status / release / inventory detail ----
export async function getBookingStatus(bookingId: string) {
  const res = await fetch(`${BASE_URL}/api/bookings/${bookingId}/status`);
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function releaseHold(bookingId: string, reason?: string) {
  const res = await fetch(`${BASE_URL}/api/bookings/${bookingId}/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  return await res.json();
}

export async function fetchInventoryItem(inventoryId: string) {
  const res = await fetch(`${BASE_URL}/api/inventory/${inventoryId}`);
  return await res.json();
}

// ---- High-Demand / Tatkal prepared booking ----
async function prepRequest(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}/api/prepared-bookings${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

export const preparedBookings = {
  create: (travellerId = 'traveller_priya', mode: 'TATKAL' | 'HIGH_DEMAND' = 'TATKAL', windowOpensAt?: string) =>
    prepRequest('POST', '', { travellerId, mode, windowOpensAt }),
  get: (id: string) => prepRequest('GET', `/${id}`),
  list: (travellerId = 'traveller_priya') => prepRequest('GET', `?travellerId=${encodeURIComponent(travellerId)}`),
  setTrip: (id: string, trip: { origin: string; destination: string; travelDate: string; travelClass?: string }) =>
    prepRequest('PUT', `/${id}/trip`, trip),
  setPassengers: (id: string, passengers: Array<{ name: string; age: number; gender?: string; berthPreference?: string }>) =>
    prepRequest('PUT', `/${id}/passengers`, { passengers }),
  selectInventory: (id: string, inventoryId: string) => prepRequest('PUT', `/${id}/selection`, { inventoryId }),
  setPayment: (id: string, method: 'UPI' | 'CARD' | 'NETBANKING' | 'WALLET', label?: string) =>
    prepRequest('PUT', `/${id}/payment`, { method, label }),
  setWindow: (id: string, windowOpensAt: string | null) => prepRequest('PUT', `/${id}/window`, { windowOpensAt }),
  approve: (id: string) => prepRequest('POST', `/${id}/approve`, { userApproved: true }),
  execute: (id: string, ttlSeconds?: number) => prepRequest('POST', `/${id}/execute`, { ttlSeconds }),
  cancel: (id: string) => prepRequest('POST', `/${id}/cancel`, {})
};

// ---- Transaction Operations dashboard (read-only, plus explicit demo scenario submission) ----

export type TransactionApiErrorKind = 'NOT_FOUND' | 'UNREACHABLE' | 'MALFORMED' | 'HTTP';

export class TransactionApiError extends Error {
  constructor(readonly kind: TransactionApiErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = 'TransactionApiError';
  }
}

export async function requestJson(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    throw new TransactionApiError('UNREACHABLE', 'Unable to connect to BookGuard backend.');
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Proxies answer 5xx with HTML when the backend is down.
    if (res.status >= 500) throw new TransactionApiError('UNREACHABLE', 'Unable to connect to BookGuard backend.', res.status);
    throw new TransactionApiError('MALFORMED', 'Received an unexpected transaction response.', res.status);
  }
  return { status: res.status, body };
}

function httpError(status: number, body: unknown): TransactionApiError {
  const message = typeof body === 'object' && body !== null && typeof (body as any).message === 'string'
    ? (body as any).message
    : `Request failed (${status})`;
  return new TransactionApiError('HTTP', message, status);
}

function parseOrThrow<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    if (err instanceof MalformedResponseError) {
      throw new TransactionApiError('MALFORMED', 'Received an unexpected transaction response.');
    }
    throw err;
  }
}

export async function fetchSystemHealth(): Promise<SystemHealth> {
  const { status, body } = await requestJson('/api/health');
  if (status !== 200) throw httpError(status, body);
  return parseOrThrow(() => parseSystemHealth(body));
}

export async function fetchTransactionPage(limit = 20, offset = 0): Promise<TransactionPage> {
  const { status, body } = await requestJson(`/api/transactions?limit=${limit}&offset=${offset}`);
  if (status !== 200) throw httpError(status, body);
  return parseOrThrow(() => parseTransactionPage(body));
}

export async function fetchTransactionDetails(transactionId: string): Promise<TransactionDetails> {
  const { status, body } = await requestJson(`/api/transactions/${encodeURIComponent(transactionId)}`);
  if (status === 404) throw new TransactionApiError('NOT_FOUND', 'Transaction not found.', 404);
  if (status !== 200) throw httpError(status, body);
  return parseOrThrow(() => parseTransactionDetails(body));
}

export async function fetchDemoScenarios(): Promise<DemoScenario[]> {
  const { status, body } = await requestJson('/api/transactions/demo-scenarios');
  if (status !== 200) throw httpError(status, body);
  return parseOrThrow(() => parseDemoScenarios(body));
}

/**
 * Submits a demo scenario's request to the real POST /api/transactions endpoint.
 * The saga answers 201 for COMPLETED and 409 for rolled-back outcomes; both carry the persisted transaction ID.
 */
export async function submitDemoScenario(scenario: DemoScenario, idempotencyKey: string): Promise<{ transactionId: string; state: string }> {
  const { status, body } = await requestJson('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(scenario.request)
  });
  const b = body as any;
  if ((status === 201 || status === 409) && typeof b?.transactionId === 'string' && typeof b?.state === 'string') {
    return { transactionId: b.transactionId, state: b.state };
  }
  throw httpError(status, body);
}

// ---- Phase 10: customer resolution (read-only lookup + replacement booking through the normal saga) ----

export async function fetchCustomerResolution(transactionId: string): Promise<CustomerResolution> {
  const { status, body } = await requestJson(`/api/transactions/${encodeURIComponent(transactionId)}/resolution`);
  if (status === 404) throw new TransactionApiError('NOT_FOUND', 'Transaction not found.', 404);
  if (status !== 200) throw httpError(status, body);
  return parseOrThrow(() => parseCustomerResolution(body));
}

/**
 * Books a NEW transaction with the failed service swapped for the chosen alternative. The backend
 * re-validates the alternative and runs the normal idempotent saga; 201 = completed, 409 = rolled back.
 */
export async function submitReplacement(
  transactionId: string,
  alternativeResourceId: string,
  idempotencyKey: string
): Promise<{ transactionId: string; state: string }> {
  const { status, body } = await requestJson(`/api/transactions/${encodeURIComponent(transactionId)}/replacement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ alternativeResourceId })
  });
  const b = body as any;
  if ((status === 201 || status === 409) && typeof b?.transactionId === 'string' && typeof b?.state === 'string') {
    return { transactionId: b.transactionId, state: b.state };
  }
  throw httpError(status, body);
}
