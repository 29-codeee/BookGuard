import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import resolutionRolledBack from './__fixtures__/resolution_rolledBack.json';
import resolutionPaymentFailed from './__fixtures__/resolution_paymentFailed.json';
import replacement from './__fixtures__/replacement.json';
import replacementDetails from './__fixtures__/replacementDetails.json';

// Fixtures are real API responses captured by backend/src/scripts/exportDashboardFixtures.ts.

type Result = { status: number; body: unknown } | 'network-error' | Promise<{ status: number; body: unknown }>;
type Handler = (init?: RequestInit) => Result;
const json = (status: number, body: unknown) => ({ status, body });

const details: Record<string, unknown> = Object.fromEntries(
  [completed, rolledBack, paymentFailed, rollbackFailed, replacementDetails].map(d => [d.transactionId, d])
);
const resolutions: Record<string, unknown> = {
  [rolledBack.transactionId]: resolutionRolledBack,
  [paymentFailed.transactionId]: resolutionPaymentFailed
};

function mockBackend(overrides: Record<string, Handler> = {}) {
  const calls: Array<{ method: string; path: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const key = `${method} ${url.pathname}`;
    calls.push({ method, path: url.pathname, init });
    let result: Result;
    if (overrides[key]) result = overrides[key](init);
    else if (key === 'GET /api/health') result = json(200, health);
    else if (key === 'GET /api/transactions') result = json(200, list);
    else if (key === 'GET /api/transactions/demo-scenarios') result = json(200, demoScenarios);
    else if (method === 'GET' && url.pathname.endsWith('/resolution')) {
      const id = url.pathname.split('/')[3];
      result = resolutions[id] ? json(200, resolutions[id]) : json(404, { success: false, error: 'TRANSACTION_NOT_FOUND' });
    } else if (method === 'GET' && url.pathname.startsWith('/api/transactions/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/transactions/'.length));
      result = details[id] ? json(200, details[id]) : json(404, { success: false, error: 'TRANSACTION_NOT_FOUND', message: 'Transaction was not found' });
    } else result = json(404, { success: false });
    const r = await result;
    if (r === 'network-error') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

async function open(id: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText('Transaction ID');
  await user.clear(input);
  await user.type(input, id);
  await user.click(screen.getByRole('button', { name: 'Load' }));
  await screen.findByRole('heading', { name: 'Transaction overview' });
  return user;
}

const panel = () => screen.getByRole('region', { name: 'Customer resolution' });

beforeEach(() => vi.unstubAllGlobals());

describe('Customer resolution (Phase 10)', () => {
  it('appears after a successful rollback, in customer language', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    await open(rolledBack.transactionId);
    const p = within(panel());
    expect(p.getByText('Your trip could not be completed because the transport was unavailable.')).toBeTruthy();
    expect(p.getByText(/Your other reservations were safely cancelled/)).toBeTruthy();
    expect(p.getByText(/The hold on your payment has been released/)).toBeTruthy();
    expect(p.getByRole('button', { name: 'Find Alternative' })).toBeTruthy();
    expect(p.getByRole('button', { name: 'Get Refund' })).toBeTruthy();
    // Internal/technical vocabulary stays out of the simulated customer view.
    expect(panel().textContent).not.toMatch(/saga|compensat|MANUAL_OPERATOR_REVIEW|ALTERNATIVE_PROVIDER|lock/i);
  });

  it('is not shown for a normal successful transaction', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    await open(completed.transactionId);
    expect(screen.queryByRole('region', { name: 'Customer resolution' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Action required' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Get Refund' })).toBeNull();
  });

  it('ROLLBACK_FAILED shows the operator warning instead of customer options', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    const user = await open(rollbackFailed.transactionId);
    const notice = within(screen.getByRole('region', { name: 'Action required' }));
    expect(notice.getByText('BookGuard could not safely complete the rollback of one reservation.')).toBeTruthy();
    expect(notice.getByText('The affected resource remains protected while the incident is resolved.')).toBeTruthy();
    expect(notice.getByText(rollbackFailed.recoveryAdvisory.recommendation)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Find Alternative' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Get Refund' })).toBeNull();

    Element.prototype.scrollIntoView = vi.fn();
    await user.click(notice.getByRole('button', { name: 'View Recovery Details' }));
    expect(document.activeElement?.id).toBe('txops-recovery-title');
  });

  it('Get Refund re-reads and reflects the actual mock payment state', async () => {
    const calls = mockBackend();
    render(<TransactionOpsView />);
    const user = await open(rolledBack.transactionId);
    const before = calls.filter(c => c.path === `/api/transactions/${rolledBack.transactionId}`).length;
    await user.click(within(panel()).getByRole('button', { name: 'Get Refund' }));
    const p = within(panel());
    await p.findByText('Original payment');
    expect(calls.filter(c => c.path === `/api/transactions/${rolledBack.transactionId}`).length).toBe(before + 1);
    expect(p.getByText('₹8,600.00')).toBeTruthy();
    expect(p.getByText('VOIDED')).toBeTruthy();
    expect(p.getByText('Reservations cancelled (2 of 2)')).toBeTruthy();
    expect(p.getByText('Held rooms and seats released (3 of 3)')).toBeTruthy();
    expect(p.getByText('Payment authorization voided — nothing was charged')).toBeTruthy();
    expect(p.getByText(/no real money was moved/)).toBeTruthy();
  });

  it('Get Refund after a payment-authorization failure reports that nothing was charged', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    const user = await open(paymentFailed.transactionId);
    expect(within(panel()).getByText('Your payment was not authorized, so you were not charged.')).toBeTruthy();
    await user.click(within(panel()).getByRole('button', { name: 'Get Refund' }));
    expect(await within(panel()).findByText('NOT CHARGED')).toBeTruthy();
    expect(within(panel()).getByText('No other reservations had been made')).toBeTruthy();
  });

  it('Find Alternative renders exactly the alternatives the API returned', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    const user = await open(rolledBack.transactionId);
    await user.click(within(panel()).getByRole('button', { name: 'Find Alternative' }));
    const listEl = await screen.findByRole('list', { name: 'Alternative transport options' });
    const cards = within(listEl).getAllByRole('listitem');
    expect(cards).toHaveLength(resolutionRolledBack.alternatives.length);
    resolutionRolledBack.alternatives.forEach((alt, i) => {
      const card = within(cards[i]);
      expect(card.getByText(alt.provider)).toBeTruthy();
      expect(card.getByText(`₹${alt.unitPrice.toLocaleString('en-IN')}.00`)).toBeTruthy();
      expect(card.getByText(alt.match === 'SAME_DATE' ? 'Same date as your trip' : /^Different date:/)).toBeTruthy();
    });
    expect(within(panel()).getByText(resolutionRolledBack.matchCriteria)).toBeTruthy();
  });

  it('shows loading, then the empty state when no alternative is available', async () => {
    let release: () => void = () => {};
    mockBackend({
      [`GET /api/transactions/${rolledBack.transactionId}/resolution`]: () =>
        new Promise(resolve => { release = () => resolve(json(200, { ...resolutionRolledBack, alternatives: [] })); })
    });
    render(<TransactionOpsView />);
    const user = await open(rolledBack.transactionId);
    await user.click(within(panel()).getByRole('button', { name: 'Find Alternative' }));
    expect(await within(panel()).findByText('Looking for alternatives…')).toBeTruthy();
    release();
    expect(await within(panel()).findByText('No alternative transport is currently available for this trip. You can request a refund instead.')).toBeTruthy();
  });

  it('shows an API error with retry', async () => {
    let fail = true;
    mockBackend({
      [`GET /api/transactions/${rolledBack.transactionId}/resolution`]: () => (fail ? 'network-error' : json(200, resolutionRolledBack))
    });
    render(<TransactionOpsView />);
    const user = await open(rolledBack.transactionId);
    await user.click(within(panel()).getByRole('button', { name: 'Find Alternative' }));
    expect(await within(panel()).findByText('Unable to connect to BookGuard backend.')).toBeTruthy();
    fail = false;
    await user.click(within(panel()).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Alternative transport options' })).toBeTruthy();
  });

  it('payment failure has nothing to replace', async () => {
    mockBackend();
    render(<TransactionOpsView />);
    const user = await open(paymentFailed.transactionId);
    await user.click(within(panel()).getByRole('button', { name: 'Find Alternative' }));
    expect(await within(panel()).findByText(/nothing to replace/)).toBeTruthy();
  });

  it('selecting an alternative books a new transaction through the replacement endpoint after confirmation', async () => {
    const calls = mockBackend({
      [`POST /api/transactions/${rolledBack.transactionId}/replacement`]: () => json(201, replacement)
    });
    render(<TransactionOpsView />);
    const user = await open(rolledBack.transactionId);
    await user.click(within(panel()).getByRole('button', { name: 'Find Alternative' }));
    const alt = resolutionRolledBack.alternatives[0];
    await user.click(await screen.findByRole('button', { name: `Select alternative ${alt.provider}` }));
    expect(calls.some(c => c.method === 'POST')).toBe(false);

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/normal checks: availability hold, risk check, providers and the\s+prototype mock payment/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm new booking' }));
    expect(await within(panel()).findByText('Your new booking is confirmed.')).toBeTruthy();

    const post = calls.find(c => c.method === 'POST')!;
    expect(post.path).toBe(`/api/transactions/${rolledBack.transactionId}/replacement`);
    expect((post.init!.headers as Record<string, string>)['Idempotency-Key']).toBe(`replacement:${rolledBack.transactionId}:${alt.resourceId}`);
    expect(JSON.parse(String(post.init!.body))).toEqual({ alternativeResourceId: alt.resourceId });

    await user.click(within(panel()).getByRole('button', { name: 'Open new booking' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Transaction overview' })).getByText(replacement.transactionId)).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Customer resolution' })).toBeNull();
  });

  it('renders at phone width without losing content', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    window.dispatchEvent(new Event('resize'));
    mockBackend();
    render(<TransactionOpsView />);
    const user = await open(rolledBack.transactionId);
    await user.click(within(panel()).getByRole('button', { name: 'Find Alternative' }));
    const listEl = await screen.findByRole('list', { name: 'Alternative transport options' });
    // Layout itself is CSS (single column under 640px); jsdom does not lay out, so this checks structure only.
    expect(listEl.className).toBe('txops-alt-grid');
    expect(within(panel()).getByRole('group', { name: 'Resolution options' })).toBeTruthy();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  });

  it('Demo 4 sends one request twice with the same key and measures no duplicate', async () => {
    let total = list.total;
    const posts: RequestInit[] = [];
    mockBackend({
      'GET /api/transactions': () => json(200, { ...list, total }),
      'POST /api/transactions': init => {
        posts.push(init!);
        if (posts.length === 1) total += 1;
        return json(201, { success: true, transactionId: completed.transactionId, state: 'COMPLETED' });
      }
    });
    render(<TransactionOpsView />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Show scenarios' }));
    await user.click(await screen.findByRole('button', { name: 'Run idempotency demo…' }));
    expect(posts).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Confirm and run' }));
    const result = within(await screen.findByRole('status', { name: 'Idempotency demo result' }));
    expect(result.getByText('No duplicate transaction')).toBeTruthy();
    expect(result.getByText('1')).toBeTruthy();
    expect(posts).toHaveLength(2);
    const keys = posts.map(p => (p.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(JSON.parse(String(posts[0].body))).toEqual(demoScenarios.scenarios.find(s => s.id === 'SUCCESSFUL_BOOKING')!.request);
  });
});
