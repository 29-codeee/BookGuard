import React, { useMemo } from 'react';
import {
  buildSagaTimeline,
  visitedStates,
  type TimelineStep,
  type TransactionDetails
} from '../../services/transactionModel';
import { Empty, Mono, Section, StatusBadge, formatTime, humanize, shortId, type Tone } from './ui';

const FORWARD_PATH = ['PENDING', 'RESERVING', 'PROCESSING', 'COMPLETED'];
const FAILURE_PATH = ['ROLLING_BACK', 'ROLLED_BACK', 'ROLLBACK_FAILED'];

const STEP_TONE: Record<TimelineStep['outcome'], Tone> = { success: 'ok', failure: 'fail', compensated: 'comp', info: 'info' };
const STEP_LABEL: Record<TimelineStep['outcome'], string> = { success: 'Success', failure: 'Failed', compensated: 'Compensated', info: 'Recorded' };

function stepText(step: TimelineStep): string {
  const who = step.provider ?? step.itemLabel;
  switch (step.event) {
    case 'LOCK_ACQUIRED': return `Resource lock acquired — ${step.itemLabel}`;
    case 'PROVIDER_RESERVATION_HOLDS_RESOURCE': return `Lock confirmed (provider holds resource) — ${step.itemLabel}`;
    case 'SUCCESS_LOCK_RETAINED': return `Lock retained for completed booking — ${step.itemLabel}`;
    case 'RESOURCE_LOCK_RELEASED':
    case 'ROLLBACK_LOCK_RELEASED': return `Resource lock released — ${step.itemLabel}`;
    case 'UNPROCESSED_ITEM_RELEASED': return `Unprocessed item released — ${step.itemLabel}`;
    case 'PROVIDER_RESERVED': return `${who} reserve`;
    case 'PROVIDER_RESERVE_FAILED': return `${who} reserve`;
    case 'PROVIDER_CONFIRMED': return `${who} confirm`;
    case 'PROVIDER_CONFIRM_FAILED': return `${who} confirm`;
    case 'COMPENSATION_SUCCEEDED': return `${who} compensation (cancel)`;
    case 'COMPENSATION_FAILED': return `${who} compensation (cancel)`;
    default: return step.status ? `${humanize(step.event)} (recorded status: ${step.status})` : humanize(step.event);
  }
}

const StateStrip: React.FC<{ visited: Set<string>; current: string }> = ({ visited, current }) => {
  const chip = (state: string) => {
    const reached = visited.has(state);
    const isCurrent = state === current;
    return (
      <li key={state} className={`txops-chip${reached ? ' is-reached' : ''}${isCurrent ? ' is-current' : ''}`}>
        <span aria-hidden="true">{reached ? '●' : '○'}</span> {state.replace(/_/g, ' ')}
        <span className="sr-only">{isCurrent ? ' (current state)' : reached ? ' (reached)' : ' (not reached)'}</span>
      </li>
    );
  };
  return (
    <div className="txops-strip" aria-label="Saga state machine path taken by this transaction">
      <div className="txops-strip-row">
        <span className="txops-label">Forward path</span>
        <ol>{FORWARD_PATH.map(chip)}</ol>
      </div>
      <div className="txops-strip-row">
        <span className="txops-label">Compensation branch</span>
        <ol>{FAILURE_PATH.map(chip)}</ol>
      </div>
      {visited.has('FAILED') && (
        <div className="txops-strip-row">
          <span className="txops-label">Terminal failure</span>
          <ol>{chip('FAILED')}</ol>
        </div>
      )}
    </div>
  );
};

export const SagaTimeline: React.FC<{ details: TransactionDetails }> = ({ details }) => {
  const stages = useMemo(() => buildSagaTimeline(details), [details]);
  const visited = useMemo(() => visitedStates(details), [details]);

  return (
    <Section
      id="txops-timeline"
      kind="fact"
      title="Saga execution timeline"
      subtitle="Built only from persisted transaction events, in the order they were recorded."
    >
      <StateStrip visited={visited} current={details.state} />

      {stages.length === 0 ? (
        <Empty>No events recorded for this transaction.</Empty>
      ) : (
        <ol className="txops-timeline" aria-label="Saga stages">
          {stages.map((stage, index) => (
            <li key={stage.eventId} className={`txops-stage tone-${stageTone(stage.state)}`}>
              <div className="txops-stage-head">
                <span className="txops-stage-dot" aria-hidden="true" />
                <StatusBadge status={stage.state} />
                <span className="txops-muted">
                  {stage.fromState ? `from ${stage.fromState} · ` : ''}
                  {stage.event !== stage.state ? humanize(stage.event) + ' · ' : ''}
                  {formatTime(stage.at)}
                </span>
                {index === stages.length - 1 && <span className="txops-tag">Final recorded stage</span>}
              </div>
              {stage.steps.length > 0 && (
                <ul className="txops-steps">
                  {stage.steps.map(step => (
                    <li key={step.eventId} className={`txops-step kind-${step.kind}`}>
                      <StatusBadge status={step.event} tone={STEP_TONE[step.outcome]} label={STEP_LABEL[step.outcome]} />
                      <span className="txops-step-text">{stepText(step)}</span>
                      {step.reference && <Mono title={step.reference}>{shortId(step.reference, 18)}</Mono>}
                      {step.error && <span className="txops-error-text">{step.error}</span>}
                      <span className="txops-muted txops-step-time">{formatTime(step.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
};

function stageTone(state: string): Tone {
  if (state === 'COMPLETED') return 'ok';
  if (state === 'ROLLBACK_FAILED' || state === 'FAILED') return 'fail';
  if (state === 'ROLLING_BACK') return 'warn';
  if (state === 'ROLLED_BACK') return 'comp';
  return 'info';
}
