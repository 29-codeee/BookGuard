import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionOpsView } from './TransactionOpsView';
import health from './__fixtures__/health.json';
import list from './__fixtures__/list.json';
import completed from './__fixtures__/completed.json';
import rolledBack from './__fixtures__/rolledBack.json';
import paymentFailed from './__fixtures__/paymentFailed.json';
import rollbackFailed from './__fixtures__/rollbackFailed.json';
import demoScenarios from './__fixtures__/demoScenarios.json';

// All fixtures are real API responses captured by backend/src/scripts/exportDashboardFixtures.ts.

type Handler = (init?: RequestInit) => { status: number; body: unknown } | 'network-error' | 'html-error';

const json = (status: number, body: unknown) => ({ status, body });

function mockBackend(overrides: Record<string, Handler> = {}) {
  const byId: Record<string, unknown> = Object.fromEntries(
    [completed, rolledBack, paymentFailed, rollbackFailed].map(d => [d.transactionId, d])
  );
  const routes: Record<string, Handler> = {
    'GET /api/health': () => json(200, health),
    'GET /api/transactions': () => json(200, list),
    'GET /api/transactions/demo-scenarios': () => json(200, demoScenarios),
    ...overrides
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const key = `${method} ${url.pathname}`;
    let handler = routes[key];
    if (!handler && method === 'GET' && url.pathname.startsWith('/api/transactions/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/transactions/'.length));
      handler = () => (byId[id] ? json(200, byId[id]) : json(404, { success: false, error: 'TRANSACTION_NOT_FOUND', message: 'Transaction was not found' }));
    }
    const result = handler ? handler(init) : json(404, { success: false });
    if (result === 'network-error') throw new TypeError('Failed to fetch');
    if (result === 'html-error') return new Response('<html>Bad gateway</html>', { status: 502 });
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function loadById(id: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText('Transaction ID');
  await user.clear(input);
  await user.type(input, id);
  await user.click(screen.getByRole('button', { name: 'Load' }));
  await screen.findByRole('heading', { name: 'Transaction overview' });
  return user;
}

const section = (title: string) => screen.getByRole('region', { name: title });

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('TransactionOpsView', () => {
  it('1. loads the dashboard with only read-only requests and no polling', async () => {
    const fetchMock = mockBackend();
    render(<TransactionOpsView />);
    expect(screen.getByRole('heading', { name: 'BookGuard Operations' })).toBeTruthy();
    await screen.findByText(list.transactions[0].transactionId.slice(0, 8) + '…');
    const calls = () => fetchMock.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? 'GET');
    expect(calls().every(m => m === 'GET')).toBe(true);
    const count = fetchMock.mock.calls.length;
    await new Promise(r => setTimeout(r, 60));
    expect(fetchMock.mock.calls.length).toBe(count);
  });

  it('2. shows health status from GET /api/health', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    const panel = await screen.findByRole('region', { name: 'System health' });
    await within(panel).findByText('Database');
    expect(within(panel).getAllByText('CONNECTED')).toHaveLength(2); // backend + database
    expect(within(panel).getAllByText('READY')).toHaveLength(3);
  });

  it('3. loads a transaction by ID and from the list', async () => {
    const fetchMock = mockBackend();
    render(<TransactionOpsView />);
    await loadById(completed.transactionId);
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith(`/api/transactions/${completed.transactionId}`))).toBe(true);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `Open transaction ${rollbackFailed.transactionId}` }));
    await waitFor(() => expect(within(section('Transaction overview')).getByText(rollbackFailed.transactionId)).toBeTruthy());
  });

  it('4. renders a COMPLETED transaction', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    await loadById(completed.transactionId);
    const overview = section('Transaction overview');
    expect(within(overview).getAllByText('COMPLETED').length).toBeGreaterThan(0);
    expect(within(overview).getByText('₹8,600.00')).toBeTruthy();
    expect(screen.queryByText('Unresolved resource lock')).toBeNull();
    expect(within(section('Recovery intelligence')).getByText(/advisories are generated only when compensation fails/)).toBeTruthy();
  });

  it('5. renders a ROLLED_BACK transaction with compensations', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    await loadById(rolledBack.transactionId);
    const ops = within(section('Provider operations'));
    expect(ops.getAllByText('Compensated')).toHaveLength(2);
    expect(ops.getByText('injected transport reserve failure')).toBeTruthy();
    expect(screen.queryByText('Unresolved resource lock')).toBeNull();
  });

  it('6. renders a ROLLBACK_FAILED transaction', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    await loadById(rollbackFailed.transactionId);
    expect(within(section('Transaction overview')).getAllByText('ROLLBACK FAILED').length).toBeGreaterThan(0);
    expect(within(section('Provider operations')).getByText(/Recovery required \(recorded\)/)).toBeTruthy();
  });

  it('7. renders the risk assessment from the actual factor structure', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    await loadById(rollbackFailed.transactionId);
    const risk = within(section('Transaction risk'));
    expect(risk.getByLabelText(`Risk score ${rollbackFailed.riskAssessment.riskScore} out of 100`)).toBeTruthy();
    expect(risk.getByText(`Factors (${rollbackFailed.riskAssessment.factors.length})`)).toBeTruthy();
    expect(risk.getByText('Multi provider bundle 3')).toBeTruthy();
    for (const f of rollbackFailed.riskAssessment.factors) {
      expect(risk.getAllByText(f.explanation).length).toBeGreaterThan(0);
    }
    expect(risk.getByText(/Advisory only — it never blocks or alters the saga/)).toBeTruthy();
  });

  it('8. renders the recovery advisory as advisory, not as an executed action', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    await loadById(rollbackFailed.transactionId);
    const card = within(section('Recovery intelligence'));
    expect(card.getByText('MANUAL_OPERATOR_REVIEW')).toBeTruthy();
    expect(card.getByText('Human verification required')).toBeTruthy();
    expect(card.getByText('98%')).toBeTruthy();
    expect(card.getByText('Recovery advisory · not executed')).toBeTruthy();
    for (const action of rollbackFailed.recoveryAdvisory.suggestedActions) expect(card.getByText(action)).toBeTruthy();
    expect(card.getByText(rollbackFailed.recoveryAdvisory.reasons[0].evidenceIds[0])).toBeTruthy();
    // No execution controls anywhere in the recovery card.
    expect(card.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /book alternative|release|unlock|retry/i })).toBeNull();
  });

  it('9. missing or unreadable optional sections do not crash the view', async () => {
    const { riskAssessment, recoveryAdvisory, locks, ...core } = rollbackFailed;
    mockBackend({
      'GET /api/transactions/missing-sections': () => json(200, { ...core, transactionId: 'missing-sections' }),
      'GET /api/transactions/bad-sections': () => json(200, { ...core, transactionId: 'bad-sections', recoveryAdvisory: { nope: true } })
    });
    render(<TransactionOpsView />);
    await loadById('missing-sections');
    expect(within(section('Recovery intelligence')).getByText(/No recovery advisory was recorded/)).toBeTruthy();
    expect(within(section('Transaction risk')).getByText('No risk assessment was recorded for this transaction.')).toBeTruthy();
    expect(within(section('Resource locks')).getByText('Lock data is not included in this backend response.')).toBeTruthy();

    await loadById('bad-sections');
    expect(within(section('Recovery intelligence')).getByText(/could not be interpreted/)).toBeTruthy();
  });

  it('10. shows the unresolved CONFIRMED lock warning without any unlock control', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    await loadById(rollbackFailed.transactionId);
    const alert = screen.getByRole('alert', { name: 'Unresolved resource lock' });
    expect(within(alert).getByText(/remains protected because compensation has not been verified\. Automatic release is disabled\./)).toBeTruthy();
    expect(within(alert).getByText('FL-FIXTURE')).toBeTruthy();
    expect(within(alert).getByText('Operator action required')).toBeTruthy();
    expect(within(alert).queryAllByRole('button')).toHaveLength(0);
    expect(within(section('Resource locks')).getByText('Confirmed — unresolved')).toBeTruthy();
  });

  it('11. renders provider failures with their recorded errors', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    await loadById(rollbackFailed.transactionId);
    const ops = within(section('Provider operations'));
    expect(ops.getAllByText('Failed')).toHaveLength(2);
    expect(ops.getByText('injected transport reserve failure')).toBeTruthy();
    expect(ops.getByText('injected flight cancellation failure')).toBeTruthy();
  });

  it('12. builds the saga timeline from actual events only', async () => {
    mockBackend({
      'GET /api/transactions/no-events': () => json(200, { ...completed, transactionId: 'no-events', events: [] })
    });
    render(<TransactionOpsView />);
    await loadById(paymentFailed.transactionId);
    const stages = within(screen.getByRole('list', { name: 'Saga stages' })).getAllByRole('listitem').filter(li => li.classList.contains('txops-stage'));
    expect(stages.map(li => li.querySelector('.txops-stage-head .txops-badge')?.textContent?.replace(/^\W+/, ''))).toEqual([
      'PENDING', 'RESERVING', 'ROLLING BACK', 'ROLLED BACK'
    ]);
    const strip = screen.getByLabelText('Saga state machine path taken by this transaction');
    expect(within(strip).getByText(/PROCESSING/).closest('li')?.className).not.toContain('is-reached');

    await loadById('no-events');
    expect(within(section('Saga execution timeline')).getByText('No events recorded for this transaction.')).toBeTruthy();
  });

  it('13. renders payment state from payment events', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    await loadById(rolledBack.transactionId);
    const pay = within(section('Payment'));
    expect(pay.getAllByText('VOIDED').length).toBe(2); // current state + refund/void step
    expect(pay.getByText('AUTHORIZED')).toBeTruthy();
    expect(pay.getByText(/No card or account credentials/)).toBeTruthy();

    await loadById(paymentFailed.transactionId);
    expect(within(section('Payment')).getByText(/Demo: payment authorization declined/)).toBeTruthy();
    expect(within(section('Provider operations')).getByText(/before any provider was contacted/)).toBeTruthy();
  });

  it('14. renders API errors gracefully', async () => {
    mockBackend({
      'GET /api/transactions/unreachable': () => 'network-error',
      'GET /api/transactions/proxy-down': () => 'html-error',
      'GET /api/transactions/malformed': () => json(200, { hello: 'world' })
    });
    render(<TransactionOpsView />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('Transaction ID');
    const submit = async (id: string) => {
      await user.clear(input);
      if (id) await user.type(input, id);
      await user.click(screen.getByRole('button', { name: 'Load' }));
    };

    await submit('does-not-exist');
    expect(await screen.findByText('Transaction not found.')).toBeTruthy();
    await submit('unreachable');
    expect(await screen.findByText('Unable to connect to BookGuard backend.')).toBeTruthy();
    await submit('proxy-down');
    expect(await screen.findByText('Unable to connect to BookGuard backend.')).toBeTruthy();
    await submit('malformed');
    expect(await screen.findByText('Received an unexpected transaction response.')).toBeTruthy();
    await submit('');
    expect(await screen.findByText('Enter a transaction ID.')).toBeTruthy();
  });

  it('14b. shows backend-unavailable health without inventing statuses', async () => {
    mockBackend({ 'GET /api/health': () => 'network-error', 'GET /api/transactions': () => 'network-error' });
    render(<TransactionOpsView />);
    const panel = await screen.findByRole('region', { name: 'System health' });
    expect(await within(panel).findByText('Unable to connect to BookGuard backend.')).toBeTruthy();
    expect(within(panel).getByText('Unreachable')).toBeTruthy();
    expect(within(panel).queryByText('READY')).toBeNull();
  });

  it('shows a loading state while a transaction is fetched', async () => {
    let release: () => void = () => {};
    mockBackend({
      'GET /api/transactions/slow': () => json(200, { ...completed, transactionId: 'slow' })
    });
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/slow')) await new Promise<void>(r => { release = r; });
      return original(input, init);
    }));
    render(<TransactionOpsView />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Transaction ID'), 'slow');
    await user.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByText('Loading transaction...')).toBeTruthy();
    release();
    await screen.findByRole('heading', { name: 'Transaction overview' });
    expect(screen.queryByText('Loading transaction...')).toBeNull();
  });

  it('demo scenarios require explicit confirmation and use the real POST endpoint', async () => {
    const posted: RequestInit[] = [];
    const fetchMock = mockBackend({
      'POST /api/transactions': init => {
        posted.push(init!);
        return json(409, { success: false, transactionId: rollbackFailed.transactionId, state: 'ROLLBACK_FAILED' });
      }
    });
    render(<TransactionOpsView />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Show scenarios' }));
    const runButtons = await screen.findAllByRole('button', { name: 'Run scenario…' });
    expect(runButtons).toHaveLength(4);

    await user.click(runButtons[3]);
    expect(posted).toHaveLength(0);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/creates a real transaction through POST \/api\/transactions/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(posted).toHaveLength(0);

    await user.click(runButtons[3]);
    await user.click(screen.getByRole('button', { name: 'Confirm and run' }));
    await screen.findByRole('alert', { name: 'Unresolved resource lock' });

    expect(posted).toHaveLength(1);
    const headers = posted[0].headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^dashboard-demo-ROLLBACK_FAILURE-/);
    expect(JSON.parse(String(posted[0].body))).toEqual(demoScenarios.scenarios[3].request);
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith(`/api/transactions/${rollbackFailed.transactionId}`))).toBe(true);
  });

  it('reuses the existing Reconciliation Copilot inside the advisory layers section', async () => {
    mockBackend();
    render(<TransactionOpsView copilot={{ reconciliations: [], onApply: async () => {}, isApplying: false }} />);
    const layers = within(screen.getByRole('region', { name: 'Where each recommendation comes from' }));
    expect(layers.getByText('Reconciliation copilot (0 pending)')).toBeTruthy();
    expect(layers.getByText('Reconciliation Copilot (AI Advisory Layer)')).toBeTruthy();
  });
});
