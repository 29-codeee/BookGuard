export const RESOURCE_TYPES = ['hotel', 'flight', 'transport', 'activity'] as const;
export type ResourceType = typeof RESOURCE_TYPES[number];

export interface RequestedItem { type: ResourceType; resourceId: string; quantity: number }
export interface CreateTransactionInput { customerId: string; items: RequestedItem[] }
export interface ReservationResult { transactionId: string; expiresAt: Date; amount: number; currency: string; items: Array<{ itemId: string; type: ResourceType; resourceId: string; provider: string; unitPrice: number }> }
