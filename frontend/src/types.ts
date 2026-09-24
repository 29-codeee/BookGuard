export type BookingState = 
  | 'PENDING' 
  | 'HELD' 
  | 'RECONCILING' 
  | 'CONFIRMED' 
  | 'FAILED' 
  | 'EXPIRED' 
  | 'RELEASED'
  | 'CANCELLED';

export interface InventoryItem {
  id: string;
  resource_type: string;
  code: string;
  name: string;
  origin: string;
  destination: string;
  travel_date: string;
  departure_time: string;
  arrival_time: string;
  price: number | string;
  total_quantity: number;
  available_quantity: number;
  held_quantity: number;
  confirmed_quantity: number;
  invariant_valid?: boolean;
  oversold?: number;
}

// ---- Booking engine: status API ----
export interface BookingStatus {
  bookingId: string;
  status: BookingState;
  bookingMode: 'NORMAL' | 'TATKAL' | 'HIGH_DEMAND';
  travellerId: string;
  totalAmount: number;
  currency: string;
  pnr: string | null;
  confirmInProgress: boolean;
  allowedTransitions: BookingState[];
  hold: {
    holdId: string;
    inventoryId: string;
    quantity: number;
    status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'RELEASED' | 'CANCELLED';
    expiresAt: string;
    secondsRemaining: number;
  } | null;
  items: Array<Record<string, unknown>>;
}

// ---- High-Demand / Tatkal prepared booking ----
export type PreparationStatus = 'DRAFT' | 'READY' | 'APPROVED' | 'SUBMITTED' | 'CANCELLED';
export type PreparationNextAction =
  | 'PREPARE_TRIP'
  | 'PREPARE_PASSENGERS'
  | 'SELECT_INVENTORY'
  | 'PREPARE_PAYMENT'
  | 'WAIT_FOR_WINDOW'
  | 'AWAIT_USER_APPROVAL'
  | 'EXECUTE'
  | 'CONFIRM_PAYMENT'
  | 'NONE';

export interface PreparedPassenger {
  name: string;
  age: number;
  gender?: string;
  berthPreference?: string;
}

export interface PreparedBooking {
  preparationId: string;
  travellerId: string;
  mode: 'TATKAL' | 'HIGH_DEMAND';
  status: PreparationStatus;
  trip: { origin: string; destination: string; travelDate: string; travelClass?: string } | null;
  passengers: PreparedPassenger[];
  inventoryId: string | null;
  selection: InventoryItem | null;
  paymentPreference: { method: 'UPI' | 'CARD' | 'NETBANKING' | 'WALLET'; label?: string } | null;
  windowOpensAt: string | null;
  windowOpen: boolean;
  secondsUntilWindow: number;
  approvedAt: string | null;
  bookingId: string | null;
  booking: { bookingId: string; status: BookingState } | null;
  checklist: { trip: boolean; passengers: boolean; selection: boolean; payment: boolean };
  nextAction: PreparationNextAction;
}
