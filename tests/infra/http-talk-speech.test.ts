import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTalk } from '../../src/infra/http-talk.ts';
const wav = new Uint8Array(46); wav.set(new TextEncoder().encode('RIFF')); wav.set(new TextEncoder().encode('WAVE'),8);
describe('Given speech fetched through the Talk BFF', () => {
  it('When clicking a short sentence Then posts only text and returns a WAV Blob', async () => {
    let calls = 0;
    const client = createHttpTalk(async (path, init) => {
      calls++; assert.equal(path,'/api/talk/speech'); assert.deepEqual(JSON.parse(String(init?.body)),{text:'こんにちは。'});
      assert.equal(new Headers(init?.headers).has('Authorization'),false);
      return new Response(wav,{headers:{'Content-Type':'audio/wav','X-Talk-Cache':'hit'}});
    });
    const result = await client.speak('こんにちは。'); assert.equal(result.ok,true);
    if(result.ok){assert.ok(result.value instanceof Blob);assert.equal(result.value.type,'audio/wav');assert.equal(result.value.size,46)}
    assert.equal(calls,1);
  });
  it('When text exceeds 400 characters Then never requests speech; Unicode characters count once', async () => {
    let calls=0;const client=createHttpTalk(async()=>{calls++;return new Response(wav,{headers:{'Content-Type':'audio/wav'}})});
    for(const text of ['', ' ', 'あ'.repeat(401)])assert.equal((await client.speak(text)).ok,false);
    assert.equal(calls,0);assert.equal((await client.speak('😀'.repeat(400))).ok,true);
  });
  it('When a problem, invalid audio or cancellation arrives Then returns a safe failure without retry', async () => {
    const failed=await createHttpTalk(async()=>Response.json({detail:'音声を作れません。'},{status:502})).speak('こんにちは。');assert.equal(failed.ok,false);
    for(const response of [new Response('private raw'),new Response('',{headers:{'Content-Type':'audio/wav'}}),new Response(new Uint8Array(2*1024*1024+1),{headers:{'Content-Type':'audio/wav'}})])assert.equal((await createHttpTalk(async()=>response).speak('こんにちは。')).ok,false);
    const caller=new AbortController();const pending=createHttpTalk(async()=>{caller.abort();return await new Promise(()=>{})}).speak('こんにちは。',caller.signal);assert.equal((await pending).ok,false);
  });
});
