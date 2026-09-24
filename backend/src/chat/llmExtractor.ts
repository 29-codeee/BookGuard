/**
 * AI SERVICE: configurable provider for travel intent extraction.
 *
 * The LLM's ONLY job is to understand the latest user message and return a
 * schema-validated TravelIntent (structured outputs). It never decides prices,
 * availability or bookings; the planner/orchestrator do that from real data.
 *
 * Configuration (backend/.env, never the frontend):
 *   CHAT_AI_PROVIDER    - anthropic (default) or gemini
 *   ANTHROPIC_API_KEY / GEMINI_API_KEY - enables the selected provider
 *   CHAT_AI_MODEL       - optional, provider-specific model override
 *   CHAT_AI_MODE=demo   - force the offline demo extractor even when a key exists
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { DESTINATIONS, ORIGIN_CITIES } from './demoData.js';
import type { ChatMessage, TravelIntent, TripState } from './types.js';

export const DEFAULT_CHAT_MODEL = 'claude-opus-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const geminiUsage = { calls: 0, callsWithUsage: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export function getGeminiUsage() {
  return { ...geminiUsage, provider: 'gemini', note: 'Process-local totals; counts only usage returned by Google.' };
}

export function chatProvider(): 'anthropic' | 'gemini' {
  return (process.env.CHAT_AI_PROVIDER || '').toLowerCase() === 'gemini' ? 'gemini' : 'anthropic';
}

export function chatModel(): string {
  return process.env.CHAT_AI_MODEL || (chatProvider() === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_CHAT_MODEL);
}

/** Mirrors TravelIntent. Every field is required-but-nullable, as structured outputs expect. */
export const TravelIntentSchema = z.object({
  intent: z.enum([
    'plan_trip',
    'provide_info',
    'modify_trip',
    'show_options',
    'select_option',
    'book',
    'remove_item',
    'add_item',
    'reset',
    'greeting',
    'general_question',
    'unknown'
  ]),
  destination: z.string().nullable(),
  origin: z.string().nullable(),
  startDate: z.string().nullable(),
  durationDays: z.number().int().nullable(),
  durationDelta: z.number().int().nullable(),
  travellers: z.number().int().nullable(),
  travellersDelta: z.number().int().nullable(),
  budgetTier: z.enum(['budget', 'medium', 'luxury']).nullable(),
  budgetAmount: z.number().nullable(),
  preferences: z.array(z.string()),
  target: z.enum(['hotel', 'transport', 'place', 'itinerary', 'trip']).nullable(),
  transportMode: z.enum(['flight', 'train', 'bus']).nullable(),
  bookingPriority: z.enum(['flight', 'hotel', 'train', 'bus']).nullable().optional().default(null),
  optionIndex: z.number().int().nullable(),
  optionId: z.string().nullable(),
  optionWhich: z.enum(['next', 'cheaper', 'better', 'current']).nullable(),
  pendingField: z.enum(['destination', 'origin', 'startDate', 'durationDays', 'travellers', 'budget', 'priority']).nullable(),
  missingInformation: z.array(z.string()),
  action: z.enum([
    'ask_missing',
    'generate_itinerary',
    'update_plan',
    'show_recommendations',
    'create_booking_request',
    'answer',
    'none'
  ]),
  reply: z.string().nullable()
});

// Stable system prompt (no timestamps or per-request data) so it can be prompt-cached.
const SYSTEM_PROMPT = `You are the language-understanding component of a travel-planning chatbot for an Indian travel-booking prototype.
Read the latest user message (with the conversation and current trip state for context) and return ONE JSON object describing what the user wants. Another component builds the plan, prices and bookings from real data, so never invent prices, availability, hotel names or booking confirmations.

Supported destinations: ${DESTINATIONS.map(d => `${d.name} [${d.aliases.join(', ')}]`).join('; ')}.
Known starting cities: ${ORIGIN_CITIES.map(c => c.name).join(', ')}.
If the user names a destination outside this list, still put it in "destination" exactly as written; the planner will explain it is not supported yet.

Field rules:
- Only fill fields the LATEST message states or clearly implies. Use null / [] otherwise. Do not repeat values that are already in the trip state unless the user restates or changes them.
- travellers is the total headcount INCLUDING the user: "with 2 friends" = 3, "me and my wife" = 2, "family of 4" = 4, "solo" = 1. "add two more people" is travellersDelta = 2, not travellers.
- durationDays is the total trip length in days ("3 days" = 3, "2 nights" = 3, "a week" = 7, "weekend" = 2, "make it 4 days instead" = 4). "one more day" is durationDelta = 1.
- startDate must be YYYY-MM-DD, resolved against the "today" date given in the message. Pick the next future occurrence for dates without a year.
- budgetTier: budget / cheap / backpacker -> budget; luxury / premium / 5-star -> luxury; mid-range / comfortable -> medium. budgetAmount is a total INR figure if a number is given ("under 30k" = 30000).
- preferences: short lowercase tags such as beach, heritage, food, nightlife, adventure, nature, shopping, culture.
- target: which part of the plan a show/select/book/remove/add/change request is about. Trains, flights and buses are all "transport" (put the mode in transportMode). "the hotel", "stay" -> hotel. Places / sightseeing -> place.
- optionIndex is 1-based ("the second one" = 2). optionWhich: "another/different/change the X" -> next, "cheaper" -> cheaper, "better/nicer" -> better, "this one/the recommended one" -> current.
- pendingField: set when the user asks to change a field without giving the new value ("change my travel date" -> startDate).

Intent rules:
- plan_trip: a new trip request. provide_info: answering a question. modify_trip: changing duration, dates, travellers, budget, origin or destination of an existing plan.
- show_options: wants to see hotels / transport / places, cheaper or other options, or "change the hotel".
- select_option: picks an option without booking. book: "book this one", "book the hotel" (creates a demo booking request; never claim it is confirmed).
- remove_item / add_item: remove or add the hotel, transport or a mode ("add a train").
- reset: start over. greeting / general_question: set "reply" to a short, friendly travel-related answer (max 2 sentences, no prices). Otherwise reply = null.
- action is your best guess of the next step; missingInformation lists plan fields still unknown after this message (from: destination, origin, startDate, durationDays, travellers, budget).`;

export interface ExtractInput {
  message: string;
  history: ChatMessage[];
  trip: TripState;
  today: string;
}

export class AiServiceError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
    this.name = 'AiServiceError';
  }
}

function tripSnapshot(trip: TripState) {
  return {
    destination: trip.destination?.name ?? null,
    origin: trip.origin?.name ?? null,
    startDate: trip.startDate,
    durationDays: trip.durationDays,
    travellers: trip.travellers,
    budget: trip.budget,
    preferences: trip.preferences,
    hotel: trip.hotel ? { id: trip.hotel.id, name: trip.hotel.name } : null,
    transport: trip.transport ? { id: trip.transport.id, mode: trip.transport.mode, operator: trip.transport.operator } : null,
    lastShown: trip.lastShown,
    pendingField: trip.pendingField
  };
}

export function buildUserContent(input: ExtractInput): string {
  const recent = input.history
    .slice(-8)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
    .join('\n');
  return [
    `Today: ${input.today}`,
    `Current trip state: ${JSON.stringify(tripSnapshot(input.trip))}`,
    `Recent conversation:\n${recent || '(none)'}`,
    `Latest user message: ${JSON.stringify(input.message)}`
  ].join('\n\n');
}

export function isLlmConfigured(): boolean {
  if ((process.env.CHAT_AI_MODE || '').toLowerCase() === 'demo') return false;
  return chatProvider() === 'gemini'
    ? Boolean(process.env.GEMINI_API_KEY)
    : Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Credentials come from the environment (ANTHROPIC_API_KEY); never hard-coded.
  client ??= new Anthropic({ timeout: 25_000, maxRetries: 1 });
  return client;
}

export async function extractIntentWithLlm(input: ExtractInput): Promise<TravelIntent> {
  if (chatProvider() === 'gemini') return extractIntentWithGemini(input);
  const model = chatModel();
  try {
    const response = await getClient().beta.messages.parse({
      model,
      max_tokens: 4000,
      // Server-side fallback: if the primary model declines, the API retries on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      cache_control: { type: 'ephemeral' },
      system: SYSTEM_PROMPT,
      // Short extraction task: low effort keeps chat latency and cost down.
      output_config: { effort: 'low', format: betaZodOutputFormat(TravelIntentSchema) },
      messages: [{ role: 'user', content: buildUserContent(input) }]
    });

    if (response.stop_reason === 'refusal') {
      throw new AiServiceError('refusal', 'The AI service declined this request');
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      throw new AiServiceError('unparseable', 'The AI service returned an incomplete response');
    }
    return response.parsed_output as TravelIntent;
  } catch (err) {
    if (err instanceof AiServiceError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AiServiceError('auth', 'AI service credentials were rejected');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AiServiceError('rate_limited', 'AI service is rate limited');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new AiServiceError('unreachable', 'AI service could not be reached');
    }
    if (err instanceof Anthropic.APIError) {
      throw new AiServiceError(`api_${err.status ?? 'error'}`, `AI service error: ${err.message}`);
    }
    throw new AiServiceError('unexpected', (err as Error)?.message || 'Unknown AI service error');
  }
}

async function extractIntentWithGemini(input: ExtractInput): Promise<TravelIntent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiServiceError('auth', 'Gemini API key is not configured');
  const model = chatModel();
  try {
    geminiUsage.calls += 1;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\nReturn only a JSON object matching the TravelIntent fields. Use null for unknown scalar values and empty arrays for unknown list values.` }] },
        contents: [{ role: 'user', parts: [{ text: buildUserContent(input) }] }],
        // Gemini 3.8 Flash works best with its default sampling configuration.
        generationConfig: { responseMimeType: 'application/json' }
      }),
      signal: AbortSignal.timeout(25_000)
    });
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; error?: { message?: string }; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } };
    if (payload.usageMetadata) {
      const usage = payload.usageMetadata;
      geminiUsage.callsWithUsage += 1;
      geminiUsage.inputTokens += usage.promptTokenCount ?? 0;
      geminiUsage.outputTokens += usage.candidatesTokenCount ?? 0;
      geminiUsage.totalTokens += usage.totalTokenCount ?? 0;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new AiServiceError('auth', 'Gemini credentials were rejected');
      if (response.status === 429) throw new AiServiceError('rate_limited', 'Gemini API is rate limited');
      throw new AiServiceError(`api_${response.status}`, `Gemini API error: ${payload.error?.message || response.statusText}`);
    }
    const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('').trim();
    if (!text) throw new AiServiceError('unparseable', 'Gemini returned an empty response');
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw new AiServiceError('unparseable', 'Gemini returned invalid JSON'); }
    const validated = TravelIntentSchema.safeParse(parsed);
    if (!validated.success) throw new AiServiceError('unparseable', 'Gemini response did not match the travel intent format');
    return validated.data as TravelIntent;
  } catch (err) {
    if (err instanceof AiServiceError) throw err;
    throw new AiServiceError('unreachable', `Gemini API could not be reached: ${(err as Error)?.message || 'unknown error'}`);
  }
}
