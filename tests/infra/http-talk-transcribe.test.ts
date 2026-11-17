import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTalk } from '../../src/infra/http-talk.ts';
describe('Given browser transcription through the BFF', () => {
  it('When uploading Then sends one named audio file without a manually set multipart boundary or API key', async () => {
    const client = createHttpTalk(async (path, init) => {
      assert.equal(path, '/api/talk/transcribe'); assert.equal(init?.method, 'POST'); assert.ok(init?.body instanceof FormData);
      assert.deepEqual([...init.body.keys()], ['audio']); const file = init.body.get('audio') as File;
      assert.equal(file.name, 'speech.m4a'); assert.equal(file.type, 'audio/mp4');
      const headers = new Headers(init.headers); assert.equal(headers.has('Content-Type'), false); assert.equal(headers.has('Authorization'), false);
      return Response.json({ text: '今日は散歩しました。' });
    });
    assert.deepEqual(await client.transcribe(new Blob(['audio'], { type: 'audio/mp4' })), { ok: true, value: '今日は散歩しました。' });
  });
  it('When response is empty, malformed, failed or cancelled Then handles the contract without retrying', async () => {
    const audio = new Blob(['audio'], { type: 'audio/wav' });
    assert.deepEqual(await createHttpTalk(async () => Response.json({ text: '' })).transcribe(audio), { ok: true, value: '' });
    for (const result of [{ text: 7 }, { text: 'x'.repeat(5001) }, { text: 'hi', secret: 'x' }]) assert.equal((await createHttpTalk(async () => Response.json(result)).transcribe(audio)).ok, false);
    const caller = new AbortController();
    const pending = createHttpTalk(async () => { caller.abort(); return await new Promise(() => {}); }).transcribe(audio, caller.signal);
    assert.equal((await pending).ok, false);
    let calls = 0; const client = createHttpTalk(async () => { calls++; throw Error('must not call'); });
    for (const blob of [new Blob([]), new Blob(['x'], { type: 'text/plain' }), new Blob([new Uint8Array(2*1024*1024+1)], { type: 'audio/wav' })]) assert.equal((await client.transcribe(blob)).ok, false);
    assert.equal(calls, 0);
  });
});
