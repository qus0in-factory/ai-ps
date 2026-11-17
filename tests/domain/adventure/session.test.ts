import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, isAdventureSession, normalizeSession } from '../../../src/domain/adventure/session.ts';

describe('Given optional carried summaries and recent history limits', () => {
  it('When summary is provided Then accepts 600 characters and rejects empty, oversized, or non-string data', () => {
    for (const summary of ['요'.repeat(600), undefined]) assert.equal(isAdventureSession({ ...createSession(), ...(summary === undefined ? {} : { summary }) }), true);
    for (const summary of ['요'.repeat(601), '', '  ', 42, {}]) assert.equal(isAdventureSession({ ...createSession(), summary }), false);
  });
  it('When validating history Then accepts eight pairs and rejects nine', () => {
    const recent = Array.from({ length: 8 }, () => ({ action: '대기', narrative: '당신은 기다립니다.' }));
    assert.equal(isAdventureSession({ ...createSession(), recent }), true);
    assert.equal(isAdventureSession({ ...createSession(), recent: [...recent, recent[0]] }), false);
  });
  it('When normalizing Then copies the optional summary and preserves the old session shape when absent', () => {
    const session = { ...createSession(), summary: '당신은 숙소에서 쉽니다.' };
    const normalized = normalizeSession(session)!;
    assert.equal(normalized.summary, session.summary); assert.notEqual(normalized.state, session.state);
    assert.ok(!Object.hasOwn(normalizeSession(createSession())!, 'summary'));
    assert.ok(!Object.hasOwn(createSession(), 'summary'));
  });
});


describe('Given control characters in session strings', () => {
  it('When summary or recent text contains disallowed C0 controls Then rejects before normalization', () => {
    for (let code = 0; code <= 31; code++) {
      if ([9,10,13].includes(code)) continue;
      const value = '기록' + String.fromCharCode(code) + '내용';
      const sessions = [
        { ...createSession(), summary: value },
        { ...createSession(), recent: [{ action: value, narrative: '서술' }] },
        { ...createSession(), recent: [{ action: '행동', narrative: value }] },
      ];
      for (const session of sessions) { assert.equal(isAdventureSession(session), false); assert.equal(normalizeSession(session), undefined); }
    }
  });
  it('When text contains ordinary newlines and tabs Then preserves it', () => {
    const value = '첫 줄\n\t다음 줄\r\n마지막 줄';
    const session = { ...createSession(), summary: value, recent: [{ action: value, narrative: value }] };
    assert.equal(isAdventureSession(session), true); assert.deepEqual(normalizeSession(session), session);
  });
});
