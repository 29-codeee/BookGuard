/**
 * Shared types for the AI Travel Planning Chatbot.
 *
 *   AI service (LLM or demo extractor)
 *      -> TravelIntent            (structured understanding of ONE user message)
 *      -> TripState               (the session's current plan, updated incrementally)
 *      -> BookingRequest          (predictable hand-off format for booking modules)
 */

export type BudgetTier = 'budget' | 'medium' | 'luxury';
export type TransportMode = 'flight' | 'train' | 'bus';
export type PlanTarget = 'hotel' | 'transport' | 'place' | 'itinerary' | 'trip';

export type PlanField = 'destination' | 'origin' | 'startDate' | 'durationDays' | 'travellers' | 'budget';

export type IntentName =
  | 'plan_trip' // new trip request ("I want to visit Goa")
  | 'provide_info' // answers a question ("from Bengaluru, 10 Oct")
  | 'modify_trip' // changes plan fields ("make it 4 days", "add two more people")
  | 'show_options' // "show me hotels", "show cheaper hotels", "show another option"
  | 'select_option' // "select the second hotel"
  | 'book' // "book this one", "book the recommended hotel"
  | 'remove_item' // "remove the train"
  | 'add_item' // "add a train"
  | 'reset' // "start over"
  | 'greeting'
  | 'general_question'
  | 'unknown';

export type IntentAction =
  | 'ask_missing'
  | 'generate_itinerary'
  | 'update_plan'
  | 'show_recommendations'
  | 'create_booking_request'
  | 'answer'
  | 'none';

/**
 * Structured output of the intent extractor. The LLM and the demo extractor both
 * produce exactly this shape, so everything downstream is provider-agnostic.
 * Fields are null when the message does not mention them.
 */
export interface TravelIntent {
  intent: IntentName;
  destination: string | null; // free text as the user said it ("Goa", "Kerala")
  origin: string | null;
  startDate: string | null; // YYYY-MM-DD, resolved relative to today
  durationDays: number | null; // absolute ("3 days", "make it 4 days")
  durationDelta: number | null; // relative ("one more day")
  travellers: number | null; // absolute headcount incl. the user
  travellersDelta: number | null; // relative ("add two more people")
  budgetTier: BudgetTier | null;
  budgetAmount: number | null; // INR total, if a number was given
  preferences: string[]; // beach, heritage, food, nightlife, adventure, nature...
  target: PlanTarget | null; // what a show/select/book/remove/add applies to
  transportMode: TransportMode | null;
  optionIndex: number | null; // 1-based "the second one"
  optionId: string | null; // explicit id when known (UI buttons)
  optionWhich: 'next' | 'cheaper' | 'better' | 'current' | null;
  pendingField: PlanField | null; // user wants to change this field but gave no value ("change my travel date")
  missingInformation: string[]; // advisory; the orchestrator recomputes it
  action: IntentAction; // advisory
  reply: string | null; // only for greeting / general_question
}

export interface PlaceOption {
  id: string;
  name: string;
  area: string;
  tags: string[];
  entryFeeInr: number;
  durationHrs: number;
  description: string;
}

export interface HotelOption {
  id: string;
  name: string;
  tier: BudgetTier;
  pricePerNight: number; // per room
  rating: number;
  area: string;
  amenities: string[];
  inventoryId: string | null; // set when the hotel exists in BookGuard inventory
  source: 'inventory' | 'demo';
}

export interface TransportOption {
  id: string;
  mode: TransportMode;
  operator: string;
  code: string;
  fromCode: string;
  toCode: string;
  departure: string;
  arrival: string;
  pricePerPerson: number;
  seatsAvailable: number | null;
  inventoryId: string | null;
  source: 'inventory' | 'demo';
}

export interface DayPlan {
  day: number;
  title: string;
  activities: string[];
  placeIds: string[];
}

export interface CostEstimate {
  transport: number; // round trip, all travellers
  stay: number;
  localAndSightseeing: number;
  total: number;
  perPerson: number;
  withinBudget: boolean | null;
  currency: 'INR';
}

export interface BookingRequestSummary {
  requestId: string;
  type: 'hotel_booking' | 'transport_booking';
  itemId: string;
  itemName: string;
  status: string;
  bookingId: string | null;
  createdAt: string;
}

export interface TripState {
  destination: { id: string; name: string; code: string } | null;
  origin: { code: string; name: string } | null;
  startDate: string | null;
  durationDays: number | null;
  travellers: number | null;
  budget: { tier: BudgetTier; amountInr: number | null } | null;
  preferences: string[];
  preferredTransportMode: TransportMode | null;
  itinerary: DayPlan[] | null;
  hotel: HotelOption | null;
  transport: TransportOption | null;
  places: PlaceOption[];
  removed: { hotel: boolean; transport: boolean };
  cursor: { hotel: number; transport: number }; // for "show another option"
  shown: { hotel: string[]; transport: string[] }; // ids in the order last displayed ("the second one")
  lastShown: 'hotel' | 'transport' | 'place' | null;
  askedFor: string[]; // fields we already asked about (budget is asked once, then defaulted)
  pendingField: PlanField | null; // a change the user started but has not given a value for
  estimate: CostEstimate | null;
  bookingRequests: BookingRequestSummary[];
  status: 'COLLECTING' | 'PLANNED';
}

export interface Recommendations {
  hotels: HotelOption[];
  transport: TransportOption[];
  places: PlaceOption[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

/** Everything the UI needs to render one assistant turn. */
export interface ChatTurnResult {
  sessionId: string;
  reply: string;
  trip: TripState;
  missingInformation: string[];
  recommendations: Recommendations | null;
  show: Array<'itinerary' | 'hotels' | 'transport' | 'places' | 'booking_request'>;
  bookingRequest: unknown | null;
  intent: TravelIntent | null;
  aiMode: 'llm' | 'demo';
  aiNotice: string | null;
  suggestions: string[];
  demoDataNotice: string;
}
