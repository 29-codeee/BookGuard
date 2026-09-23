import { query, withTransaction, TransactionClient } from '../db/client.js';
import { providerAdapter } from '../providers/adapter.js';
import { eventHub } from '../sse/eventHub.js';

export interface CopilotRecommendation {
  decision: 'CONFIRM' | 'FAIL' | 'SAFE_RETRY' | 'ESCALATE';
  confidence: number;
  evidence_ids: string[];
  reason: string;
}

export interface StoredAiDecision extends CopilotRecommendation {
  id: string;
  bookingId: string;
  appliedBy: string | null;
  appliedAt: string | null;
  createdAt: string;
}

/**
 * Evaluates a booking in RECONCILING state using grounded SQL context and provider ground truth.
 * Returns strict schema-validated recommendation. Does NOT modify booking state.
 */
export async function runReconciliationCopilot(bookingId: string): Promise<StoredAiDecision> {
  console.log(`[Copilot] Running reconciliation analysis for booking ${bookingId}...`);

  // 1. Fetch booking context from read-only query
  const bRes = await query<{
    id: string;
    status: string;
    total_amount: number;
    traveller_name: string;
    language_pref: string;
    flight_code: string;
    flight_name: string;
  }>(
    `SELECT b.id, b.status, b.total_amount, t.name as traveller_name, t.language_pref,
            i.code as flight_code, i.name as flight_name
     FROM bookings b
     JOIN travellers t ON b.traveller_id = t.id
     LEFT JOIN booking_items bi ON b.id = bi.booking_id
     LEFT JOIN inventory i ON bi.inventory_id = i.id
     WHERE b.id = $1`,
    [bookingId]
  );

  if (bRes.rowCount === 0) {
    throw new Error(`Booking ${bookingId} not found`);
  }
  const booking = bRes.rows[0];

  // 2. Fetch booking events timeline
  const evRes = await query<{
    id: string;
    from_state: string;
    to_state: string;
    reason: string;
    evidence: any;
    created_at: string;
  }>(
    `SELECT id, from_state, to_state, reason, evidence, created_at
     FROM booking_events
     WHERE booking_id = $1
     ORDER BY created_at ASC`,
    [bookingId]
  );
  const events = evRes.rows;

  // 3. Query external provider status via Adapter (never guess, always ask provider)
  const providerStatus = await providerAdapter.getStatus(bookingId);

  // 4. Synthesize decision using strict rules & deterministic intelligence
  let decision: 'CONFIRM' | 'FAIL' | 'SAFE_RETRY' | 'ESCALATE' = 'ESCALATE';
  let confidence = 50;
  let reason = '';
  const evidenceIds: string[] = events.map(e => e.id);

  if (providerStatus.exists && providerStatus.status === 'CONFIRMED') {
    decision = 'CONFIRM';
    confidence = 94;
    reason = `Provider GDS verification confirmed active reservation PNR: ${providerStatus.providerRef}. Airline ticket exists; safe to confirm booking.`;
    evidenceIds.push(`provider_pnr_${providerStatus.providerRef}`);
  } else if (providerStatus.status === 'FAILED' || (providerStatus.rawResponse && providerStatus.rawResponse.code === 'NO_ROOMS_LEFT')) {
    decision = 'FAIL';
    confidence = 98;
    reason = `Provider explicitly rejected reservation (${providerStatus.rawResponse?.reason || 'Allocation refused'}). Seat should be released.`;
  } else if (!providerStatus.exists && providerStatus.status === 'NOT_FOUND') {
    decision = 'FAIL';
    confidence = 91;
    reason = `Provider reservation inquiry returned NOT_FOUND after timeout window. No ticket was created by airline; release held seat and offer recovery.`;
  } else {
    decision = 'ESCALATE';
    confidence = 45;
    reason = `Ambiguous response from supplier endpoint. Manual supervisor review required before modifying state.`;
  }

  // 5. Store recommendation into ai_decisions table (read-only advisory, NOT applied yet)
  const decisionId = `aid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await query(
    `INSERT INTO ai_decisions (id, booking_id, recommendation, confidence, evidence_ids, reason, applied_by)
     VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
    [
      decisionId,
      bookingId,
      decision,
      confidence,
      JSON.stringify(evidenceIds),
      reason
    ]
  );

  const storedDecision: StoredAiDecision = {
    id: decisionId,
    bookingId,
    decision,
    confidence,
    evidence_ids: evidenceIds,
    reason,
    appliedBy: null,
    appliedAt: null,
    createdAt: new Date().toISOString()
  };

  // Broadcast to Ops Dashboard over SSE
  eventHub.broadcast('copilot_recommendation', {
    ...storedDecision,
    booking,
    providerStatus
  });

  return storedDecision;
}

export async function getAiDecisions(bookingId?: string) {
  const res = await query(
    `SELECT * FROM ai_decisions ${bookingId ? 'WHERE booking_id = $1' : ''} ORDER BY created_at DESC LIMIT 50`,
    bookingId ? [bookingId] : []
  );
  return res.rows;
}
