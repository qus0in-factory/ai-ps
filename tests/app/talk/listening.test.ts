import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createListeningController, canListen } from '../../../src/app/talk/listening.ts';
import type { ListeningView } from '../../../src/app/talk/listening.ts';
import type { AudioPlayer } from '../../../src/domain/talk/listening.ts';
import type { Result } from '../../../src/domain/chat.ts';
function player(){let stopped=0;const urls:string[]=[],revoked:string[]=[];let ended=()=>{};
 const port:AudioPlayer={createUrl:()=>{const url='blob:'+urls.length;urls.push(url);return url},revokeUrl:url=>{revoked.push(url)},stop:()=>{stopped++},play:async(_url,onEnd)=>{ended=onEnd;return {ok:true,value:undefined}}};
 return {port,urls,revoked,end:()=>ended(),get stopped(){return stopped}};
}
describe('Given explicit sentence listening',()=>{
 it('When replaying the same sentence Then reuses its object URL and only one audio plays',async()=>{
  const p=player();let calls=0;let view!:ListeningView;
  const c=createListeningController({speak:async()=>{calls++;return {ok:true,value:new Blob(['wav'])}}},p.port,v=>{view=v});
  assert.equal(calls,0);assert.equal(canListen('あ'.repeat(201)),false);assert.equal(canListen('あ'.repeat(200)),true);
  await c.toggle('こんにちは。');assert.equal(view.status,'playing');await c.toggle('こんにちは。');assert.equal(view.status,'idle');
  await c.toggle('こんにちは。');assert.equal(calls,1);assert.equal(p.urls.length,1);
  await c.toggle('こんばんは。');assert.equal(calls,2);assert.ok(p.stopped>0);p.end();assert.equal(view.status,'idle');
  c.clear();assert.deepEqual(p.revoked,p.urls);
 });
 it('When switching while a fetch is pending Then aborts it and ignores a late result',async()=>{
  const p=player();let first!: (r:Result<Blob>)=>void,signal:AbortSignal|undefined;let view!:ListeningView;
  const c=createListeningController({speak:async(text,s)=>{if(text==='first'){signal=s;return await new Promise(r=>{first=r})}return {ok:true,value:new Blob(['wav'])}}},p.port,v=>{view=v});
  const pending=c.toggle('first');await c.toggle('second');assert.equal(signal?.aborted,true);first({ok:true,value:new Blob(['late'])});await pending;
  assert.equal(view.text,'second');assert.equal(view.status,'playing');assert.equal(p.urls.length,1);c.dispose();assert.deepEqual(p.revoked,p.urls);
 });
 it('When playback is rejected Then keeps the cached audio for a new user gesture and reports only local failure',async()=>{
  const p=player();let calls=0,view!:ListeningView;p.port.play=async()=>({ok:false,reason:'듣기를 다시 눌러주세요.'});
  const c=createListeningController({speak:async()=>{calls++;return {ok:true,value:new Blob(['wav'])}}},p.port,v=>{view=v});
  await c.toggle('こんにちは。');assert.equal(view.status,'idle');assert.match(view.error,/다시/);await c.toggle('こんにちは。');assert.equal(calls,1);
 });
 it('When audio ends before the play promise settles Then leaves the button stopped',async()=>{
  const p=player();let view!:ListeningView;p.port.play=async(_url,onEnd)=>{onEnd();return {ok:true,value:undefined}};
  const c=createListeningController({speak:async()=>({ok:true,value:new Blob(['wav'])})},p.port,v=>{view=v});
  await c.toggle('こんにちは。');assert.equal(view.status,'idle');assert.equal(view.error,'');
 });

 it('When more than five sentences are heard Then evicts the least recently used URL and promotes cache hits',async()=>{
  const p=player();const requested:string[]=[];
  const c=createListeningController({speak:async(text)=>{requested.push(text);return {ok:true,value:new Blob(['wav'])}}},p.port,()=>{});
  for(const text of ['A','B','C','D','E'])await c.toggle(text);
  assert.equal(p.revoked.length,0);
  await c.toggle('A');assert.equal(requested.length,5);
  await c.toggle('F');assert.deepEqual(p.revoked,['blob:1']);
  await c.toggle('C');assert.equal(requested.length,6);
  await c.toggle('B');assert.deepEqual(requested,['A','B','C','D','E','F','B']);
  assert.deepEqual(p.revoked,['blob:1','blob:3']);assert.equal(p.urls.length-p.revoked.length,5);
  c.dispose();assert.equal(new Set(p.revoked).size,p.urls.length);assert.equal(p.revoked.length,p.urls.length);
 });

});
