import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpAdventure } from '../../../src/infra/http-adventure.ts';
import { createAdventureStore } from '../../../src/ui/state/adventure-store.ts';
import type { AdventureSession, GameState } from '../../../src/domain/adventure/types.ts';

const state: GameState = {
  day: 2, time: 'dusk', weather: 'storm', location: 'quarters',
  stats: { health: 90, warmth: 55, focus: 70 },
  inventory: ['lantern-handheld', 'matches'],
  repairs: { lens: false, clockwork: false, oil: false },
};
const original: AdventureSession = { version: 1, state, recent: [], turn: 4 };
const applied = {
  stats: { health: -5, warmth: -12, focus: -4 },
  added: ['spare-lens'], removed: [], repaired: [], slept: false,
};

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
function memoryStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
    } as unknown as Storage,
    configurable: true,
    writable: true,
  });
  return data;
}
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('Given a stream that ends without the result frame (astra B2)', () => {
  it('When the connection closes after a state event Then the session and stored session stay as before', async () => {
    const data = memoryStorage();
    const frames = [
      { type: 'event', event: { kind: 'accepted', action: '창고를 뒤진다' } },
      {
        type: 'event',
        event: { kind: 'state', state: { ...state, stats: { health: 85, warmth: 43, focus: 66 }, inventory: [...state.inventory, 'spare-lens'] }, applied },
      },
      // result 프레임을 일부러 뺀다: 연결이 여기서 끝난 상황
    ].map((frame) => JSON.stringify(frame)).join('\n') + '\n';
    const client = createHttpAdventure(async () => new Response(frames, {
      status: 200, headers: { 'Content-Type': 'application/x-ndjson' },
    }));

    const store = createAdventureStore('adventure.stream.loss');
    store.getState().commit(original);
    store.getState().beginTurn();
    const result = await client.turn(original, '창고를 뒤진다', (event) => store.getState().applyEvent(event));

    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.reason, /연결이 종료/);
    store.getState().fail(result.ok ? '' : result.reason);

    // state 이벤트는 preview 로만 남고 세션(turn·recent·journal)은 바뀌지 않는다.
    assert.deepEqual(store.getState().session, original);
    assert.equal(store.getState().session?.turn, 4);
    assert.deepEqual(store.getState().session?.recent, []);
    assert.equal(store.getState().preview, undefined);
    assert.equal(store.getState().log.length, 1);
    assert.equal(store.getState().log[0]!.applied?.added[0], 'spare-lens');

    // persist 도 이전 세션을 그대로 쓴다(다음 턴이 어긋난 세션으로 시작하지 않는다).
    const saved = JSON.parse(data.get('adventure.stream.loss')!) as { state: { session: AdventureSession } };
    assert.deepEqual(saved.state.session, original);
  });
});
