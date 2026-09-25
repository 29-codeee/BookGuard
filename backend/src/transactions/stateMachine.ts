export type TransactionState =
  | 'PENDING'
  | 'RESERVING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'FAILED'
  | 'ROLLBACK_FAILED';

export const TRANSACTION_TRANSITIONS: Record<TransactionState, readonly TransactionState[]> = {
  PENDING: ['RESERVING', 'FAILED'],
  RESERVING: ['PROCESSING', 'ROLLING_BACK', 'FAILED'],
  PROCESSING: ['COMPLETED', 'ROLLING_BACK', 'FAILED'],
  COMPLETED: ['ROLLING_BACK'],
  ROLLING_BACK: ['ROLLED_BACK', 'ROLLBACK_FAILED'],
  ROLLED_BACK: [],
  FAILED: [],
  ROLLBACK_FAILED: []
};

export function canTransitionTransaction(from: TransactionState, to: TransactionState): boolean {
  return TRANSACTION_TRANSITIONS[from].includes(to);
}

export type TransactionItemState =
  | 'PENDING'
  | 'RESERVING'
  | 'RESERVED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'RELEASED';

export const TRANSACTION_ITEM_TRANSITIONS: Record<TransactionItemState, readonly TransactionItemState[]> = {
  PENDING: ['RESERVING', 'FAILED'],
  RESERVING: ['RESERVED', 'FAILED'],
  RESERVED: ['PROCESSING', 'EXPIRED', 'RELEASED', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: ['RELEASED'],
  FAILED: [],
  EXPIRED: [],
  RELEASED: []
};

export function canTransitionTransactionItem(from: TransactionItemState, to: TransactionItemState): boolean {
  return TRANSACTION_ITEM_TRANSITIONS[from].includes(to);
}

export type ProviderOperationState =
  | 'PENDING'
  | 'RESERVING'
  | 'RESERVED'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'FAILED';

export const PROVIDER_TRANSITIONS: Record<ProviderOperationState, readonly ProviderOperationState[]> = {
  PENDING: ['RESERVING', 'FAILED'],
  RESERVING: ['RESERVED', 'FAILED'],
  RESERVED: ['CONFIRMING', 'CANCELLING', 'FAILED'],
  CONFIRMING: ['CONFIRMED', 'FAILED'],
  CONFIRMED: ['CANCELLING'],
  CANCELLING: ['CANCELLED', 'FAILED'],
  CANCELLED: [],
  FAILED: ['CANCELLING']
};

export function canTransitionProvider(from: ProviderOperationState, to: ProviderOperationState): boolean {
  return PROVIDER_TRANSITIONS[from].includes(to);
}
