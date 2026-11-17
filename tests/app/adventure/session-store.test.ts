import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginStart, beginTurn, commit, fail, initialState, reduceEvent, reset, restoreSession, restoredLog,
  type AdventureView,
} from '../../../src/app/adventure/session-store.ts';
import type { AdventureSession, GameState } from '../../../src/domain/adventure/types.ts';

const state: GameState = {
  day: 1, time: 'dawn', weather: 'storm', location: 'quarters',
  stats: { health: 90, warmth: 55, focus: 70 },
  inventory: ['lantern-handheld', 'matches'],
  repairs: { lens: false, clockwork: false, oil: false },
};
const session: AdventureSession = { version: 1, state, recent: [], turn: 0 };
const moved: GameState = { ...state, location: 'boathouse' };

const applied = {
  stats: { health: 0, warmth: -6, focus: -4 },
  added: [], removed: [], repaired: [], slept: false,
};

describe('Given an adventure view waiting for a turn', () => {
  it('When the turn begins Then the phase is turn and previous stream is cleared', () => {
    const view = beginTurn({ ...initialState(), session, streaming: { action: 'old', text: 'x', dice: [] } });
    assert.equal(view.phase, 'turn');
    assert.equal(view.error, '');
    assert.equal(view.streaming, undefined);
  });
});

describe('Given an accepted action', () => {
  it('When the event arrives Then the action starts a new stream', () => {
    const view = reduceEvent(initialState(), { kind: 'accepted', action: '창고를 뒤진다' });
    assert.equal(view.streaming?.action, '창고를 뒤진다');
    assert.deepEqual(view.streaming?.dice, []);
    assert.equal(view.streaming?.text, '');
  });
});

describe('Given a turn with dice, a narrative and a new state', () => {
  it('When the state event arrives Then only the preview changes and the session is untouched', () => {
    let view: AdventureView = beginTurn({ ...initialState(), session });
    view = reduceEvent(view, { kind: 'accepted', action: '창고를 뒤진다' });
    view = reduceEvent(view, { kind: 'dice', sides: 20, difficulty: 12, roll: 14, success: true });
    view = reduceEvent(view, { kind: 'narrative', text: '첫 문장. 두 번째 문장.' });
    view = reduceEvent(view, { kind: 'state', state: moved, applied });

    assert.equal(view.session, session, '낙관적 갱신 금지: 세션은 result 에서만 교체한다');
    assert.deepEqual(view.preview, moved);
    assert.equal(view.log.length, 1);
    assert.equal(view.log[0]!.action, '창고를 뒤진다');
    assert.equal(view.log[0]!.narrative, '첫 문장. 두 번째 문장.');
    assert.deepEqual(view.log[0]!.dice, [{ sides: 20, difficulty: 12, roll: 14, success: true }]);
    assert.deepEqual(view.log[0]!.applied, applied);
    assert.equal(view.streaming, undefined);
    assert.equal(view.phase, 'turn', 'result 를 받을 때까지는 요청이 진행 중이다');
  });

  it('When the request fails after the state event Then the session and preview are unchanged', () => {
    const previewed = reduceEvent(beginTurn({ ...initialState(), session }), { kind: 'state', state: moved, applied });
    const failed = fail(previewed, 'network');
    assert.equal(failed.session, session);
    assert.equal(failed.preview, undefined);
    assert.equal(failed.error, 'network');
  });

  it('When the result arrives Then commit replaces the session and drops the preview', () => {
    const previewed = reduceEvent({ ...initialState(), session }, { kind: 'state', state: moved, applied });
    const committed = commit(previewed, { ...session, state: moved, turn: 1 });
    assert.equal(committed.session?.state.location, 'boathouse');
    assert.equal(committed.session?.turn, 1);
    assert.equal(committed.preview, undefined);
  });
});

describe('Given an invalid turn', () => {
  it('When the event arrives Then the session is unchanged and the log marks the turn', () => {
    const view = reduceEvent(beginTurn({ ...initialState(), session }), { kind: 'invalid', reason: 'bad json' });
    assert.equal(view.session, session);
    assert.equal(view.error, '', '요청 오류 배너와 무효 턴은 로그로 구분한다');
    assert.equal(view.log.length, 1);
    assert.equal(view.log[0]!.invalid, true);
    assert.equal(view.phase, 'turn', '결과를 받을 때까지 입력을 잠근다');
  });
});

describe('Given a turn that ends the game', () => {
  it('When the ending event arrives Then the phase is ended but the session is not rewritten', () => {
    const view = reduceEvent({ ...initialState(), session }, { kind: 'ending', ending: 'cleared', day: 4 });
    assert.equal(view.phase, 'ended');
    assert.equal(view.ending, 'cleared');
    assert.equal(view.session, session);
    assert.equal(view.session?.state.ending, undefined);
  });
  it('When the request fails after the ending event Then the temporary ending is dropped', () => {
    const pending = reduceEvent({ ...initialState(), session, phase: 'turn' }, { kind: 'ending', ending: 'missed', day: 6 });
    const failed = fail(pending, 'broken stream');
    assert.equal(failed.ending, undefined, '결과 없는 엔딩은 화면에 남기지 않는다');
    assert.equal(failed.phase, 'idle');
    assert.equal(failed.session, session);
    assert.equal(failed.error, 'broken stream');
  });
  it('When a result without an ending arrives Then the temporary ending is not inherited', () => {
    const pending = reduceEvent({ ...initialState(), session, phase: 'turn' }, { kind: 'ending', ending: 'missed', day: 6 });
    const committed = commit(pending, { ...session, turn: 2 });
    assert.equal(committed.ending, undefined);
    assert.equal(committed.phase, 'idle');
  });
});

describe('Given a finished request', () => {
  it('When the session is committed Then it replaces the view and clears the stream', () => {
    const view = commit({ ...initialState(), error: 'x', streaming: { action: 'a', text: 'b', dice: [] } }, session);
    assert.equal(view.session, session);
    assert.equal(view.error, '');
    assert.equal(view.streaming, undefined);
    assert.equal(view.phase, 'idle');
  });
  it('When the committed session already ended Then the phase is ended', () => {
    const ended = commit(initialState(), { ...session, state: { ...state, ending: 'dead' } });
    assert.equal(ended.phase, 'ended');
    assert.equal(ended.ending, 'dead');
  });
  it('When the request fails Then the previous session stays for retry', () => {
    const view = fail({ ...initialState(), session }, 'timeout');
    assert.equal(view.session, session);
    assert.equal(view.error, 'timeout');
    assert.equal(view.phase, 'idle');
  });
});

describe('Given a starting and reset flow', () => {
  it('When starting Then the phase is starting', () => {
    assert.equal(beginStart({ ...initialState(), session }).phase, 'starting');
  });
  it('When the first scene arrives without a state event Then commit keeps it as an intro entry', () => {
    const streaming = reduceEvent({ ...initialState(), phase: 'starting' },
      { kind: 'narrative', text: '폭풍이 몰아친다.' });
    const view = commit(streaming, session);
    assert.equal(view.log.length, 1);
    assert.equal(view.log[0]!.action, '');
    assert.equal(view.log[0]!.narrative, '폭풍이 몰아친다.');
    assert.equal(view.streaming, undefined);
  });
  it('When reset Then the view is empty', () => {
    assert.deepEqual(reset(), initialState());
  });
});

describe('Given a single narrative event', () => {
  it('When it arrives Then the stream shows the whole text without fragment joining', () => {
    const view = reduceEvent(beginTurn({ ...initialState(), session }), { kind: 'narrative', text: '폭풍이 몰아친다.' });
    assert.equal(view.streaming?.text, '폭풍이 몰아친다.');
    assert.equal(view.streaming?.dice.length, 0);
  });
});

describe('Given a restored session with recent turns', () => {
  it('When the log is rebuilt Then each recent turn becomes an entry without dice', () => {
    const withRecent = { ...session, recent: [{ action: '창고를 뒤진다', narrative: '문이 삐걱였다.' }] };
    assert.deepEqual(restoredLog(withRecent), [{ action: '창고를 뒤진다', narrative: '문이 삐걱였다.', dice: [] }]);
    assert.deepEqual(restoredLog(session), []);
  });
});

describe('Given a persisted session read from storage', () => {
  it('When the value is a valid session Then it is restored', () => {
    assert.deepEqual(restoreSession(session), session);
  });
  it('When the value is corrupted Then null is returned instead of throwing', () => {
    assert.equal(restoreSession({ version: 1, state: {}, recent: [], turn: 0 }), null);
    assert.equal(restoreSession(null), null);
    assert.equal(restoreSession('nope'), null);
  });
});
