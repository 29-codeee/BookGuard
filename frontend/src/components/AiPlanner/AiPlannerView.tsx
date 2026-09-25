import React, { useEffect, useRef, useState } from 'react';
import { Bot, Send } from 'lucide-react';
import { chatApi, ChatApiError, PlannerAction, PlannerTarget } from '../../services/chatApi';
import { ChatTurn, TripState, UiMessage } from './chatTypes';
import {
  BookingPriorityCard,
  BookingRequestCard,
  HotelCards,
  ItineraryCard,
  PackageSummaryCard,
  PlaceCards,
  TransportCards
} from './PlannerCards';
import { TripPlanPanel } from './TripPlanPanel';
import './AiPlanner.css';

const SESSION_KEY = 'bookguard.planner.session';
const STARTER_PROMPTS = [
  'I want to visit Goa for 3 days with 2 friends',
  'Plan a trip to Manali for 4 people',
  'I want a budget trip to Hyderabad',
  'Show me hotels in Goa'
];
const WELCOME: UiMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'Hi! I am your BookGuard travel planner. Tell me where you would like to go, and I will ask for anything I need, build an itinerary, and help you pick stays and transport.'
};

// localStorage can throw in private mode; the session id is only a convenience.
const storage = {
  get: () => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(SESSION_KEY, v); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }
};

let msgCounter = 0;
const newId = () => `m${Date.now()}_${msgCounter++}`;

export const AiPlannerView: React.FC = () => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([WELCOME]);
  const [trip, setTrip] = useState<TripState | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>(STARTER_PROMPTS);
  const [aiMode, setAiMode] = useState<'llm' | 'demo' | null>(null);
  const [geminiUsage, setGeminiUsage] = useState<{ calls: number; callsWithUsage: number; inputTokens: number; outputTokens: number; totalTokens: number } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Restore an existing session (text history + trip state) after a page reload.
  useEffect(() => {
    chatApi.status().then(s => setAiMode(s.aiMode)).catch(() => setAiMode(null));
    chatApi.usage().then(result => setGeminiUsage(result.usage)).catch(() => undefined);
    const saved = storage.get();
    if (!saved) { setRestoring(false); return; }
    chatApi
      .session(saved)
      .then(s => {
        setSessionId(s.sessionId);
        setTrip(s.trip);
        if (s.history.length) {
          setMessages([WELCOME, ...s.history.map(h => ({ id: newId(), role: h.role, text: h.text }) as UiMessage)]);
        }
      })
      .catch(() => {
        storage.clear();
        setMessages(prev => prev.length > 1 ? prev : [WELCOME, { id: newId(), role: 'assistant', text: 'Your previous planner session is no longer available. Your trip details may need to be entered again.' }]);
      })
      .finally(() => setRestoring(false));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  const applyTurn = (turn: ChatTurn) => {
    setSessionId(turn.sessionId);
    storage.set(turn.sessionId);
    setTrip(turn.trip);
    setAiMode(prev => prev ?? turn.aiMode); // header shows configured mode; per-turn fallbacks show aiNotice
    if (turn.suggestions?.length) setSuggestions(turn.suggestions);
    setMessages(prev => [...prev, { id: newId(), role: 'assistant', text: turn.reply, turn }]);
    chatApi.usage().then(result => setGeminiUsage(result.usage)).catch(() => undefined);
  };

  const fail = (err: unknown) => {
    const text =
      err instanceof ChatApiError
        ? err.message
        : "I couldn't retrieve that right now. You can try again, or continue with the available demo options.";
    setMessages(prev => [...prev, { id: newId(), role: 'error', text }]);
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || restoring) return;
    setInput('');
    setMessages(prev => [...prev, { id: newId(), role: 'user', text: message }]);
    setBusy(true);
    try {
      applyTurn(await chatApi.send(sessionId, message));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: PlannerAction, target: PlannerTarget, itemId?: string, mode?: string) => {
    if (!sessionId || busy || restoring) return;
    const label = { select: 'Select', book: 'Book', remove: 'Remove', change: 'Change', cheaper: 'Cheaper options', add: 'Add', show: 'Show' }[action];
    const userText = target === 'priority'
      ? (action === 'change' ? 'Change booking priority' : `Priority: ${String(mode || itemId).toUpperCase()} first`)
      : target === 'package'
        ? 'Reserve Complete Package'
        : `${label} ${target}`;
    setMessages(prev => [...prev, { id: newId(), role: 'user', text: userText }]);
    setBusy(true);
    try {
      applyTurn(await chatApi.action(sessionId, action, target, itemId, mode));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    if (sessionId) {
      try {
        await chatApi.reset(sessionId);
      } catch {
        /* a fresh session will be created on the next message anyway */
      }
    }
    storage.clear();
    setSessionId(null);
    setTrip(null);
    setSuggestions(STARTER_PROMPTS);
    setMessages([WELCOME]);
  };

  // Cards always reflect the latest trip, so "Selected" is current even on older messages.
  const liveTrip = trip;

  return (
    <div className="planner-layout">
      <section className="glass-panel planner-chat" aria-label="AI travel planner chat">
        <div className="planner-chat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bot size={22} color="#38bdf8" />
            <div>
              <h2 style={{ fontSize: '1.1rem' }}>AI Travel Planner</h2>
              <div className="opt-meta">Plan, adjust and send demo booking requests by chatting</div>
            </div>
          </div>
          {aiMode && (
            <span className={`planner-mode ${aiMode}`} title={aiMode === 'llm' ? 'Understanding powered by an LLM' : 'No AI key configured: offline demo understanding'}>
              {aiMode === 'llm' ? 'AI mode' : 'Demo mode'}
            </span>
          )}
        </div>
        <details style={{ padding: '0 18px 10px', color: 'var(--text-muted)', fontSize: 12 }}>
          <summary style={{ cursor: 'pointer' }}>Developer usage</summary>
          <div style={{ paddingTop: 8 }}>
            Gemini calls: {geminiUsage?.calls ?? '—'} · input tokens: {geminiUsage?.inputTokens ?? '—'} · output tokens: {geminiUsage?.outputTokens ?? '—'} · total: {geminiUsage?.totalTokens ?? '—'}
            <div>Usage counts come from Gemini responses when available; totals reset when the backend restarts.</div>
          </div>
        </details>

        <div className="planner-messages" aria-live="polite">
          {messages.map(m => (
            <div key={m.id} className={`msg ${m.role === 'user' ? 'user' : m.role === 'error' ? 'error' : 'assistant'}`}>
              <div className="msg-bubble">{m.text}</div>
              {m.turn?.aiNotice && <div className="msg-notice">{m.turn.aiNotice}</div>}
              {m.turn && liveTrip && <TurnCards turn={m.turn} trip={liveTrip} busy={busy || restoring} onAction={act} />}
            </div>
          ))}
          {busy && (
            <div className="msg assistant" aria-label="Assistant is typing">
              <div className="msg-bubble typing"><span /><span /><span /></div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="planner-input">
          <div className="quick-prompts">
            {suggestions.map(s => (
              <button key={s} className="chip" disabled={busy || restoring} onClick={() => send(s)}>{s}</button>
            ))}
          </div>
          <form
            className="input-row"
            onSubmit={e => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={restoring ? 'Restoring your trip…' : 'Try "Plan a 3-day Goa trip from Bengaluru for 3 people"'}
              maxLength={1000}
              aria-label="Message"
              disabled={restoring}
            />
            <button className="btn btn-primary" type="submit" disabled={busy || restoring || !input.trim()} aria-label="Send">
              <Send size={16} /> Send
            </button>
          </form>
        </div>
      </section>

      <TripPlanPanel trip={trip} onReset={reset} busy={busy || restoring} onAction={act} />
    </div>
  );
};

function TurnCards({
  turn,
  trip,
  busy,
  onAction
}: {
  turn: ChatTurn;
  trip: TripState;
  busy: boolean;
  onAction: (a: PlannerAction, t: PlannerTarget, id?: string, mode?: string) => void;
}) {
  const recs = turn.recommendations;
  const itinerary = turn.trip.itinerary;
  const isPlanned = trip.status === 'PLANNED';
  return (
    <>
      {isPlanned && <BookingPriorityCard trip={trip} busy={busy} onAction={onAction} />}
      {turn.show.includes('itinerary') && itinerary && turn.trip.destination && (
        <ItineraryCard itinerary={itinerary} title={`${turn.trip.destination.name}: ${itinerary.length} Day${itinerary.length > 1 ? 's' : ''}`} />
      )}
      {recs && recs.transport.length > 0 && <TransportCards options={recs.transport} trip={trip} busy={busy} onAction={onAction} />}
      {recs && recs.hotels.length > 0 && <HotelCards hotels={recs.hotels} trip={trip} busy={busy} onAction={onAction} />}
      {recs && recs.places.length > 0 && <PlaceCards places={recs.places} trip={trip} busy={busy} onAction={onAction} />}
      {isPlanned && <PackageSummaryCard trip={trip} busy={busy} onAction={onAction} />}
      {turn.bookingRequest && <BookingRequestCard record={turn.bookingRequest} />}
    </>
  );
}
