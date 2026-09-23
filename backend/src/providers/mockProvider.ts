export type ProviderMode = 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'DELAY';

export interface ProviderReservationRecord {
  providerRef: string;
  bookingId: string;
  status: 'CONFIRMED' | 'FAILED' | 'CANCELLED';
  flightCode: string;
  passengerName: string;
  createdAt: string;
  updatedAt: string;
}

class MockAirlineProvider {
  private mode: ProviderMode = 'SUCCESS';
  private delayMs = 3000;
  private reservations = new Map<string, ProviderReservationRecord>();
  private timeoutGroundTruth: 'CONFIRMED' | 'FAILED' = 'CONFIRMED'; // What actually happened during timeout

  getMode(): ProviderMode {
    return this.mode;
  }

  setMode(mode: ProviderMode, groundTruth?: 'CONFIRMED' | 'FAILED'): void {
    this.mode = mode;
    if (groundTruth) {
      this.timeoutGroundTruth = groundTruth;
    }
    console.log(`[MockProvider] Simulation mode switched to: ${mode} (Timeout ground truth: ${this.timeoutGroundTruth})`);
  }

  getTimeoutGroundTruth(): 'CONFIRMED' | 'FAILED' {
    return this.timeoutGroundTruth;
  }

  setTimeoutGroundTruth(truth: 'CONFIRMED' | 'FAILED'): void {
    this.timeoutGroundTruth = truth;
  }

  async reserve(bookingId: string, flightCode: string, passengerName: string): Promise<{
    success: boolean;
    providerRef?: string;
    error?: string;
    timeout?: boolean;
    rawResponse: any;
  }> {
    console.log(`[MockProvider] reserve() called for booking ${bookingId}, flight ${flightCode}, passenger ${passengerName}, current mode: ${this.mode}`);

    if (this.mode === 'DELAY') {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }

    if (this.mode === 'TIMEOUT') {
      // Simulate timeout by exceeding client HTTP timeout or throwing TimeoutError
      // BUT on airline's internal side, it either actually created it or did not!
      const providerRef = `AIX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      if (this.timeoutGroundTruth === 'CONFIRMED') {
        this.reservations.set(bookingId, {
          providerRef,
          bookingId,
          status: 'CONFIRMED',
          flightCode,
          passengerName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      // Wait a short moment then simulate timeout
      await new Promise(resolve => setTimeout(resolve, 800));
      return {
        success: false,
        timeout: true,
        error: 'GATEWAY_TIMEOUT: Airline reservation system did not respond within 800ms SLA',
        rawResponse: { error: 'ETIMEDOUT', code: 504 }
      };
    }

    if (this.mode === 'FAILURE') {
      return {
        success: false,
        timeout: false,
        error: 'PROVIDER_REJECTED: Airline inventory seat allocation failed at supplier endpoint',
        rawResponse: { status: 'REJECTED', reason: 'SEAT_UNAVAILABLE_ON_GDS' }
      };
    }

    // SUCCESS
    const providerRef = `AIX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const record: ProviderReservationRecord = {
      providerRef,
      bookingId,
      status: 'CONFIRMED',
      flightCode,
      passengerName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.reservations.set(bookingId, record);

    return {
      success: true,
      providerRef,
      rawResponse: {
        status: 'TICKETED',
        pnr: providerRef,
        issuedAt: record.createdAt,
        airline: 'Air India Express'
      }
    };
  }

  async cancel(providerRefOrBookingId: string): Promise<{ success: boolean; rawResponse: any }> {
    console.log(`[MockProvider] cancel() called for ${providerRefOrBookingId}`);
    for (const [bId, record] of this.reservations.entries()) {
      if (record.providerRef === providerRefOrBookingId || bId === providerRefOrBookingId) {
        record.status = 'CANCELLED';
        record.updatedAt = new Date().toISOString();
        return {
          success: true,
          rawResponse: { status: 'CANCELLED', providerRef: record.providerRef, fee: 0 }
        };
      }
    }
    return {
      success: true,
      rawResponse: { status: 'CANCELLED_NOT_FOUND', providerRef: providerRefOrBookingId }
    };
  }

  async getStatus(bookingIdOrRef: string): Promise<{
    exists: boolean;
    providerRef?: string;
    status: 'CONFIRMED' | 'FAILED' | 'NOT_FOUND' | 'CANCELLED';
    rawResponse: any;
  }> {
    console.log(`[MockProvider] getStatus() query for ${bookingIdOrRef}`);
    for (const [bId, record] of this.reservations.entries()) {
      if (bId === bookingIdOrRef || record.providerRef === bookingIdOrRef) {
        return {
          exists: true,
          providerRef: record.providerRef,
          status: record.status,
          rawResponse: {
            pnr: record.providerRef,
            flightCode: record.flightCode,
            status: record.status,
            passenger: record.passengerName,
            updatedAt: record.updatedAt
          }
        };
      }
    }

    return {
      exists: false,
      status: 'NOT_FOUND',
      rawResponse: { status: 'NOT_FOUND', message: 'No reservation recorded at provider with this reference' }
    };
  }

  // Hotel provider simulation for two-leg demo
  async reserveHotel(bookingId: string, hotelCode: string, guestName: string, shouldFail = false): Promise<{
    success: boolean;
    providerRef?: string;
    error?: string;
    rawResponse: any;
  }> {
    if (shouldFail) {
      return {
        success: false,
        error: 'HOTEL_NO_AVAILABILITY: Hotel partner room inventory overbooked',
        rawResponse: { code: 'NO_ROOMS_LEFT', status: 'DECLINED' }
      };
    }
    const providerRef = `HTL-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    return {
      success: true,
      providerRef,
      rawResponse: { status: 'CONFIRMED', confirmationCode: providerRef, guest: guestName, hotel: hotelCode }
    };
  }
}

export const mockAirlineProvider = new MockAirlineProvider();
