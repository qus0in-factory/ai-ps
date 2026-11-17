import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../../src/ui/http/api.ts';
import { createTutor } from '../../../src/app/talk/tutor.ts';
import { createSession } from '../../../src/domain/talk/session.ts';
const reply = { reply: '元気ですか？', correction: null, betterExpression: null };
const deps = { reply: async () => ({ ok: true as const, value: 'unused' }), queens: { generate: async () => ({ ok: false as const, reason: 'unused' }) }, adventure: { start: async () => ({ ok: false as const, reason: 'unused' }), turn: async () => ({ ok: false as const, reason: 'unused' }) } };

describe('Given the Talk JSON endpoints', () => {
  it('When greeting, talking and reporting Then returns only the contract JSON and no audio routes', async () => {
    let calls = 0;
    const api = createApi({ ...deps, talk: { tutor: createTutor({ complete: async (_messages, options) => {
      calls++; return { ok: true, value: { role: 'assistant', content: options?.response_format ? JSON.stringify(reply) : '잘한 표현: 인사' } };
    } }) } });
    const post = (path: string, body: unknown) => api.request('/api/talk/' + path, { method: 'POST', body: JSON.stringify(body) });
    const session = createSession();
    const greeting = await post('turn', { session }); assert.equal(greeting.status, 200); assert.deepEqual(await greeting.json(), reply);
    assert.match(greeting.headers.get('Content-Type')!, /application\/json/); assert.equal(greeting.headers.get('Cache-Control'), 'no-store');
    session.turns.push({ learner: '', tutor: reply });
    assert.equal((await post('turn', { session, text: 'Hi' })).status, 200);
    const report = await post('report', { session }); assert.deepEqual(await report.json(), { report: '잘한 표현: 인사' });
    assert.equal(calls, 3);
    for (const route of ['speech','transcribe']) assert.equal((await post(route, {})).status, 404);
  });
  it('When malformed, deep, over-limit or wrong-method requests arrive Then returns RFC 9457 before model calls', async () => {
    let calls = 0;
    const api = createApi({ ...deps, talk: { tutor: createTutor({ complete: async () => { calls++; throw Error('must not call'); } }) } });
    const base = JSON.stringify(createSession());
    const requests: [string, RequestInit, number][] = [
      ['turn', { method: 'GET' }, 405], ['report', { method: 'GET' }, 405],
      ['turn', { method: 'POST', body: '{' }, 400],
      ['turn', { method: 'POST', body: JSON.stringify({ session: createSession(), text: ' '.repeat(10) }) }, 400],
      ['turn', { method: 'POST', body: JSON.stringify({ session: createSession(), text: 'x'.repeat(501) }) }, 400],
      ['turn', { method: 'POST', body: '{"session":' + base.slice(0,-1) + ',"extra":' + '['.repeat(10000) + '0' + ']'.repeat(10000) + '}}' }, 400],
      ['turn', { method: 'POST', body: 'x'.repeat(64001) }, 413],
      ['report', { method: 'POST', body: JSON.stringify({ session: createSession() }) }, 400],
    ];
    for (const [path, request, status] of requests) {
      const response = await api.request('/api/talk/' + path, request); assert.equal(response.status, status);
      assert.match(response.headers.get('Content-Type')!, /application\/problem\+json/);
      const body = await response.json(); assert.equal(body.status, status); assert.equal(body.instance, '/api/talk/' + path);
      assert.equal(body.type, 'about:blank'); if (status === 405) assert.equal(response.headers.get('Allow'), 'POST');
    }
    assert.equal(calls, 0);
  });
  it('When the provider fails or the request aborts Then returns a safe terminal 502', async () => {
    const controller = new AbortController();
    const api = createApi({ ...deps, talk: { tutor: createTutor({ complete: async () => { controller.abort(); return { ok: false, reason: 'SECRET_KEY raw prompt' }; } }) } });
    const response = await api.request('/api/talk/turn', { method: 'POST', body: JSON.stringify({ session: createSession() }), signal: controller.signal });
    assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('SECRET_KEY'));
  });
});
