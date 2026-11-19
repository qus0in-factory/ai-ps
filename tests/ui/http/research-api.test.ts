import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createResearchApi } from '../../../src/ui/http/research-api.ts';
const result = { report: '# 보고서', steps: [], sources: [], iterations: 1, capped: false };
const request = (body: string, path = '/api/research', headers: Record<string, string> = {}) => new Request('https://example.com' + path, { method: 'POST', headers, body });
describe('Given the protected research HTTP endpoint', () => {
  it('When posting a topic Then passes a signal and returns the contracted report with no-store', async () => {
    const logs: unknown[] = [];
    const api = createResearchApi({ run: async (topic, signal) => { assert.equal(topic, '도시 공원'); assert.ok(signal); return { ok: true, value: result }; }, log: entry => logs.push(entry) });
    const response = await api.fetch(request('{"topic":"도시 공원"}'));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), result);
    assert.deepEqual(Object.keys(logs[0] as object).sort(), ['iterations', 'ms', 'toolCalls', 'topicLength']);
    assert.doesNotMatch(JSON.stringify(logs), /도시|공원/);
  });
  it('When limited or limiter fails Then returns only safe error and never parses or runs', async () => {
    let runs = 0;
    for (const fail of [false, true]) {
      const keys: string[] = [];
      const api = createResearchApi({ run: async () => { runs++; return { ok: true, value: result }; }, limit: async key => { keys.push(key); return fail ? 'unavailable' : 'limited'; } });
      const response = await api.fetch(request('not-json', '/api/%72esearch', { 'CF-Connecting-IP': '192.0.2.1' }));
      assert.equal(response.status, fail ? 503 : 429);
      if (!fail) assert.equal(response.headers.get('Retry-After'), '60');
      const body = await response.json(); assert.deepEqual(Object.keys(body), ['error']); assert.doesNotMatch(JSON.stringify(body), /private-key/);
      assert.deepEqual(keys, ['192.0.2.1']);
    }
    assert.equal(runs, 0);
  });
  it('When the request exceeds the streaming or declared size limit Then rejects before the runner', async () => {
    let runs = 0;
    const api = createResearchApi({ run: async () => { runs++; return { ok: true, value: result }; } });
    for (const req of [request('x'.repeat(4097)), request('x'.repeat(4097), '/api/research', { 'content-length': '2' }), request('{}', '/api/research', { 'content-length': '4097' })]) {
      const response = await api.fetch(req); assert.equal(response.status, 413); assert.deepEqual(Object.keys(await response.json()), ['error']);
    }
    assert.equal(runs, 0);
  });
  it('When JSON, topic or method is invalid Then returns only the error contract', async () => {
    let runs = 0;
    const api = createResearchApi({ run: async () => { runs++; return { ok: true, value: result }; } });
    for (const body of ['invalid', '{}', 'null', '{"topic":123}', '{"topic":"   "}', JSON.stringify({ topic: 'a'.repeat(201) })]) {
      const response = await api.fetch(request(body)); assert.equal(response.status, 400); assert.deepEqual(Object.keys(await response.json()), ['error']);
    }
    const response = await api.fetch(new Request('https://example.com/api/research'));
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'POST'); assert.deepEqual(Object.keys(await response.json()), ['error']);
    assert.equal(runs, 0);
  });
  it('When cancelled before body parsing Then returns a safe error and cancels the input stream', async () => {
    let cancelled = false; let runs = 0;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const req = new Request('https://example.com/api/research', { method: 'POST', body, duplex: 'half', signal: AbortSignal.abort('private-topic') } as RequestInit);
    const response = await createResearchApi({ run: async () => { runs++; return { ok: true, value: result }; } }).fetch(req);
    assert.equal(response.status, 408); assert.deepEqual(Object.keys(await response.json()), ['error']);
    assert.equal(runs, 0); assert.equal(cancelled, true);
  });
  it('When the runner throws or returns a private reason Then hides details and tolerates logger failure', async () => {
    for (const run of [async () => { throw Error('secret-key topic-content stack'); }, async () => ({ ok: false as const, reason: 'secret-key topic-content stack' })]) {
      const response = await createResearchApi({ run, log: () => { throw Error('logger'); } }).fetch(request('{"topic":"hello"}'));
      assert.equal(response.status, 502); const body = await response.json(); assert.deepEqual(Object.keys(body), ['error']); assert.doesNotMatch(JSON.stringify(body), /secret-key|topic-content|stack/);
    }
  });
});
