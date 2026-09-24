import { FastifyReply } from 'fastify';

interface SSEClient {
  id: string;
  reply: FastifyReply;
}

export interface TraceEvent {
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

  emitTrace(event: Omit<TraceEvent, 'timestamp'>): void {
    this.broadcast('ops_trace', {
      ...event,
      timestamp: new Date().toISOString()
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const eventHub = new SSEEventHub();
