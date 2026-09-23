import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    stampede: {
      executor: 'per-vu-iterations',
      vus: 500,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<1'], // Some will get 409, which is expected
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3001';

export default function () {
  const vuId = __VU;
  const inventoryId = 'flt_blr_goi_ix6534';

  const holdPayload = JSON.stringify({
    travellerId: `traveller_vu_${vuId}`,
    inventoryId: inventoryId,
    quantity: 1,
    ttlSeconds: 600,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(`${BASE_URL}/api/bookings/hold`, holdPayload, params);

  // Status must be either 201 Created (got seat) or 409 Conflict (safely rejected)
  check(res, {
    'status is 201 or 409': (r) => r.status === 201 || r.status === 409,
    'no 500 internal errors': (r) => r.status !== 500,
  });

  // If hold granted, attempt confirmation with an idempotency key
  if (res.status === 201) {
    const holdData = JSON.parse(res.body);
    const bookingId = holdData.hold.bookingId;
    const idempotencyKey = `k6_idem_${bookingId}`;

    const confirmPayload = JSON.stringify({
      bookingId: bookingId,
      travellerName: `K6 VU ${vuId}`,
    });

    const confirmParams = {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
    };

    const confirmRes = http.post(`${BASE_URL}/api/bookings/confirm`, confirmPayload, confirmParams);
    check(confirmRes, {
      'confirm succeeded': (r) => r.status === 200,
    });
  }

  sleep(0.1);
}

export function handleSummary(data) {
  // Query final inventory from backend
  const invRes = http.get(`${BASE_URL}/api/inventory/invariants`);
  const inv = JSON.parse(invRes.body);

  const out = `
=========================================================
BOOKGUARD K6 LOAD TEST VERDICT: 500 VUs vs 3 SEATS
=========================================================
Total Virtual Users:       500
Initial Available Seats:   3
Confirmed Bookings:        ${inv.auditCounters.confirmedBookings}
Active Holds:              ${inv.auditCounters.activeHolds}
Total Cleanly Rejected:    ${500 - (inv.auditCounters.confirmedBookings + inv.auditCounters.activeHolds)}
Oversold Seats:            ${inv.auditCounters.oversold} (TARGET: 0)
Duplicate Bookings:        ${inv.auditCounters.duplicateBookings} (TARGET: 0)
Invariant Status:          ${inv.inventory.equation}
Invariant Check Passed:    ${inv.inventory.invariantValid ? 'YES [OK]' : 'NO [VIOLATION]'}
=========================================================
`;

  console.log(out);
  return {
    stdout: out,
  };
}
