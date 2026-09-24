/**
 * AI Travel Planner API client. The browser only talks to our backend;
 * AI provider keys live in backend/.env and never reach the frontend.
 */
import type { ChatTurn, TripState, BookingRequestRecord } from '../components/AiPlanner/chatTypes';

const BASE_URL = import.meta.env.VITE_API_URL || '';

export class ChatApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ChatApiError('Cannot reach the BookGuard server. Is the backend running?', 0);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    // An error with no JSON body comes from the dev proxy, not our API: the backend is down or crashed.
    if (!data && res.status >= 500) {
      throw new ChatApiError(
        'Cannot reach the BookGuard backend on port 3001. Check the backend terminal: it may have stopped or crashed (after pulling new code, run "npm install" in backend/ and restart it).',
        res.status
      );
    }
    throw new ChatApiError(data?.message || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export type PlannerAction = 'select' | 'book' | 'remove' | 'change' | 'cheaper' | 'add' | 'show';
export type PlannerTarget = 'hotel' | 'transport' | 'place' | 'itinerary' | 'trip';

export const chatApi = {
  status: () => request<{ aiMode: 'llm' | 'demo'; model: string | null; demoDataNotice: string }>('GET', '/api/chat/status'),
  usage: () => request<{ success: boolean; usage: { calls: number; callsWithUsage: number; inputTokens: number; outputTokens: number; totalTokens: number; provider: string; note: string } }>('GET', '/api/chat/usage'),

  send: (sessionId: string | null, message: string) =>
    request<ChatTurn>('POST', '/api/chat', { sessionId, message }),

  action: (sessionId: string, action: PlannerAction, target: PlannerTarget, itemId?: string, mode?: string) =>
    request<ChatTurn>('POST', '/api/chat/action', { sessionId, action, target, itemId, mode }),

  session: (sessionId: string) =>
    request<{ sessionId: string; trip: TripState; history: Array<{ role: 'user' | 'assistant'; text: string; at: string }>; aiMode: 'llm' | 'demo' }>(
      'GET',
      `/api/chat/session/${encodeURIComponent(sessionId)}`
    ),

  reset: (sessionId: string) => request<{ sessionId: string; trip: TripState }>('POST', `/api/chat/session/${encodeURIComponent(sessionId)}/reset`),

  bookingRequest: (requestId: string) =>
    request<{ bookingRequest: BookingRequestRecord }>('GET', `/api/booking-requests/${encodeURIComponent(requestId)}`)
};
