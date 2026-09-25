import React, { useState } from 'react';
import {
  fetchCustomerResolution,
  fetchTransactionDetails,
  submitReplacement,
  TransactionApiError
} from '../../services/api';
import {
  buildProviderOperations,
  derivePaymentSummary,
  failedServiceType,
  type CustomerResolution,
  type ResolutionAlternative,
  type TransactionDetails
} from '../../services/transactionModel';
import { Mono, StatusBadge, formatMoney, shortId } from './ui';

const SERVICE_NOUN: Record<string, string> = { hotel: 'hotel', flight: 'flight', transport: 'transport', activity: 'activity' };
const noun = (type: string | null) => (type ? SERVICE_NOUN[type] ?? type : 'service');
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function apiMessage(err: unknown): string {
  if (err instanceof TransactionApiError) {
    if (err.kind === 'UNREACHABLE') return 'Unable to connect to BookGuard backend.';
    if (err.kind === 'MALFORMED') return 'Received an unexpected response.';
    if (err.kind === 'NOT_FOUND') return 'This booking could not be found.';
    return err.message;
  }
  return 'Something went wrong.';
}

function formatDate(date: string | null): string {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** What the customer should be told about their payment, from the recorded payment events. */
function paymentSentence(details: TransactionDetails): string {
  const p = derivePaymentSummary(details);
  if (p.authorization === 'FAILED') return 'Your payment was not authorized, so you were not charged.';
  if (p.reversal === 'REFUNDED') return 'Your payment has been refunded.';
  if (p.reversal === 'VOIDED') return 'The hold on your payment has been released, so you were not charged.';
  if (p.reversal === 'FAILED') return 'Your refund could not be confirmed yet.';
  if (!p.recorded) return 'No payment was taken.';
  return 'Your payment is eligible for a refund.';
}

// ---------- operator notice for ROLLBACK_FAILED ----------

const ActionRequired: React.FC<{ details: TransactionDetails }> = ({ details }) => {
  const recommendation = details.recoveryAdvisory?.recommendation ?? null;
  const viewDetails = () => {
    const target = document.getElementById('txops-recovery-title');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target?.focus();
  };
  return (
    <section className="txops-resolution is-action" aria-labelledby="txops-resolution-title">
      <span className="txops-kind kind-action">Action required · customer &amp; operator notice</span>
      <h3 id="txops-resolution-title">Action required</h3>
      <p>BookGuard could not safely complete the rollback of one reservation.</p>
      <p>The affected resource remains protected while the incident is resolved.</p>
      <dl className="txops-kv compact">
        <div>
          <dt>Recovery recommendation</dt>
          <dd>{recommendation ? <span className="txops-advice-code">{recommendation}</span> : <span className="txops-muted">No advisory recorded — verify manually</span>}</dd>
        </div>
      </dl>
      <p className="txops-footnote">Refunds and alternatives are not offered until an operator has verified the supplier state.</p>
      <button type="button" className="txops-btn" onClick={viewDetails}>View Recovery Details</button>
    </section>
  );
};

// ---------- find alternative ----------

const AlternativeCard: React.FC<{ alt: ResolutionAlternative; onSelect: () => void; disabled: boolean }> = ({ alt, onSelect, disabled }) => (
  <li className="txops-alt-card">
    <div className="txops-alt-head">
      <span className="txops-strong">{alt.provider}</span>
      <span className="txops-alt-price">{formatMoney(alt.unitPrice, alt.currency)}</span>
    </div>
    <p>{[alt.description, alt.location].filter(Boolean).join(' · ')}</p>
    <p className="txops-muted">
      {formatDate(alt.date)}{alt.endDate ? ` – ${formatDate(alt.endDate)}` : ''}{alt.time ? ` · ${alt.time}` : ''} · {alt.available} available
    </p>
    <span className={`txops-match ${alt.match === 'SAME_DATE' ? 'is-same' : 'is-other'}`}>
      {alt.match === 'SAME_DATE' ? 'Same date as your trip' : `Different date: ${formatDate(alt.date)}`}
    </span>
    <button type="button" className="txops-btn ghost" onClick={onSelect} disabled={disabled} aria-label={`Select alternative ${alt.provider}`}>
      Select alternative
    </button>
  </li>
);

const FindAlternative: React.FC<{ details: TransactionDetails; onOpenTransaction: (id: string) => void }> = ({ details, onOpenTransaction }) => {
  const [resolution, setResolution] = useState<CustomerResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ResolutionAlternative | null>(null);
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState<{ transactionId: string; state: string } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResolution(await fetchCustomerResolution(details.transactionId));
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setLoading(false);
    }
  }, [details.transactionId]);

  React.useEffect(() => { void load(); }, [load]);

  const book = async (alt: ResolutionAlternative) => {
    setBooking(true);
    setError(null);
    try {
      // Deterministic key: repeated clicks for the same choice replay instead of booking twice.
      setResult(await submitReplacement(details.transactionId, alt.resourceId, `replacement:${details.transactionId}:${alt.resourceId}`));
      setChosen(null);
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBooking(false);
    }
  };

  if (loading) return <p className="txops-muted" role="status">Looking for alternatives…</p>;
  if (error && !resolution) {
    return (
      <div>
        <p className="txops-alert tone-fail" role="alert">{error}</p>
        <button type="button" className="txops-btn ghost" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!resolution) return null;

  const failed = resolution.failedService;
  if (!failed) {
    return <p className="txops-empty">None of your services was unavailable, so there is nothing to replace. You can start a new booking or request a refund.</p>;
  }
  const type = noun(failed.type);

  if (result) {
    return (
      <div className="txops-callout" role="status">
        <p className="txops-strong">{result.state === 'COMPLETED' ? 'Your new booking is confirmed.' : 'The new booking could not be completed.'}</p>
        <p>
          New booking <Mono title={result.transactionId}>{shortId(result.transactionId)}</Mono> — <StatusBadge status={result.state} />
        </p>
        <button type="button" className="txops-btn" onClick={() => onOpenTransaction(result.transactionId)}>Open new booking</button>
      </div>
    );
  }

  return (
    <div>
      <h4 className="txops-h4">Alternative {type}</h4>
      {resolution.matchCriteria && <p className="txops-sub">{resolution.matchCriteria}</p>}
      {!resolution.alternativesSupported ? (
        <p className="txops-empty">Alternatives cannot be looked up for this booking.</p>
      ) : resolution.alternatives.length === 0 ? (
        <p className="txops-empty">No alternative {type} is currently available for this trip. You can request a refund instead.</p>
      ) : (
        <ul className="txops-alt-grid" aria-label={`Alternative ${type} options`}>
          {resolution.alternatives.map(alt => (
            <AlternativeCard key={alt.resourceId} alt={alt} onSelect={() => setChosen(alt)} disabled={booking} />
          ))}
        </ul>
      )}
      {error && <p className="txops-alert tone-fail" role="alert">{error}</p>}
      {chosen && (
        <div className="txops-confirm" role="alertdialog" aria-labelledby="txops-alt-confirm-title" aria-describedby="txops-alt-confirm-desc">
          <h4 id="txops-alt-confirm-title">Book with {chosen.provider}?</h4>
          <p id="txops-alt-confirm-desc">
            This makes a new booking for your whole trip, with {chosen.provider} ({formatMoney(chosen.unitPrice, chosen.currency)}) replacing
            the unavailable {type}. It goes through BookGuard&apos;s normal checks: availability hold, risk check, providers and the
            prototype mock payment. Your previous booking stays cancelled.
          </p>
          <div className="txops-inline">
            <button type="button" className="txops-btn" onClick={() => book(chosen)} disabled={booking}>
              {booking ? 'Booking…' : 'Confirm new booking'}
            </button>
            <button type="button" className="txops-btn ghost" onClick={() => setChosen(null)} disabled={booking}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------- refund ----------

const Check: React.FC<{ ok: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <li className={ok ? 'is-ok' : 'is-bad'}>
    <span aria-hidden="true">{ok ? '✓' : '✕'}</span> <span className="sr-only">{ok ? 'Done:' : 'Not done:'}</span> {children}
  </li>
);

const RefundStatus: React.FC<{ transactionId: string }> = ({ transactionId }) => {
  const [fresh, setFresh] = useState<TransactionDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    setFresh(null);
    try {
      // Re-read the persisted state so the customer sees the current payment status, not a cached view.
      setFresh(await fetchTransactionDetails(transactionId));
    } catch (err) {
      setError(apiMessage(err));
    }
  }, [transactionId]);

  React.useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div>
        <p className="txops-alert tone-fail" role="alert">{error}</p>
        <button type="button" className="txops-btn ghost" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!fresh) return <p className="txops-muted" role="status">Checking refund status…</p>;

  const payment = derivePaymentSummary(fresh);
  const ops = buildProviderOperations(fresh);
  const reserved = ops.filter(o => o.operation === 'RESERVE' && o.outcome === 'success').length;
  const cancelled = ops.filter(o => o.operation === 'CANCEL' && o.outcome === 'compensated').length;
  const locks = fresh.locks ?? [];
  const released = locks.filter(l => l.status === 'RELEASED').length;
  const amount = payment.amount ?? fresh.totalAmount;
  const refundLabel =
    payment.reversal === 'REFUNDED' ? 'REFUNDED'
    : payment.reversal === 'VOIDED' ? 'VOIDED'
    : payment.reversal === 'FAILED' ? 'REFUND FAILED'
    : payment.authorization === 'FAILED' ? 'NOT CHARGED'
    : 'NOT RECORDED';

  return (
    <div>
      <h4 className="txops-h4">Refund</h4>
      <dl className="txops-kv compact">
        <div><dt>Original payment</dt><dd className="txops-strong">{formatMoney(amount, payment.currency ?? fresh.currency)}</dd></div>
        <div>
          <dt>Refund status</dt>
          <dd><StatusBadge status={refundLabel.replace(/ /g, '_')} label={refundLabel} tone={payment.reversal === 'FAILED' ? 'fail' : payment.reversal ? 'comp' : 'neutral'} /></dd>
        </div>
      </dl>
      <ul className="txops-checklist" aria-label="Refund checklist">
        <Check ok={reserved === cancelled}>
          {reserved === 0 ? 'No other reservations had been made' : `Reservations cancelled (${cancelled} of ${reserved})`}
        </Check>
        <Check ok={locks.length > 0 && released === locks.length}>Held rooms and seats released ({released} of {locks.length})</Check>
        <Check ok={payment.reversal === 'REFUNDED' || payment.reversal === 'VOIDED' || payment.authorization === 'FAILED'}>
          {payment.reversal === 'REFUNDED' ? 'Payment refunded'
            : payment.reversal === 'VOIDED' ? 'Payment authorization voided — nothing was charged'
            : payment.authorization === 'FAILED' ? 'Payment was never authorized — nothing was charged'
            : 'Refund not yet recorded'}
        </Check>
      </ul>
      <p className="txops-footnote">
        Prototype: payments use BookGuard&apos;s mock payment service — no real money was moved. The refund/void was issued
        automatically when the booking was rolled back; choosing a refund does not start a second one.
      </p>
    </div>
  );
};

// ---------- panel ----------

export const CustomerResolutionPanel: React.FC<{ details: TransactionDetails; onOpenTransaction: (id: string) => void }> = ({ details, onOpenTransaction }) => {
  const [choice, setChoice] = useState<'alternative' | 'refund' | null>(null);
  React.useEffect(() => setChoice(null), [details.transactionId]);

  const heldLocks = (details.locks ?? []).some(l => l.status === 'CONFIRMED');
  if (details.state === 'ROLLBACK_FAILED' || ((details.state === 'ROLLED_BACK' || details.state === 'FAILED') && heldLocks)) {
    return <ActionRequired details={details} />;
  }
  if (details.state !== 'ROLLED_BACK' && details.state !== 'FAILED') return null;

  const failedType = failedServiceType(details);
  const compensated = buildProviderOperations(details).some(o => o.operation === 'CANCEL' && o.outcome === 'compensated');

  return (
    <section className="txops-resolution" aria-labelledby="txops-resolution-title">
      <span className="txops-kind kind-customer">Customer view · simulated</span>
      <h3 id="txops-resolution-title">Customer resolution</h3>
      <p className="txops-resolution-lead">
        {failedType
          ? `Your trip could not be completed because the ${noun(failedType)} was unavailable.`
          : 'Your trip could not be completed.'}
      </p>
      <p>
        {compensated ? 'Your other reservations were safely cancelled. ' : ''}
        {paymentSentence(details)}
      </p>
      <p className="txops-strong">What would you like to do?</p>
      <div className="txops-inline" role="group" aria-label="Resolution options">
        <button type="button" className={`txops-btn${choice === 'alternative' ? '' : ' ghost'}`} aria-pressed={choice === 'alternative'} onClick={() => setChoice('alternative')}>
          Find Alternative
        </button>
        <button type="button" className={`txops-btn${choice === 'refund' ? '' : ' ghost'}`} aria-pressed={choice === 'refund'} onClick={() => setChoice('refund')}>
          Get Refund
        </button>
      </div>
      <div className="txops-resolution-body">
        {choice === 'alternative' && <FindAlternative details={details} onOpenTransaction={onOpenTransaction} />}
        {choice === 'refund' && <RefundStatus transactionId={details.transactionId} />}
      </div>
      {failedType && (
        <p className="txops-footnote">{capitalize(noun(failedType))} unavailable · booking {shortId(details.transactionId)}</p>
      )}
    </section>
  );
};
