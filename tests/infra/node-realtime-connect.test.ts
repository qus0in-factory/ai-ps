import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectNodeRealtime } from '../../src/infra/node-realtime-connect.ts';
describe('Given the Node dev Realtime connector', () => {
  it('When connecting Then passes the Authorization header rather than putting a key in the URL or protocols', () => {
    let calls = 0;
      const original = globalThis.WebSocket;
      class FakeSocket extends EventTarget {
        readyState = 0; close() {} send(_data: string) {}
        constructor(url: string, options: { headers: Record<string, string> }) {
          super(); calls++; assert.equal(url, 'wss://api.openai.com/v1/realtime?model=test');
          assert.deepEqual(options, { headers: { Authorization: 'Bearer private-key' } });
        }
      }
      try {
        globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
        const socket = connectNodeRealtime('wss://api.openai.com/v1/realtime?model=test', { Authorization: 'Bearer private-key' }, new AbortController().signal);
        assert.ok(socket instanceof FakeSocket); assert.equal(calls, 1);
      } finally { globalThis.WebSocket = original; }
  });
});
