import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InlineResponseFeeds} from '../inline-response-feed';
import type {HostedInlineRequest} from '../hosted-inline';
import type {ThreadStreamCallbacks,watchThread} from '../thread-stream';
import {T3ResponseTooLargeError} from '../t3-response-limits';

const request={id:'binding',threadId:'thread',projectId:'project',messageId:'prompt',threadEnvironmentId:'environment'} as HostedInlineRequest;
function setup(){
 let now=0;const streams:Array<{callbacks:ThreadStreamCallbacks;stopped:boolean}>=[];
 const watch:typeof watchThread=(_id,_access,callbacks,_socket,_targets,replay)=>{assert.equal(replay?.pollSnapshots,false);const stream={callbacks,stopped:false};streams.push(stream);return {stop:()=>{stream.stopped=true;}};};
 const feeds=new InlineResponseFeeds(async()=>{throw Error('Fixture watch owns transport');},watch,()=>now);
 const snapshot={snapshotSequence:2,thread:{id:'thread',projectId:'project',protocolVersion:2,messages:[{id:'prompt',role:'user',turnId:'run',text:'Question',streaming:false}],activities:[],latestTurn:{turnId:'run',messageId:'prompt',state:'running'}}};
 return {feeds,streams,snapshot,advance:(ms:number)=>{now+=ms;}};
}
test('host keeps one shared live transcript and does not download it again for a completion event',async()=>{
 const h=setup();let reads=0;const access={origin:'',api:async()=>{reads++;return h.snapshot;}};
 await h.feeds.state(request,access);assert.equal(reads,1);
 h.streams[0].callbacks.item({kind:'event',event:{sequence:3,type:'thread.message-sent',payload:{messageId:'answer',itemId:'opaque-item',role:'assistant',turnId:'run',text:'Final reply',streaming:false,replace:true}}});
 h.streams[0].callbacks.item({kind:'event',event:{sequence:4,type:'thread.run-updated',payload:{id:'run',ordinal:1,userMessageId:'prompt',status:'completed',completedAt:'2026-10-11T12:00:00.000Z'}}});
 const current=await h.feeds.state({...request,id:'second-binding'},access);assert.equal(current!.messages.at(-1)!.text,'Final reply');assert.equal(current!.turns!.run.state,'completed');assert.equal(reads,1);assert.equal(h.streams.length,1);h.feeds.stop();
});
test('a blocked cold snapshot is not read again, but the live feed can recover the answer',async()=>{
 const h=setup();let reads=0;const access={origin:'',api:async()=>{reads++;throw new T3ResponseTooLargeError();}};
 await assert.rejects(h.feeds.state(request,access),T3ResponseTooLargeError);await assert.rejects(h.feeds.state(request,access),T3ResponseTooLargeError);assert.equal(reads,1);assert.equal(h.feeds.failure(request)?.operation,'snapshot');
 h.streams[0].callbacks.item({kind:'snapshot',snapshot:h.snapshot});assert.ok(await h.feeds.state(request,access));assert.equal(reads,1);h.feeds.stop();
 const restarted=setup();await assert.rejects(restarted.feeds.state(request,access,false,{kind:'response-too-large',operation:'snapshot'}),T3ResponseTooLargeError);assert.equal(reads,1);assert.equal(restarted.streams.length,1);restarted.feeds.stop();
});
test('unused host feeds stop and late events cannot enter their replacement',async()=>{
 const h=setup(),access={origin:'',api:async()=>h.snapshot};await h.feeds.state(request,access);h.advance(30_001);h.feeds.prune();assert.equal(h.streams[0].stopped,true);
 h.streams[0].callbacks.item({kind:'event',event:{sequence:99,type:'thread.message-sent',payload:{messageId:'wrong',role:'assistant',text:'Late',turnId:'run',streaming:false}}});
 const current=await h.feeds.state(request,access);assert.equal(current!.sequence,2);assert.equal(current!.messages.some(m=>m.text==='Late'),false);h.feeds.stop();
});
