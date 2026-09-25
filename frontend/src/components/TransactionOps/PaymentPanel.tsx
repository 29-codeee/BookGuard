import React, { useMemo } from 'react';
import { derivePaymentSummary, type PaymentStepStatus, type TransactionDetails } from '../../services/transactionModel';
import { Empty, Mono, Section, StatusBadge, formatMoney, formatTime, humanize, shortId } from './ui';

const Step: React.FC<{ label: string; status: PaymentStepStatus }> = ({ label, status }) => (
  <div className="txops-pay-step">
    <span className="txops-label">{label}</span>
    {status === 'NOT_RECORDED'
      ? <StatusBadge status={status} tone="neutral" label="Not recorded" />
      : <StatusBadge status={status} />}
  </div>
);

export const PaymentPanel: React.FC<{ details: TransactionDetails }> = ({ details }) => {
  const payment = useMemo(() => derivePaymentSummary(details), [details]);

  return (
    <Section
      id="txops-payment"
      kind="fact"
      title="Payment"
      subtitle="From persisted PAYMENT_* events. No card or account credentials are stored or shown."
    >
      {!payment.recorded ? (
        <Empty>No payment events were recorded for this transaction.</Empty>
      ) : (
        <>
          <div className="txops-pay-grid">
            <div className="txops-pay-step">
              <span className="txops-label">Current payment state</span>
              <StatusBadge status={payment.currentStatus} />
            </div>
            <Step label="Authorization" status={payment.authorization} />
            <Step label="Capture" status={payment.capture} />
            <Step label="Refund / void" status={payment.reversal} />
          </div>
          <dl className="txops-kv compact">
            <div><dt>Payment reference</dt><dd>{payment.paymentId ? <Mono title={payment.paymentId}>{shortId(payment.paymentId, 16)}</Mono> : '—'}</dd></div>
            <div><dt>Authorized amount</dt><dd>{formatMoney(payment.amount, payment.currency ?? details.currency)}</dd></div>
          </dl>
          {payment.errors.length > 0 && (
            <p className="txops-callout tone-fail">Payment errors: {payment.errors.join('; ')}</p>
          )}
          <ol className="txops-pay-events" aria-label="Payment events">
            {payment.events.map(e => (
              <li key={e.eventId}><span className="txops-muted">{formatTime(e.at)}</span> {humanize(e.event)}</li>
            ))}
          </ol>
        </>
      )}
    </Section>
  );
};
