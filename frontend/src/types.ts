export type BookingState = 
  | 'PENDING' 
  | 'HELD' 
  | 'RECONCILING' 
  | 'CONFIRMED' 
  | 'FAILED' 
  | 'EXPIRED' 
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
