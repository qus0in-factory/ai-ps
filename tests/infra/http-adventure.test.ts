import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpAdventure } from '../../src/infra/http-adventure.ts';
import { createAdventureLogger } from '../../src/infra/adventure-logger.ts';
import { createSession } from '../../src/domain/adventure/session.ts';

describe('Given the adventure HTTP adapter', () => {
  it('When receiving events and result Then validates frames and composes caller cancellation', async () => {
    const controller = new AbortController(); const events: unknown[] = [];
    const client = createHttpAdventure(async (url, init) => {
      assert.equal(url, '/api/adventure/turn'); assert.notEqual(init!.signal, controller.signal);
      assert.equal(JSON.parse(String(init!.body)).action, '대기');
      return new Response(JSON.stringify({ type: 'event', event: { kind: 'accepted', action: '대기' } }) + '\n' + JSON.stringify({ type: 'result', value: createSession() }) + '\n');
    });
    assert.deepEqual(await client.turn(createSession(), '대기', e => events.push(e), controller.signal), { ok: true, value: createSession() });
    assert.equal(events.length, 1);
  });
  it('When frames are malformed, missing, cancelled, or a problem Then returns a safe failure', async () => {
    for (const body of ['', '{"type":"event","event":{"kind":"state"}}\n', '{"type":"result","value":{}}\n', '{"type":"problem","problem":{"detail":"모델 실패"}}\n']) {
      const result = await createHttpAdventure(async () => new Response(body)).start();
      assert.equal(result.ok, false);
    }
    const controller = new AbortController(); controller.abort();
    assert.equal((await createHttpAdventure(async () => { throw new Error('private URL'); }).start(undefined, controller.signal)).ok, false);
  });
});
describe('Given adventure structured logging', () => {
  it('When invalid turns occur Then uses warning severity without narrative text', () => {
    const calls: unknown[] = [];
    const logger = createAdventureLogger({ info: (...args: unknown[]) => calls.push(['info',...args]), warn: (...args: unknown[]) => calls.push(['warn',...args]), error: (...args: unknown[]) => calls.push(['error',...args]) });
    logger({ event: 'invalid', turn: 1 }); logger({ event: 'turn_complete', turn: 2, narrativeLength: 20 });
    assert.equal((calls[0] as unknown[])[0], 'warn'); assert.ok(JSON.stringify(calls).includes('narrativeLength'));
  });
});
