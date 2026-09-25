import React from 'react';

export type Tone = 'ok' | 'fail' | 'warn' | 'comp' | 'info' | 'neutral';

const GLYPH: Record<Tone, string> = { ok: '✓', fail: '✕', warn: '⚠', comp: '↺', info: '•', neutral: '•' };

const TONE_BY_STATUS: Record<string, Tone> = {
  COMPLETED: 'ok', CONFIRMED: 'ok', RESERVED: 'ok', AUTHORIZED: 'ok', CAPTURED: 'ok',
  CONNECTED: 'ok', READY: 'ok', PROCEED: 'ok', LOW: 'ok', ACTIVE: 'info', healthy: 'ok',
  FAILED: 'fail', ROLLBACK_FAILED: 'fail', UNAVAILABLE: 'fail', HIGH: 'fail', degraded: 'fail',
  ROLLING_BACK: 'warn', REVIEW: 'warn', MEDIUM: 'warn', MANUAL_OPERATOR_REVIEW: 'fail',
  AUTOMATIC_RETRY: 'warn', ALTERNATIVE_PROVIDER: 'warn',
  ROLLED_BACK: 'comp', CANCELLED: 'comp', REFUNDED: 'comp', VOIDED: 'comp', RELEASED: 'comp', EXPIRED: 'neutral',
  PENDING: 'info', RESERVING: 'info', PROCESSING: 'info', CONFIRMING: 'info', CANCELLING: 'warn'
};

export function toneFor(status: string | null | undefined): Tone {
  return (status && TONE_BY_STATUS[status]) || 'neutral';
}

/** Status is always conveyed by text; the glyph and color are secondary cues. */
export const StatusBadge: React.FC<{ status: string; tone?: Tone; label?: string }> = ({ status, tone, label }) => {
  const t = tone ?? toneFor(status);
  return (
    <span className={`txops-badge tone-${t}`}>
      <span aria-hidden="true">{GLYPH[t]}</span>
      <span>{label ?? status.replace(/_/g, ' ')}</span>
    </span>
  );
};

export type SectionKind = 'fact' | 'risk' | 'advisory' | 'copilot';

const KIND_TAG: Record<SectionKind, string> = {
  fact: 'System state · recorded fact',
  risk: 'Risk assessment · advisory',
  advisory: 'Recovery advisory · not executed',
  copilot: 'Reconciliation copilot · advisory'
};

export const Section: React.FC<{
  id: string;
  title: string;
  kind: SectionKind;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ id, title, kind, subtitle, actions, children }) => (
  <section className={`txops-section kind-${kind}`} aria-labelledby={`${id}-title`}>
    <header className="txops-section-head">
      <div>
        <span className={`txops-kind kind-${kind}`}>{KIND_TAG[kind]}</span>
        <h3 id={`${id}-title`} tabIndex={-1}>{title}</h3>
        {subtitle && <p className="txops-sub">{subtitle}</p>}
      </div>
      {actions && <div className="txops-section-actions">{actions}</div>}
    </header>
    {children}
  </section>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="txops-empty">{children}</p>
);

export const Mono: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
  <code className="txops-mono" title={title}>{children}</code>
);

export function shortId(id: string, length = 8): string {
  return id.length > length + 3 ? `${id.slice(0, length)}…` : id;
}

export function formatInr(amount: number | null): string {
  return formatMoney(amount, 'INR');
}

export function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency ?? ''} ${amount.toFixed(2)}`.trim();
  }
}

export function formatTime(iso: string | null, withDate = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return withDate
    ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })
    : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function humanize(code: string): string {
  return code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}
