import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAdventureStore } from '../../../src/ui/state/adventure-store.ts';
import type { AdventureSession, GameState } from '../../../src/domain/adventure/types.ts';

const state: GameState = {
  day: 2, time: 'day', weather: 'fog', location: 'shore',
  stats: { health: 70, warmth: 40, focus: 55 },
  inventory: ['matches'], repairs: { lens: false, clockwork: false, oil: false },
};
const session: AdventureSession = { version: 1, state, recent: [], turn: 3 };

function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    data,
  };
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
function useStorage(seed: Record<string, string>) {
  const storage = fakeStorage(seed);
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage as unknown as Storage, configurable: true, writable: true,
  });
  return storage;
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('Given a persisted adventure session', () => {
  it('When the stored session is valid Then it is restored on creation', () => {
    useStorage({ 'test.valid': JSON.stringify({ state: { session }, version: 1 }) });
    const store = createAdventureStore('test.valid');
    assert.deepEqual(store.getState().session, session);
  });
  it('When the stored session is corrupted Then it is dropped instead of breaking the page', () => {
    useStorage({ 'test.corrupt': JSON.stringify({ state: { session: { version: 1, state: {} } }, version: 1 }) });
    const store = createAdventureStore('test.corrupt');
    assert.equal(store.getState().session, null);
  });
  it('When the stored session has recent turns Then the log shows them as 지난 이야기', () => {
    const withRecent = { ...session, recent: [{ action: '창고를 뒤진다', narrative: '문이 삐걱였다.' }] };
    useStorage({ 'test.recent': JSON.stringify({ state: { session: withRecent }, version: 1 }) });
    const store = createAdventureStore('test.recent');
    assert.equal(store.getState().restored, true);
    assert.deepEqual(store.getState().log, [{ action: '창고를 뒤진다', narrative: '문이 삐걱였다.', dice: [] }]);
  });
  it('When the restored session has no recent turns Then the log is empty and no 지난 이야기 is shown', () => {
    useStorage({ 'test.norecent': JSON.stringify({ state: { session }, version: 1 }) });
    const store = createAdventureStore('test.norecent');
    assert.equal(store.getState().restored, false);
    assert.deepEqual(store.getState().log, []);
  });
  it('When a new turn begins after restore Then the 지난 이야기 marker is cleared but the log stays', () => {
    const withRecent = { ...session, recent: [{ action: '바다를 본다', narrative: '파도가 높다.' }] };
    useStorage({ 'test.clearmarker': JSON.stringify({ state: { session: withRecent }, version: 1 }) });
    const store = createAdventureStore('test.clearmarker');
    store.getState().beginTurn();
    assert.equal(store.getState().restored, false);
    assert.equal(store.getState().log.length, 1);
  });
  it('When storage is empty Then the store starts empty', () => {
    useStorage({});
    const store = createAdventureStore('test.empty');
    assert.equal(store.getState().session, null);
    assert.equal(store.getState().phase, 'idle');
  });
});

describe('Given an adventure store wired to the reducer', () => {
  it('When a state event arrives Then the preview changes but the session does not', () => {
    useStorage({});
    const store = createAdventureStore('test.reducer');
    store.getState().commit(session);
    store.getState().beginTurn();
    store.getState().applyEvent({ kind: 'accepted', action: '해안을 걷는다' });
    store.getState().applyEvent({
      kind: 'state',
      state: { ...state, location: 'boathouse' },
      applied: { stats: { health: 0, warmth: -6, focus: -4 }, added: [], removed: [], repaired: [], slept: false },
    });
    assert.equal(store.getState().session, session);
    assert.equal(store.getState().preview?.location, 'boathouse');
    assert.equal(store.getState().log.length, 1);
  });
  it('When the result is committed Then the session is replaced and the preview cleared', () => {
    useStorage({});
    const store = createAdventureStore('test.commit');
    const next = { ...session, turn: 4 };
    store.getState().commit(next);
    assert.equal(store.getState().session?.turn, 4);
    assert.equal(store.getState().preview, undefined);
  });
  it('When an ending event arrives and the request fails Then the temporary ending is cleared', () => {
    useStorage({});
    const store = createAdventureStore('test.endingfail');
    store.getState().commit(session);
    store.getState().beginTurn();
    store.getState().applyEvent({ kind: 'ending', ending: 'missed', day: 6 });
    assert.equal(store.getState().phase, 'ended');
    store.getState().fail('연결 종료');
    assert.equal(store.getState().ending, undefined);
    assert.equal(store.getState().phase, 'idle');
    assert.equal(store.getState().session, session);
  });
});
