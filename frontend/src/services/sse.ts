type SSEListener = (event: string, data: any) => void;

class SSEClientManager {
  private eventSource: EventSource | null = null;
  private listeners: SSEListener[] = [];
  private isConnecting = false;

  connect() {
    if (this.eventSource || this.isConnecting) return;
    this.isConnecting = true;

    const url = `${import.meta.env.VITE_API_URL || ''}/api/events`;
    console.log('[SSE] Connecting to live event stream:', url);
    const es = new EventSource(url);

    es.onopen = () => {
      console.log('[SSE] Connected to BookGuard real-time event hub');
      this.isConnecting = false;
    };

    es.onerror = (err) => {
      console.warn('[SSE] EventSource connection dropped, will retry automatically:', err);
      this.isConnecting = false;
    };

    // Generic message handler
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        this.notify('message', data);
      } catch {
        // ignore
      }
    };

    // Named events
    const eventTypes = [
      'connected',
      'inventory_updated',
      'booking_state_changed',
      'hold_expired',
      'copilot_recommendation',
      'reconciliation_resolved',
      'stampede_completed',
      'compensation_executed',
      'demo_reset',
      'provider_mode_changed'
    ];

    eventTypes.forEach(evt => {
      es.addEventListener(evt, (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data);
          this.notify(evt, parsed);
        } catch (err) {
          console.error(`[SSE] Error parsing ${evt} payload:`, err);
        }
      });
    });

    this.eventSource = es;
  }

  subscribe(listener: SSEListener): () => void {
    this.listeners.push(listener);
    this.connect();
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(event: string, data: any) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (err) {
        console.error('[SSE] Listener error:', err);
      }
    }
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.listeners = [];
  }
}

export const sseManager = new SSEClientManager();
