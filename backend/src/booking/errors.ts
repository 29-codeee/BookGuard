/**
 * Typed error thrown by the booking engine.
 *
 * `message` is the machine-readable code (e.g. 'INSUFFICIENT_INVENTORY') so that
 * existing callers doing `err.message === 'INSUFFICIENT_INVENTORY'` keep working.
 */
export class BookingError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly detail: string,
    public readonly extra: Record<string, unknown> = {}
  ) {
    super(code);
    this.name = 'BookingError';
  }

  toBody(): Record<string, unknown> {
    return { success: false, error: this.code, message: this.detail, ...this.extra };
  }
}

export function isBookingError(err: unknown): err is BookingError {
  return err instanceof BookingError;
}
