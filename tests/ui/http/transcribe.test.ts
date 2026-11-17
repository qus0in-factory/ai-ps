import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../../src/ui/http/api.ts';
const deps = { reply: async () => ({ ok: true as const, value: 'unused' }), queens: { generate: async () => ({ ok: false as const, reason: 'unused' }) }, adventure: { start: async () => ({ ok: false as const, reason: 'unused' }), turn: async () => ({ ok: false as const, reason: 'unused' }) } };
const tutor = { respond: async () => ({ ok: false as const, reason: 'unused' }), report: async () => ({ ok: false as const, reason: 'unused' }) };
const path = '/api/talk/transcribe';
function upload(size = 10, type = 'audio/wav') {
  const form = new FormData(); form.append('audio', new Blob([new Uint8Array(size)], { type }), 'speech.wav'); return form;
}
describe('Given POST /api/talk/transcribe', () => {
  it('When one valid file is uploaded Then forwards the file and cancellation signal and returns uncached text JSON', async () => {
    const api = createApi({ ...deps, talk: { tutor, transcriber: { transcribe: async (audio, signal) => {
      assert.equal(audio.size, 10); assert.equal(audio.type, 'audio/wav'); assert.ok(signal);
      return { ok: true, value: 'こんにちは。' };
    } } } });
    const response = await api.request(path, { method: 'POST', body: upload() });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: 'こんにちは。' });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });
  it('When malformed, duplicate, empty, unsupported or oversized Then returns RFC 9457 without calling STT', async () => {
    let calls = 0;
    const api = createApi({ ...deps, talk: { tutor, transcriber: { transcribe: async () => { calls++; return { ok: true, value: '' }; } } } });
    const duplicate = upload(); duplicate.append('audio', new Blob(['x']), 'other.wav');
    const string = new FormData(); string.append('audio', 'not a file');
    const extra = upload(); extra.append('other', 'x');
    const cases: [RequestInit, number][] = [[{ method: 'GET' }, 405], [{ method: 'POST', body: '{}' }, 400],
      [{ method: 'POST', body: 'broken', headers: { 'Content-Type': 'multipart/form-data; boundary=x' } }, 400],
      ...[new FormData(), duplicate, string, extra, upload(0)].map(body => [{ method: 'POST', body }, 400] as [RequestInit, number]),
      [{ method: 'POST', body: upload(1, 'text/plain') }, 415],
      [{ method: 'POST', body: upload(2 * 1024 * 1024 + 1) }, 413],
      [{ method: 'POST', body: 'x'.repeat(2_500_001) }, 413]];
    for (const [request, status] of cases) {
      const response = await api.request(path, request); assert.equal(response.status, status);
      assert.match(response.headers.get('Content-Type')!, /application\/problem\+json/);
      const problem = await response.json(); assert.equal(problem.status, status); assert.equal(problem.instance, path);
      if (status === 415) assert.equal(problem.title, 'Unsupported Media Type');
    }
    assert.equal(calls, 0);
  });
  it('When STT fails Then returns a generic 502 without raw adapter diagnostics', async () => {
    const api = createApi({ ...deps, talk: { tutor, transcriber: { transcribe: async () => ({ ok: false, reason: 'sk-secret transcript' }) } } });
    const response = await api.request(path, { method: 'POST', body: upload() });
    assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /sk-secret|transcript/);
  });
});
