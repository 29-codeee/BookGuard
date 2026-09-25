import React from 'react';
import { CopilotCard } from '../OpsDashboard/CopilotCard';

export interface CopilotProps {
  reconciliations: React.ComponentProps<typeof CopilotCard>['reconciliations'];
  onApply: React.ComponentProps<typeof CopilotCard>['onApply'];
  isApplying: boolean;
}

/**
 * Explains the three advisory layers and reuses the existing Reconciliation Copilot as-is.
 * The Copilot reconciles the legacy booking-hold engine; it is not driven by saga transactions.
 */
export const AdvisoryLayers: React.FC<{ copilot?: CopilotProps }> = ({ copilot }) => (
  <section className="txops-section kind-copilot" aria-labelledby="txops-layers-title">
    <header className="txops-section-head">
      <div>
        <span className="txops-kind kind-copilot">Advisory layers</span>
        <h3 id="txops-layers-title">Where each recommendation comes from</h3>
      </div>
    </header>
    <ol className="txops-layers">
      <li>
        <span className="txops-strong">Transaction risk</span>
        <span className="txops-muted">Before execution · scores a transaction from provider telemetry. Shown above per transaction.</span>
      </li>
      <li>
        <span className="txops-strong">Reconciliation copilot</span>
        <span className="txops-muted">Provider-state reconciliation for bookings stuck in RECONCILING (legacy hold engine). Shown below.</span>
      </li>
      <li>
        <span className="txops-strong">Recovery intelligence</span>
        <span className="txops-muted">After a failed rollback · recommends retry, alternative provider, or operator review. Shown above per transaction.</span>
      </li>
    </ol>
    {copilot && (
      <details className="txops-details">
        <summary>Reconciliation copilot ({copilot.reconciliations.length} pending)</summary>
        <p className="txops-footnote">
          Existing component, unchanged. Its buttons are the pre-existing human-in-the-loop reconciliation actions for the
          legacy booking engine; they do not act on saga transactions.
        </p>
        <CopilotCard reconciliations={copilot.reconciliations} onApply={copilot.onApply} isApplying={copilot.isApplying} />
      </details>
    )}
  </section>
);
