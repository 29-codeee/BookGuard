// Mirrors backend/src/chat/types.ts (response shapes of /api/chat).

export type BudgetTier = 'budget' | 'medium' | 'luxury';

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
  pricePerNight: number;
  rating: number;
  area: string;
  amenities: string[];
  inventoryId: string | null;
  source: 'inventory' | 'demo';
}

export interface TransportOption {
  id: string;
  mode: 'flight' | 'train' | 'bus';
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
  transport: number;
  stay: number;
  localAndSightseeing: number;
  total: number;
  perPerson: number;
  withinBudget: boolean | null;
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
  itinerary: DayPlan[] | null;
  hotel: HotelOption | null;
  transport: TransportOption | null;
  places: PlaceOption[];
  estimate: CostEstimate | null;
  bookingRequests: BookingRequestSummary[];
  status: 'COLLECTING' | 'PLANNED';
}

export interface BookingRequestRecord {
  requestId: string;
  type: 'hotel_booking' | 'transport_booking';
  status: string;
  module: string | null;
  message: string | null;
  bookingId: string | null;
  booking?: { status: string; hold?: { expiresAt: string; secondsRemaining: number; status: string } | null } | null;
  request: Record<string, unknown>;
  next: { action: string; method: string; endpoint: string; body: unknown; note: string } | null;
  duplicate?: boolean;
}

export interface ChatTurn {
  success: boolean;
  sessionId: string;
  reply: string;
  trip: TripState;
  missingInformation: string[];
  recommendations: { hotels: HotelOption[]; transport: TransportOption[]; places: PlaceOption[] } | null;
  show: Array<'itinerary' | 'hotels' | 'transport' | 'places' | 'booking_request'>;
  bookingRequest: BookingRequestRecord | null;
  intent: Record<string, unknown> | null;
  aiMode: 'llm' | 'demo';
  aiNotice: string | null;
  suggestions: string[];
  demoDataNotice: string;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  turn?: ChatTurn;
}

export const formatInr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
