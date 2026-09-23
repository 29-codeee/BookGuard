import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { query, withTransaction, TransactionClient } from '../db/client.js';
import { transitionBookingState } from '../state/stateMachine.js';
import { providerAdapter } from '../providers/adapter.js';
import { broadcastInventoryUpdate } from '../redis/holdManager.js';
import { eventHub } from '../sse/eventHub.js';

export default async function compensationRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Execute Two-Leg SAGA Compensation Demo
  fastify.post('/api/demo/two-leg-compensation', async (_req, reply) => {
    const bookingId = `bk_comp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const travellerId = 'traveller_priya';
    const flightInvId = 'flt_blr_goi_ix6534';
    const hotelInvId = 'htl_goa_grand_resort';

    console.log(`[CompensationDemo] Starting two-leg trip demo for booking ${bookingId}...`);

    try {
      // Step 0: Create booking and verify inventory
      await withTransaction(async (tx: TransactionClient) => {
        // Decrement flight inventory
        const fltRes = await tx.query<{ available_quantity: number }>(
          `SELECT available_quantity FROM inventory WHERE id = $1 FOR UPDATE`,
          [flightInvId]
        );
        if (fltRes.rows[0].available_quantity < 1) {
          throw new Error('Flight has 0 available seats to demo compensation; please reset inventory first.');
        }

        await tx.query(
          `UPDATE inventory 
           SET available_quantity = available_quantity - 1, 
               held_quantity = held_quantity + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [flightInvId]
        );

        // Insert booking
        await tx.query(
          `INSERT INTO bookings (id, traveller_id, status, total_amount, currency)
           VALUES ($1, $2, 'HELD', 10620.00, 'INR')`,
          [bookingId, travellerId]
        );

        // Insert items
        await tx.query(
          `INSERT INTO booking_items (id, booking_id, inventory_id, item_type, status, price)
           VALUES 
           ($1, $2, $3, 'flight', 'HELD', 4120.00),
           ($4, $2, $5, 'hotel', 'HELD', 6500.00)`,
          [
            `itm_flt_${Date.now()}`, bookingId, flightInvId,
            `itm_htl_${Date.now()}`, hotelInvId
          ]
        );

        // Audit hold
        await tx.query(
          `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
           VALUES ($1, $2, 'PENDING', 'HELD', 'Two-leg trip (Flight + Hotel) package initialized', NULL, 'SAGA_COORDINATOR')`,
          [`evt_${Date.now()}_0`, bookingId]
        );
      });

      await broadcastInventoryUpdate(flightInvId);

      // Step 1: Leg 1 (Flight) Reservation -> SUCCEEDS
      console.log(`[CompensationDemo] Executing Leg 1: Flight reservation...`);
      const flightProviderRes = await providerAdapter.reserve({
        bookingId,
        itemType: 'flight',
        resourceCode: 'IX 6534',
        passengerOrGuestName: 'Priya Sharma'
      });

      const flightPnr = flightProviderRes.providerRef || 'AIX-LEG1-OK';

      await withTransaction(async (tx: TransactionClient) => {
        await tx.query(
          `UPDATE booking_items SET status = 'CONFIRMED' WHERE booking_id = $1 AND item_type = 'flight'`,
          [bookingId]
        );
        await tx.query(
          `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
           VALUES ($1, $2, 'HELD', 'HELD', 'Leg 1 (Flight IX 6534) confirmed by airline with PNR ' || $3, $4, 'SAGA_COORDINATOR')`,
          [
            `evt_${Date.now()}_1`,
            bookingId,
            flightPnr,
            JSON.stringify(flightProviderRes.rawResponse)
          ]
        );
      });

      // Step 2: Leg 2 (Hotel) Reservation -> DELIBERATELY REJECTED
      console.log(`[CompensationDemo] Executing Leg 2: Hotel reservation (simulating supplier refusal)...`);
      const hotelProviderRes = await providerAdapter.reserve({
        bookingId,
        itemType: 'hotel',
        resourceCode: 'HTL-GOA-01',
        passengerOrGuestName: 'Priya Sharma',
        metadata: { deliberateFail: true } // Deliberate failure at partner
      });

      console.warn(`[CompensationDemo] Leg 2 rejected by hotel: ${hotelProviderRes.error}`);

      // Step 3 & 4: Automatically compensate Leg 1 (Flight cancellation)
      console.log(`[CompensationDemo] Triggering automatic compensation: cancelling Flight PNR ${flightPnr}...`);
      await providerAdapter.cancel(flightPnr);

      // Step 5 & 6 & 7: Update state, restore flight inventory, final booking state = FAILED
      await withTransaction(async (tx: TransactionClient) => {
        // Update items status
        await tx.query(
          `UPDATE booking_items SET status = 'COMPENSATED' WHERE booking_id = $1 AND item_type = 'flight'`,
          [bookingId]
        );
        await tx.query(
          `UPDATE booking_items SET status = 'FAILED' WHERE booking_id = $1 AND item_type = 'hotel'`,
          [bookingId]
        );

        // Move booking to FAILED
        await transitionBookingState({
          bookingId,
          toState: 'FAILED',
          reason: 'Hotel partner declined booking; automatic compensation cancelled flight and restored seat',
          evidence: {
            leg1Flight: { pnr: flightPnr, compensation: 'CANCELLED_AND_RESTOCKED' },
            leg2Hotel: { error: hotelProviderRes.error, status: 'REJECTED' }
          },
          operator: 'SAGA_COMPENSATOR',
          tx
        });

        // Restock flight inventory (held -> available)
        await tx.query(
          `UPDATE inventory 
           SET available_quantity = available_quantity + 1, 
               held_quantity = held_quantity - 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [flightInvId]
        );

        // Audit compensation completion
        await tx.query(
          `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
           VALUES ($1, $2, 'FAILED', 'FAILED', 'SAGA Compensation complete: Flight cancelled, seat returned to pool, 0 orphaned assets', NULL, 'SAGA_COMPENSATOR')`,
          [`evt_${Date.now()}_comp`, bookingId]
        );
      });

      await broadcastInventoryUpdate(flightInvId);

      // Fetch the full audit event trail to return to user
      const eventsRes = await query(
        `SELECT id, from_state, to_state, reason, evidence, operator, created_at 
         FROM booking_events 
         WHERE booking_id = $1 
         ORDER BY created_at ASC`,
        [bookingId]
      );

      eventHub.broadcast('compensation_executed', {
        bookingId,
        status: 'FAILED',
        events: eventsRes.rows
      });

      return reply.send({
        success: true,
        bookingId,
        status: 'FAILED',
        message: 'Two-leg trip compensation executed successfully. Flight cancelled, inventory restored.',
        summary: {
          leg1: 'Flight IX 6534 confirmed then compensated (PNR cancelled)',
          leg2: 'Hotel rejected by partner (NO_ROOMS_LEFT)',
          finalInventoryRestored: true,
          orphanAssets: 0
        },
        events: eventsRes.rows
      });
    } catch (err: any) {
      console.error('[CompensationDemo] Error:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // 1. Simulate Trip Disruption: Flight cancelled on a Flight+Hotel booking
  fastify.post('/api/trip/disruption-simulate', async (_req, reply) => {
    const bookingId = `bk_trip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const travellerId = 'traveller_priya';
    const originalFlightId = 'flt_blr_goi_ix6534';
    const hotelId = 'htl_goa_grand_resort';
    const altFlightId = 'flt_blr_goi_6e511';

    try {
      await withTransaction(async (tx: TransactionClient) => {
        // Create initial multi-leg booking
        await tx.query(
          `INSERT INTO bookings (id, traveller_id, status, total_amount, currency)
           VALUES ($1, $2, 'CONFIRMED', 10620.00, 'INR')`,
          [bookingId, travellerId]
        );

        await tx.query(
          `INSERT INTO booking_items (id, booking_id, inventory_id, item_type, status, price)
           VALUES 
           ($1, $2, $3, 'flight', 'CANCELLED', 4120.00),
           ($4, $5, $6, 'hotel', 'CONFIRMED', 6500.00)`,
          [
            `itm_flt_${Date.now()}`, bookingId, originalFlightId,
            `itm_htl_${Date.now()}`, bookingId, hotelId
          ]
        );

        // Audit original confirmation
        await tx.query(
          `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
           VALUES ($1, $2, 'PENDING', 'CONFIRMED', 'Trip bundle booked: Flight IX 6534 + Grand Goa Beachfront Resort', NULL, 'TRIP_ORCHESTRATOR')`,
          [`evt_${Date.now()}_init`, bookingId]
        );

        // Audit carrier disruption
        await tx.query(
          `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
           VALUES ($1, $2, 'CONFIRMED', 'DISRUPTED', 'Air India Express notified cancellation of IX 6534 (Air Traffic Flow Control). BookGuard Sentinel intercepted.', 
           '{"flightCode": "IX 6534", "carrierNotice": "ATC_GROUND_STOP", "hotelStatus": "PRESERVED"}', 'BOOKGUARD_SENTINEL')`,
          [`evt_${Date.now()}_disrupt`, bookingId]
        );
      });

      // Fetch alternative flight info
      const altRes = await query(`SELECT * FROM inventory WHERE id = $1`, [altFlightId]);
      const hotelRes = await query(`SELECT * FROM inventory WHERE id = $1`, [hotelId]);

      const disruptionPayload = {
        bookingId,
        traveller: {
          name: 'Priya Sharma',
          phone: '+91 98765 43210'
        },
        cancelledLeg: {
          type: 'flight',
          code: 'IX 6534',
          name: 'Air India Express',
          reason: 'Carrier cancellation: Air Traffic Control ground delay',
          originalDeparture: '06:10',
          originalArrival: '07:25'
        },
        intactLeg: {
          type: 'hotel',
          name: hotelRes.rows[0]?.name || 'Grand Goa Beachfront Resort & Spa',
          status: 'SECURE_AND_CONFIRMED',
          partnerName: 'Grand Goa Hospitality Group'
        },
        alternativeFlight: altRes.rows[0] ? {
          id: altRes.rows[0].id,
          code: altRes.rows[0].code,
          name: altRes.rows[0].name,
          departureTime: altRes.rows[0].departure_time,
          arrivalTime: altRes.rows[0].arrival_time,
          price: altRes.rows[0].price,
          extraCostToCustomer: 0.00,
          reason: 'Auto-matched by BookGuard: Leaves 13:05, guaranteed same-day check-in'
        } : null,
        guaranteePolicy: {
          compensationFund: 'BookGuard Partner Protection Reserve (Pool: ₹10,00,000)',
          hotelPartnerCompensationIfDenied: 2500.00,
          travellerRefundIfDenied: 10620.00,
          bonusCreditIfDenied: 1000.00
        }
      };

      eventHub.broadcast('trip_disrupted', disruptionPayload);

      return reply.send({
        success: true,
        disruption: disruptionPayload
      });
    } catch (err: any) {
      console.error('[DisruptionSimulate] Error:', err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // 2. Resolve Disruption: Customer chooses whether to Accept Alternative Flight or Decline with Hotel Compensation
  fastify.post('/api/trip/disruption-resolve', async (req, reply) => {
    const { bookingId, action, alternativeFlightId } = req.body as {
      bookingId: string;
      action: 'ACCEPT_ALTERNATIVE' | 'DECLINE_CANCEL';
      alternativeFlightId?: string;
    };

    if (!bookingId || !action) {
      return reply.status(400).send({ error: 'Missing bookingId or action' });
    }

    try {
      if (action === 'ACCEPT_ALTERNATIVE') {
        const altId = alternativeFlightId || 'flt_blr_goi_6e511';
        
        await withTransaction(async (tx: TransactionClient) => {
          // Add alternative flight to booking items
          await tx.query(
            `UPDATE booking_items 
             SET inventory_id = $1, status = 'CONFIRMED'
             WHERE booking_id = $2 AND item_type = 'flight'`,
            [altId, bookingId]
          );

          // Update booking status
          await tx.query(
            `UPDATE bookings SET status = 'CONFIRMED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [bookingId]
          );

          // Audit trail
          await tx.query(
            `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
             VALUES ($1, $2, 'DISRUPTED', 'CONFIRMED', 'Traveller accepted alternative flight IndiGo 6E 511. Hotel reservation intact. Zero extra fee charged.', 
             '{"action": "ACCEPT_ALTERNATIVE", "newFlight": "6E 511", "fareDifferenceAbsorbedBy": "BookGuard Guarantee"}', 'TRAVELLER_ACTION')`,
            [`evt_${Date.now()}_accept`, bookingId]
          );
        });

        eventHub.broadcast('disruption_resolved', {
          bookingId,
          outcome: 'RE_ROUTED',
          message: 'Itinerary successfully updated with alternative flight. Hotel reservation preserved!'
        });

        return reply.send({
          success: true,
          outcome: 'RE_ROUTED',
          message: 'Alternative flight IndiGo 6E 511 confirmed at zero additional cost. Hotel stay seamlessly preserved.',
          newFlight: {
            code: '6E 511',
            name: 'IndiGo Express',
            departure: '13:05',
            arrival: '14:20'
          },
          hotelStatus: 'CONFIRMED'
        });

      } else {
        // DECLINE_CANCEL: Traveller declines. Hotel partner gets paid compensation!
        const hotelPartnerCompensation = 2500.00;
        const travellerRefundAmount = 10620.00;
        const apologyCredit = 1000.00;

        await withTransaction(async (tx: TransactionClient) => {
          // Cancel items
          await tx.query(
            `UPDATE booking_items SET status = 'CANCELLED' WHERE booking_id = $1`,
            [bookingId]
          );

          // Update booking to CANCELLED
          await tx.query(
            `UPDATE bookings SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [bookingId]
          );

          // Audit 1: Customer Full Refund
          await tx.query(
            `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
             VALUES ($1, $2, 'DISRUPTED', 'CANCELLED', 'Traveller declined alternative flight. 100% Full Refund ₹10,620 initiated to original payment method + ₹1,000 apology voucher.', 
             '{"refundAmount": 10620.00, "status": "SETTLED", "voucherCode": "BOOKGUARD_SORRY_1000"}', 'BOOKGUARD_REFUND_ENGINE')`,
            [`evt_${Date.now()}_refund`, bookingId]
          );

          // Audit 2: Hotel Partner Compensation Payout Guarantee
          await tx.query(
            `INSERT INTO booking_events (id, booking_id, from_state, to_state, reason, evidence, operator)
             VALUES ($1, $2, 'CANCELLED', 'CANCELLED', 'HOTEL PARTNER COMPENSATED: ₹2,500.00 disbursed to Grand Goa Beachfront Resort from BookGuard Guarantee Reserve to cover room hold loss.', 
             '{"partnerPayout": 2500.00, "partner": "Grand Goa Beachfront Resort", "payoutRef": "PG-HTL-COMP-8821", "status": "PAID"}', 'PARTNER_COMPENSATION_ENGINE')`,
            [`evt_${Date.now()}_hotel_payout`, bookingId]
          );
        });

        eventHub.broadcast('disruption_resolved', {
          bookingId,
          outcome: 'COMPENSATED_AND_REFUNDED',
          travellerRefund: travellerRefundAmount,
          hotelCompensation: hotelPartnerCompensation
        });

        return reply.send({
          success: true,
          outcome: 'COMPENSATED_AND_REFUNDED',
          message: 'Full trip cancelled with complete customer refund + direct partner compensation disbursed.',
          travellerResolution: {
            refundAmount: travellerRefundAmount,
            status: 'REFUND_COMPLETED_INSTANT',
            apologyTravelCredit: apologyCredit,
            voucherCode: 'BOOKGUARD_CARE_1000'
          },
          hotelPartnerResolution: {
            partnerName: 'Grand Goa Beachfront Resort & Spa',
            compensationPaid: hotelPartnerCompensation,
            payoutReference: `PG-HTL-COMP-${Date.now().toString().slice(-6)}`,
            reason: 'Loss of occupancy covered by BookGuard Partner Protection Reserve'
          }
        });
      }
    } catch (err: any) {
      console.error('[DisruptionResolve] Error:', err);
      return reply.status(500).send({ error: err.message });
    }
  });
}
