import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('App navigation', () => {
  it('renders prototype navigation with AI Planner, Explore & Book, Data Library, My Trips, Ops & Invariants, and Transaction Ops', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/api/inventory') && !url.includes('invariants')
        ? { success: true, items: [] }
        : url.includes('/api/transactions')
          ? { success: true, total: 0, limit: 10, offset: 0, transactions: [] }
          : url.includes('/api/chat/status')
            ? { success: true, aiMode: 'demo', model: null, provider: null, destinations: [], demoDataNotice: '' }
            : url.includes('/api/chat/usage')
              ? { success: true, usage: null }
              : { success: false };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    render(<App />);
    for (const label of ['AI Planner', 'Explore & Book', 'Data Library', 'My Trips', 'Ops & Invariants', 'Transaction Ops']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }

    // Trip Sentinel removed from prototype navigation
    expect(screen.queryByRole('button', { name: /Trip Sentinel/ })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Transaction Ops/ }));
    expect(await screen.findByRole('heading', { name: 'BookGuard Operations' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /AI Planner/ }));
    expect(await screen.findByRole('heading', { name: 'AI Travel Planner' })).toBeTruthy();
  });
});
