import type { RealtimeConnect, RealtimeSocket } from './openai-realtime-speech.ts';

// Node's Undici WebSocket supports header options; lib.dom only describes browser protocols.
type HeaderWebSocket = new (url: string, options: { headers: Record<string, string> }) => RealtimeSocket;
export const connectNodeRealtime: RealtimeConnect = (url, headers) =>
  new (globalThis.WebSocket as unknown as HeaderWebSocket)(url, { headers });
