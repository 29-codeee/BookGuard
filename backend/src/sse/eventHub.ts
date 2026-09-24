import crypto from 'crypto';
import { FastifyReply } from 'fastify';
import { query } from '../db/client.js';

interface SSEClient {
  id: string;
  reply: FastifyReply;
}

export interface TraceEvent {
  id: string;
  traceId: string;
  timestamp: string;
  type: 'HOLD' | 'CONFIRM' | 'EXPIRY' | 'CANCEL';
  stage: string;
  message: string;
  status: 'running' | 'success' | 'failed' | 'info';
  resourceId?: string;
  bookingId?: string;
  holdId?: string;
  data?: any;
}

class SSEEventHub {
  private clients = new Map<string, SSEClient>();
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private pendingPersists = 0;

  constructor() {
    this.keepAliveTimer = setInterval(() => {
      this.broadcast('ping', { timestamp: new Date().toISOString() });
    }, 15000);
  }

  addClient(id: string, reply: FastifyReply): void {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.flushHeaders?.();

    // Send initial connected event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ clientId: id, timestamp: new Date().toISOString() })}\n\n`);

    this.clients.set(id, { id, reply });
    console.log(`[SSE] Client connected: ${id}. Active listeners: ${this.clients.size}`);

    reply.raw.on('close', () => {
      this.clients.delete(id);
      console.log(`[SSE] Client disconnected: ${id}. Remaining listeners: ${this.clients.size}`);
    });
  }

  broadcast(event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, client] of this.clients.entries()) {
      try {
        client.reply.raw.write(payload);
      } catch (err) {
        console.error(`[SSE] Failed writing to client ${id}:`, err);
        this.clients.delete(id);
      }
    }
  }

  emitTrace(event: Omit<TraceEvent, 'id' | 'timestamp'>): void {
    const id = crypto.randomUUID();
    const fullEvent: TraceEvent = {
      ...event,
      id,
      timestamp: new Date().toISOString()
    };

    this.broadcast('ops_trace', fullEvent);
    this.persistTrace(fullEvent);
  }

  private persistTrace(event: TraceEvent): void {
    this.pendingPersists++;
    query(
      `INSERT INTO ops_trace_events (id, trace_id, operation_type, event_type, stage, message, booking_id, hold_id, inventory_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        event.id,
        event.traceId,
        event.type,
        event.status,
        event.stage,
        event.message,
        event.bookingId || null,
        event.holdId || null,
        event.resourceId || null,
        event.data ? JSON.stringify(event.data) : null
      ]
    )
      .catch((err) => {
        console.error(`[EventHub] Failed to persist trace event ${event.id}:`, (err as Error).message);
      })
      .finally(() => {
        this.pendingPersists--;
      });
  }

  getPendingPersistCount(): number {
    return this.pendingPersists;
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const eventHub = new SSEEventHub();
