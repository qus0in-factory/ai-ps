import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../../src/ui/http/api.ts';
import { createCachedSpeaker } from '../../../src/app/talk/cached-speaker.ts';
import { createMemoryAudioCache } from '../../../src/infra/memory-audio-cache.ts';
import type { CachedSpeaker } from '../../../src/domain/talk/speech-cache.ts';
const unused = async (): Promise<never> => { throw Error('must not call'); };
const deps = { reply: unused, queens: { generate: unused }, adventure: { start: unused, turn: unused } };
const tutor = { respond: unused, report: unused };
const path = '/api/talk/speech';
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

describe('Given POST /api/talk/speech', () => {
  it('When the same text is requested twice Then returns WAV with miss/hit headers and metadata-only speech logs', async () => {
    let calls = 0;
    const logs: unknown[] = [];
    const speaker = createCachedSpeaker({ speak: async (text, signal) => {
      calls++; assert.equal(text, 'こんにちは。'); assert.ok(signal);
      return { ok: true, value: { bytes: new Uint8Array([82, 73, 70, 70]), mimeType: 'audio/wav' } };
    } }, createMemoryAudioCache(), { model: 'test', voice: 'coral', promptVersion: 'v1', warn: unused });
    const api = createApi({ ...deps, talk: { tutor, speaker, log: entry => logs.push(entry) } });
    for (const cache of ['miss', 'hit']) {
      const response = await api.request(path, post({ text: 'こんにちは。' }));
      assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'audio/wav');
      assert.equal(response.headers.get('X-Talk-Cache'), cache);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [82, 73, 70, 70]);
    }
    assert.equal(calls, 1); assert.equal(logs.length, 2);
    for (const [i, entry] of logs.entries()) {
      const log = entry as Record<string, unknown>;
      assert.deepEqual(Object.keys(log).sort(), ['event', 'ok', 'ms', 'cache', 'inputChars', 'outputBytes'].sort());
      assert.equal(log.event, 'speech'); assert.equal(log.ok, true); assert.equal(log.inputChars, 6);
      assert.equal(log.outputBytes, 4); assert.equal(log.cache, i ? 'hit' : 'miss'); assert.equal(typeof log.ms, 'number');
    }
    assert.doesNotMatch(JSON.stringify(logs), /こんにちは/);
  });
  it('When JSON is invalid, the input is outside 1..200 characters or the body is too large Then rejects before speaking', async () => {
    let calls = 0;
    const speaker: CachedSpeaker = { speak: async () => { calls++; throw Error('must not call'); } };
    const api = createApi({ ...deps, talk: { tutor, speaker } });
    const cases: [RequestInit, number][] = [
      [{ method: 'GET' }, 405], [{ method: 'POST', body: '{' }, 400],
      ...[null, [], {}, { text: 1 }, { text: '' }, { text: '　 ' }, { text: 'x'.repeat(201) }, { text: 'x', extra: true }].map(body => [post(body), 400] as [RequestInit, number]),
      [{ method: 'POST', body: 'x'.repeat(4001) }, 413],
    ];
    for (const [request, status] of cases) {
      const response = await api.request(path, request); assert.equal(response.status, status);
      assert.match(response.headers.get('Content-Type')!, /application\/problem\+json/);
      const problem = await response.json(); assert.equal(problem.instance, path); assert.equal(problem.status, status);
    }
    assert.equal(calls, 0);
  });
  it('When 200 Unicode characters are submitted Then accepts the maximum', async () => {
    const speaker: CachedSpeaker = { speak: async text => {
      assert.equal([...text].length, 200); return { ok: true, value: { bytes: new Uint8Array([1, 2]), mimeType: 'audio/wav', cache: 'miss' } };
    } };
    const response = await createApi({ ...deps, talk: { tutor, speaker } }).request(path, post({ text: 'あ'.repeat(200) }));
    assert.equal(response.status, 200);
  });
  it('When synthesis fails or throws Then returns safe 502 and failure metrics without diagnostics', async () => {
    for (const speak of [async () => ({ ok: false as const, reason: 'sk-secret raw speech' }), async (): Promise<never> => { throw Error('sk-secret raw speech'); }]) {
      const logs: unknown[] = [];
      const api = createApi({ ...deps, talk: { tutor, speaker: { speak }, log: entry => logs.push(entry) } });
      const response = await api.request(path, post({ text: 'こんにちは。' }));
      assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /sk-secret|raw speech/);
      assert.equal((logs[0] as Record<string, unknown>).ok, false);
      assert.doesNotMatch(JSON.stringify(logs), /sk-secret|raw speech|こんにちは/);
    }
  });
});
