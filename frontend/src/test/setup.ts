import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no EventSource; the app's SSE manager only needs a constructible stub.
class EventSourceStub {
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
(globalThis as any).EventSource ??= EventSourceStub;

afterEach(() => cleanup());
