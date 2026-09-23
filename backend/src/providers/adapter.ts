import { mockAirlineProvider } from './mockProvider.js';

export interface ReserveParams {
  bookingId: string;
  itemType: 'flight' | 'hotel';
  resourceCode: string;
  passengerOrGuestName: string;
  metadata?: any;
}

export interface ReserveResult {
  success: boolean;
  timeout: boolean;
  providerRef?: string;
  error?: string;
  rawResponse: any;
}

export interface ProviderStatusResult {
  exists: boolean;
  status: 'CONFIRMED' | 'FAILED' | 'NOT_FOUND' | 'CANCELLED';
  providerRef?: string;
  rawResponse: any;
}

export class ProviderAdapter {
  /**
   * Adapter interface for reserving a travel component with an external supplier
   */
  async reserve(params: ReserveParams): Promise<ReserveResult> {
    try {
      if (params.itemType === 'hotel') {
        const isDeliberateFail = params.metadata?.deliberateFail ?? false;
        const res = await mockAirlineProvider.reserveHotel(
          params.bookingId,
          params.resourceCode,
          params.passengerOrGuestName,
          isDeliberateFail
        );
        return {
          success: res.success,
          timeout: false,
          providerRef: res.providerRef,
          error: res.error,
          rawResponse: res.rawResponse
        };
      }

      // Flight reservation
      const res = await mockAirlineProvider.reserve(
        params.bookingId,
        params.resourceCode,
        params.passengerOrGuestName
      );

      return {
        success: res.success,
        timeout: res.timeout ?? false,
        providerRef: res.providerRef,
        error: res.error,
        rawResponse: res.rawResponse
      };
    } catch (err) {
      return {
        success: false,
        timeout: true,
        error: (err as Error).message,
        rawResponse: { error: (err as Error).name, message: (err as Error).message }
      };
    }
  }

  /**
   * Adapter interface for cancelling an external provider reservation
   */
  async cancel(providerRefOrBookingId: string): Promise<{ success: boolean; rawResponse: any }> {
    return await mockAirlineProvider.cancel(providerRefOrBookingId);
  }

  /**
   * Adapter interface for retrieving ground truth state of a reservation
   */
  async getStatus(bookingIdOrRef: string): Promise<ProviderStatusResult> {
    const res = await mockAirlineProvider.getStatus(bookingIdOrRef);
    return {
      exists: res.exists,
      status: res.status,
      providerRef: res.providerRef,
      rawResponse: res.rawResponse
    };
  }
}

export const providerAdapter = new ProviderAdapter();
