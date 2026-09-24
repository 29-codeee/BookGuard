import React, { useState } from 'react';
import {
  derivePaymentSummary,
  findUnresolvedLocks,
  type TransactionDetails
} from '../../services/transactionModel';
import { fetchInventory, requestJson } from '../../services/api';
import { StatusBadge, humanize, formatInr, shortId, Mono } from './ui';

interface Props {
  details: TransactionDetails;
  onAlternativeSelected?: (transactionId: string) => void;
}

interface InventoryItem {
  id: string;
  resource_type: string;
  name: string;
  code?: string;
  price: number;
  available_quantity: number;
  origin?: string;
  destination?: string;
}

export const CustomerResolutionCard: React.FC<Props> = ({ details, onAlternativeSelected }) => {
  // Normal successful transactions do not incorrectly show failure resolution.
  if (details.state === 'COMPLETED') {
    return null;
  }

  // When compensation itself fails: show the Action Required / Operator Warning.
  if (details.state === 'ROLLBACK_FAILED') {
    const unresolved = findUnresolvedLocks(details);
    const recommendation = details.recoveryAdvisory?.recommendation || 'MANUAL_OPERATOR_REVIEW';

    return (
      <section className="txops-section kind-action" aria-labelledby="txops-action-required-title">
        <header className="txops-section-head">
          <div>
            <span className="txops-kind kind-action">Action Required · Quarantined Lock</span>
            <h3 id="txops-action-required-title">Incident Resolution Required</h3>
            <p className="txops-sub">
              BookGuard could not safely complete the rollback of one reservation. The affected resource remains
              protected while the incident is resolved.
            </p>
          </div>
        </header>

        <div className="txops-callout tone-fail" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong style={{ fontSize: '1rem', color: '#fca5a5' }}>
                Recovery recommendation: {humanize(recommendation)}
              </strong>
              <p style={{ marginTop: 6, color: '#e2e8f0', fontSize: '0.86rem' }}>
                {unresolved.length > 0
                  ? `${unresolved.length} reservation lock(s) remain CONFIRMED to prevent double-booking or inventory leaks.`
                  : 'A critical provider failure occurred during reverse compensation. Automated recovery halted.'}
              </p>
            </div>
            <a href="#txops-recovery-title" className="txops-btn" style={{ textDecoration: 'none' }}>
              View Recovery Details
            </a>
          </div>
        </div>
      </section>
    );
  }

  // When normal rollback succeeds: show Customer Resolution.
  if (details.state !== 'ROLLED_BACK') {
    return null;
  }

  return <RolledBackCustomerResolution details={details} onAlternativeSelected={onAlternativeSelected} />;
};

function RolledBackCustomerResolution({ details, onAlternativeSelected }: Props) {
  const [activeTab, setActiveTab] = useState<'CHOICE' | 'ALTERNATIVE' | 'REFUND'>('CHOICE');
  const [alternatives, setAlternatives] = useState<InventoryItem[] | null>(null);
  const [altLoading, setAltLoading] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);
  const [selectedAlt, setSelectedAlt] = useState<InventoryItem | null>(null);
  const [submittingAlt, setSubmittingAlt] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ transactionId: string; state: string } | null>(null);

  // Identify which service / provider failed
  const failedProvider = details.providers.find(p => p.status === 'FAILED');
  const failedItem = details.items.find(i => i.status === 'FAILED' || (failedProvider && i.id === failedProvider.itemId));
  const failedCategory = failedItem?.type || 'transport';

  const payment = derivePaymentSummary(details);
  const refundAmount = payment.amount ?? details.totalAmount ?? 0;
  const refundStatus = payment.reversal === 'VOIDED' ? 'VOIDED' : 'REFUNDED';

  const loadAlternatives = async () => {
    setActiveTab('ALTERNATIVE');
    setAltLoading(true);
    setAltError(null);
    try {
      const data = await fetchInventory();
      if (data && Array.isArray(data.items)) {
        // Filter for matching resource type with available inventory
        const filtered = data.items.filter(
          (item: any) =>
            (item.resource_type === failedCategory || (failedCategory === 'transport' && ['flight', 'train', 'bus', 'transport'].includes(item.resource_type))) &&
            item.available_quantity > 0
        );
        setAlternatives(filtered);
      } else {
        setAlternatives([]);
      }
    } catch {
      setAltError('Unable to load alternative inventory.');
    } finally {
      setAltLoading(false);
    }
  };

  const handleBookReplacement = async (item: InventoryItem) => {
    setSubmittingAlt(true);
    try {
      const idempotencyKey = `customer-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const otherItems = details.items
        .filter(i => i.id !== failedItem?.id)
        .map(i => ({ type: i.type, resourceId: i.resourceId, quantity: i.quantity }));
      const replacementItems = [
        ...otherItems,
        { type: item.resource_type || failedCategory, resourceId: item.id, quantity: 1 }
      ];

      const res = await requestJson('/api/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          customerId: 'cust_priya_01',
          items: replacementItems,
          paymentMethod: 'card_mock'
        })
      });

      const body = res.body as any;
      if (body?.transactionId) {
        setSubmitResult({ transactionId: body.transactionId, state: body.state });
        onAlternativeSelected?.(body.transactionId);
      }
    } catch {
      setAltError('Failed to submit replacement transaction.');
    } finally {
      setSubmittingAlt(false);
    }
  };

  return (
    <section className="txops-section kind-resolution" aria-labelledby="txops-resolution-title">
      <header className="txops-section-head">
        <div>
          <span className="txops-kind kind-advisory">Customer Recovery · Prototype Demonstration</span>
          <h3 id="txops-resolution-title">Customer Resolution</h3>
          <p className="txops-sub">
            Your trip could not be completed because {failedCategory} was unavailable. The other reservations were
            safely cancelled and the payment is eligible for refund.
          </p>
        </div>
        <div className="txops-section-actions">
          {activeTab !== 'CHOICE' && (
            <button type="button" className="txops-btn ghost" onClick={() => setActiveTab('CHOICE')}>
              ← Back to options
            </button>
          )}
        </div>
      </header>

      {activeTab === 'CHOICE' && (
        <div style={{ marginTop: 14 }}>
          <p style={{ marginBottom: 16, fontSize: '0.92rem', color: '#e2e8f0' }}>
            What would you like to do?
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="txops-btn"
              onClick={loadAlternatives}
            >
              Find Alternative
            </button>
            <button
              type="button"
              className="txops-btn ghost"
              onClick={() => setActiveTab('REFUND')}
            >
              Get Refund
            </button>
          </div>
        </div>
      )}

      {activeTab === 'ALTERNATIVE' && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ fontSize: '0.95rem', color: '#38bdf8', marginBottom: 6 }}>
            ALTERNATIVE {failedCategory.toUpperCase()} OPTIONS
          </h4>
          <p className="txops-sub" style={{ marginBottom: 12 }}>
            Real available inventory retrieved from BookGuard&apos;s active database. Clearly labeled as alternatives.
          </p>

          {altLoading && <p className="txops-loading" role="status">Loading available alternatives…</p>}
          {altError && <p className="txops-alert tone-fail" role="alert">{altError}</p>}

          {!altLoading && !altError && alternatives && alternatives.length === 0 && (
            <p className="txops-empty">No alternative inventory available in the dataset for this sector.</p>
          )}

          {!altLoading && alternatives && alternatives.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginTop: 10 }}>
              {alternatives.slice(0, 6).map(alt => {
                const isSelected = selectedAlt?.id === alt.id;
                return (
                  <div
                    key={alt.id}
                    style={{
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: 10,
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <strong style={{ color: '#f8fafc', fontSize: '0.9rem' }}>{alt.name}</strong>
                      <span className="txops-badge tone-info" style={{ fontSize: '0.68rem' }}>
                        Alternative {alt.resource_type}
                      </span>
                    </div>
                    <div className="txops-muted" style={{ fontSize: '0.78rem' }}>
                      {alt.origin && alt.destination ? `${alt.origin} → ${alt.destination} · ` : ''}
                      {alt.available_quantity} available in inventory
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#34d399', margin: '4px 0' }}>
                      {formatInr(alt.price)}
                    </div>
                    <button
                      type="button"
                      className={`txops-btn${isSelected ? '' : ' ghost'}`}
                      style={{ marginTop: 'auto', padding: '6px 10px', fontSize: '0.78rem' }}
                      onClick={() => setSelectedAlt(alt)}
                    >
                      {isSelected ? '✓ Selected' : 'Select Alternative'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {selectedAlt && (
            <div className="txops-callout tone-info" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <strong>Selected replacement: {selectedAlt.name} ({formatInr(selectedAlt.price)})</strong>
                  <p style={{ marginTop: 4, fontSize: '0.84rem', color: '#cbd5e1' }}>
                    Replacement booking requires a new transaction. Proceeding will submit a new booking request to
                    BookGuard&apos;s Saga orchestrator with reservation locking, idempotency protection, risk assessment,
                    and payment authorization.
                  </p>
                </div>
                <button
                  type="button"
                  className="txops-btn"
                  disabled={submittingAlt}
                  onClick={() => handleBookReplacement(selectedAlt)}
                >
                  {submittingAlt ? 'Creating Transaction…' : 'Book Replacement via BookGuard Saga'}
                </button>
              </div>

              {submitResult && (
                <p style={{ marginTop: 10, color: '#34d399', fontWeight: 700 }}>
                  ✓ Replacement transaction created: <Mono>{shortId(submitResult.transactionId)}</Mono> with state{' '}
                  <StatusBadge status={submitResult.state} />.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'REFUND' && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ fontSize: '0.95rem', color: '#38bdf8', marginBottom: 6 }}>
            REFUND
          </h4>
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <span className="txops-muted" style={{ fontSize: '0.78rem' }}>Original payment</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>
                  {formatInr(refundAmount)}
                </div>
              </div>
              <div>
                <span className="txops-muted" style={{ fontSize: '0.78rem' }}>Refund status</span>
                <div>
                  <StatusBadge status={refundStatus} />
                </div>
              </div>
              <div>
                <span className="txops-muted" style={{ fontSize: '0.78rem' }}>Payment ID</span>
                <div style={{ fontSize: '0.85rem' }}>
                  <Mono>{payment.paymentId || 'pay_mock_refunded'}</Mono>
                </div>
              </div>
            </div>

            <hr style={{ borderColor: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem' }}>
              <div style={{ color: '#34d399', fontWeight: 600 }}>✓ Reservations cancelled</div>
              <div style={{ color: '#34d399', fontWeight: 600 }}>✓ Locks released</div>
              <div style={{ color: '#34d399', fontWeight: 600 }}>✓ Payment refunded</div>
            </div>

            <p className="txops-muted" style={{ fontSize: '0.75rem', marginTop: 4, borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: 8 }}>
              Prototype / Mock Payment Operation: Refund processed through BookGuard&apos;s simulated payment service.
              No actual banking transfer was executed.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
