import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAudioPlayer } from '../../src/infra/browser-audio.ts';
class FakeAudio extends EventTarget {
  pauses=0;cleared=false;failure=false;
  async play(){if(this.failure)throw Error('private browser error')}
  pause(){this.pauses++} removeAttribute(name:string){if(name==='src')this.cleared=true} load(){}
}
describe('Given browser audio playback',()=>{
  it('When replacing or stopping audio Then pauses the previous element and releases its source',async()=>{
    const elements:FakeAudio[]=[];
    const player=createBrowserAudioPlayer({createAudio:()=>{const a=new FakeAudio();elements.push(a);return a},createUrl:()=> 'blob:test',revokeUrl:()=>{}});
    let ended=0;assert.equal((await player.play('blob:first',()=>{ended++},()=>{})).ok,true);
    assert.equal((await player.play('blob:second',()=>{ended++},()=>{})).ok,true);
    assert.ok(elements[0]!.pauses);assert.equal(elements[0]!.cleared,true);
    elements[0]!.dispatchEvent(new Event('ended'));assert.equal(ended,0);
    elements[1]!.dispatchEvent(new Event('ended'));assert.equal(ended,1);player.stop();assert.equal(elements[1]!.cleared,true);
  });
  it('When play is blocked Then returns Korean guidance and exposes no browser error text',async()=>{
    const player=createBrowserAudioPlayer({createAudio:()=>{const a=new FakeAudio();a.failure=true;return a},createUrl:()=>'',revokeUrl:()=>{}});
    const result=await player.play('blob:test',()=>{},()=>{});assert.equal(result.ok,false);assert.match(JSON.stringify(result),/다시/);assert.ok(!JSON.stringify(result).includes('private'));
  });
});
