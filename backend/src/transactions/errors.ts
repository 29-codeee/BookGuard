export class TransactionEngineError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode = 400) { super(message); this.name = 'TransactionEngineError'; }
}
