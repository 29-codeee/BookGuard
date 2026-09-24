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

export async function createHold(inventoryId: string, quantity = 1, ttlSeconds = 600, travellerId = 'traveller_priya') {
  const idempotencyKey = crypto.randomUUID();
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
export async function cancelBooking(bookingId: string, reason?: string) {
  const res = await fetch(`${BASE_URL}/api/bookings/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId, reason })
  });
  return await res.json();
}


