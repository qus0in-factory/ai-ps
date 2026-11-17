import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, isTalkSession, normalizeSession, canAddTurn, LIMITS } from '../../../src/domain/talk/session.ts';
import { parseTutorReply, FALLBACK_REPLY } from '../../../src/domain/talk/reply.ts';
import { buildTutorMessages, buildReportMessages } from '../../../src/domain/talk/prompt.ts';
const tutor = { mood: 'neutral' as const, reply: '今日は何をしましたか？', correction: null, betterExpression: null };

describe('Given client-carried talk sessions', () => {
  it('When validating Then rejects extra/deep fields, wrong types, oversized values and excess turns', () => {
    assert.equal(isTalkSession(createSession()), true);
    const full = { version: 1 as const, tutor: 'f' as const, turns: Array.from({ length: 40 }, () => ({ learner: 'Hello', tutor })) };
    assert.equal(isTalkSession(full), true); assert.equal(canAddTurn(full, 'Hello'), false);
    for (const bad of [null, { ...full, extra: {} }, { ...full, turns: [...full.turns, full.turns[0]] },
      { version: 1, tutor: 'f', turns: [{ learner: 'x'.repeat(501), tutor }] },
      { version: 1, tutor: 'f', turns: [{ learner: 'Hi', tutor: { ...tutor, reply: 'x'.repeat(601) } }] },
      { version: 1, tutor: 'f', turns: [{ learner: 'Hi', tutor: { ...tutor, correction: [] } }] },
      { version: 1, tutor: 'f', turns: [{ learner: 'Hi', tutor: { ...tutor, extra: { secret: 'x' } } }] },
      { version: 1, tutor: 'f', turns: [{ learner: 'Hi', tutor }, { learner: '', tutor }] },
    ]) assert.equal(isTalkSession(bad), false);
    const copy = normalizeSession(full)!; assert.deepEqual(copy, full); assert.notEqual(copy.turns[0]!.tutor, full.turns[0]!.tutor);
  });
  it('When escaped records approach the HTTP budget Then leaves room for the next full reply and report', () => {
    const long = { version: 1 as const, tutor: 'f' as const, turns: Array.from({ length: 12 }, () => ({ learner: '가'.repeat(500), tutor: { ...tutor, reply: '나'.repeat(600), correction: '다'.repeat(300), betterExpression: '라'.repeat(300) } })) };
    assert.equal(isTalkSession(long), true);
    assert.equal(canAddTurn(long, 'hello'), false);
    assert.ok(new TextEncoder().encode(JSON.stringify({ session: long })).length < LIMITS.bodyBytes);
  });
});

describe('Given a tutor JSON reply', () => {
  it('When parsing malformed or missing replies Then uses a safe reply with no invented correction', () => {
    assert.equal(FALLBACK_REPLY, 'もう一度言ってもらえますか？');
    for (const content of ['private raw output', '{}', '{"reply":" ","correction":"wrong"}', '{"reply":42}']) {
      assert.deepEqual(parseTutorReply(content), { mood: 'neutral' as const, reply: FALLBACK_REPLY, correction: null, betterExpression: null });
    }
  });
  it('When parsing fenced or long replies Then bounds every field and normalizes nullable suggestions', () => {
    assert.deepEqual(parseTutorReply('```json\n' + JSON.stringify(tutor) + '\n```'), tutor);
    const parsed = parseTutorReply(JSON.stringify({ mood: 'neutral' as const, reply: 'a'.repeat(700), correction: '한'.repeat(400), betterExpression: 42 }));
    assert.equal(parsed.reply.length, 600); assert.equal(parsed.correction!.length, 300); assert.equal(parsed.betterExpression, null);
  });
});

describe('Given Korean correction explanations', () => {
  it('When a model explains only in Japanese Then withholds that correction instead of presenting it as Korean feedback', () => {
    const reply = parseTutorReply(JSON.stringify({ mood: 'neutral' as const, reply: '公園で何をしましたか？', correction: '昨日のことなので過去形です。', betterExpression: '昨日、公園に行きました。' }));
    assert.equal(reply.correction, null); assert.equal(reply.betterExpression, '昨日、公園に行きました。');
    assert.equal(parseTutorReply('{"reply":"そうですか。","correction":"어제 일이므로 과거형을 써요."}').correction, '어제 일이므로 과거형을 써요.');
  });
});

describe('Given conversation prompts', () => {
  it('When greeting or continuing Then preserves pairs and treats learner records as data', () => {
    const session = createSession();
    assert.equal(buildTutorMessages(session)[0]!.role, 'system');
    assert.match(buildTutorMessages(session)[0]!.content, /Japanese/);
    assert.match(buildTutorMessages(session)[0]!.content, /N5.*N4/);
    session.turns.push({ learner: '', tutor }, { learner: '昨日、公園に行きます。', tutor: { ...tutor, correction: '과거형 行きました를 써요。' } });
    const messages = buildTutorMessages(session, '友達に会いました。');
    assert.deepEqual(messages.map(m => m.role), ['system','user','assistant','user','assistant','user']);
    assert.equal(messages.at(-1)!.content, '友達に会いました。');
    assert.ok(messages[4]!.content.includes('correction'));
    assert.match(messages[0]!.content, /지시.*데이터|data.*instructions/i);
  });
  it('When reporting Then excludes the greeting and includes corrections without system/start prompts', () => {
    const messages = buildReportMessages({ version: 1, tutor: 'f', turns: [{ learner: '', tutor: { ...tutor, reply: 'GREETING_MARKER' } }, { learner: '昨日、公園に行きます。', tutor: { ...tutor, correction: '行きました' } }] });
    assert.ok(!JSON.stringify(messages).includes('GREETING_MARKER'));
    assert.ok(JSON.stringify(messages).includes('行きました'));
    assert.ok(JSON.stringify(messages).includes('昨日、公園に行きます。'));
  });
});
