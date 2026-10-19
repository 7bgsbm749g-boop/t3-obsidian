import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DirectInlinePreview,type DirectInlineUpdate,type PreviewClock} from '../direct-inline-preview';
import type {ResponseRecord} from '../response-record';
import type {ThreadStreamCallbacks,ThreadStreamItem,watchThread} from '../thread-stream';
import {type ResponseStorageFiles} from '../response-record';
import {T3ResponseTooLargeError} from '../t3-response-limits';
import {normalizeV2StreamItem} from '../orchestration-v2';

class TestClock implements PreviewClock {
  time=0;next=0;pending=new Map<number,{at:number;callback:()=>void}>();
  now=()=>this.time;
  later=(callback:()=>void,ms:number)=>{const id=++this.next;this.pending.set(id,{at:this.time+ms,callback});return id;};
  cancel=(id:unknown)=>{this.pending.delete(id as number);};
  advance(ms:number){const end=this.time+ms;for(;;){const entry=[...this.pending].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>end)break;this.time=entry[1].at;this.pending.delete(entry[0]);entry[1].callback();}this.time=end;}
}
function fixture(paced=true,verify?:(path:string,payload?:any)=>Promise<any>){
  const request={version:4 as const,nativeProjection:true,id:randomUUID(),vaultId:randomUUID(),host:{environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/inline'},initialOwner:randomUUID(),notePath:'Note.md',threadId:'thread',messageId:'prompt',projectId:'project',threadEnvironmentId:'host',initialHash:'hash',createdAt:'2026-10-06T03:00:00Z',intermediateMode:'keep' as const};
  const record:ResponseRecord={request,coordinated:true,migrating:true,owner:'host',epoch:1,revision:0,expiresAt:Number.MAX_SAFE_INTEGER};
  const streams:Array<{callbacks:ThreadStreamCallbacks;cursor:()=>number|undefined;stopped:boolean}>=[],updates:DirectInlineUpdate[]=[];
  const watch:typeof watchThread=(_id,_access,callbacks,_socket,_targets,replay)=>{const stream={callbacks,cursor:replay!.afterSequence,stopped:false};streams.push(stream);return {stop:()=>{stream.stopped=true;}};};
  const clock=new TestClock();
  const preview=new DirectInlinePreview(record,async()=>{if(verify)return {origin:'https://fixture',api:verify};throw Error('No file or writer access in preview fixture');},update=>updates.push(update),watch,clock);
  const snapshot=(sequence=2,text='First paragraph',messageId='prompt',turnId='turn'):ThreadStreamItem=>({kind:'snapshot',snapshot:{snapshotSequence:sequence,thread:{id:'thread',projectId:'project',title:'Test',messages:[{id:messageId,role:'user',text:'Question',turnId,streaming:false},{id:'answer',role:'assistant',text,turnId,streaming:true}],activities:[],latestTurn:{turnId,state:'running',messageId},session:{status:'running',activeTurnId:turnId}}}});
  const item=(item:ThreadStreamItem,index=streams.length-1)=>{if(paced)clock.advance(80);streams[index].callbacks.item(item);};
  return {preview,record,streams,updates,clock,item,snapshot,event:(sequence:number,text:string,aggregateId='thread')=>item({kind:'event',event:{sequence,aggregateId,type:'thread.message-sent',payload:{messageId:'answer',role:'assistant',text,turnId:'turn',streaming:true}}})};
}

const completeV2=(h:ReturnType<typeof fixture>,sequence=2,text='Final reply')=>{
 const value=h.snapshot(sequence,text) as any,thread=value.snapshot.thread;
 thread.protocolVersion=2;Object.assign(thread.messages[1],{streaming:false,itemId:'opaque-item',updatedAt:'2026-10-06T03:01:00.000Z'});
 thread.latestTurn={turnId:'turn',state:'completed',messageId:'prompt',assistantMessageId:'answer',completedAt:'2026-10-06T03:02:00.000Z'};thread.turns={turn:thread.latestTurn};thread.session={status:'ready',activeTurnId:null};return value;
};
const finalItem=(text='Final reply')=>({id:'opaque-item',threadId:'thread',runId:'turn',messageId:'answer',type:'assistant_message',text,streaming:false,status:'completed',updatedAt:'2026-10-06T03:01:00.000Z'});
const settle=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};
test('a local reply follows two exact delegated deliveries and verifies only the last parent result',async()=>{
 const reads:string[]=[],h=fixture(false,async(_path,payload)=>{reads.push(payload.itemId);return {...finalItem('Combined report'),id:'final-item',runId:'resume-two',messageId:'combined'};});
 h.record.request.localOnly=true;h.record.request.intermediateMode='collapse';h.preview.tick(true);
 const source=completeV2(h,2,'Two agents are running') as any,thread=source.snapshot.thread;
 thread.turns.turn.delegatedCompletion={disposition:'open',delivery:null};
 const child=(id:string)=>({id,runId:'turn',origin:'app_owned',completionWake:'always',status:'running'});
 thread.subagents={one:child('one'),two:child('two')};h.item(source);await settle();
 assert.equal(h.updates.at(-1)!.phase,'running');assert.equal(h.updates.at(-1)!.completionVerified,false);assert.match(h.updates.at(-1)!.body,/Waiting for 2 subagents/);assert.deepEqual(reads,[]);
 let sequence=2;
 const event=(type:string,payload:any)=>h.item(normalizeV2StreamItem({kind:'event',sequence:++sequence,event:{type,payload}}));
 const resume=(id:string,ordinal:number,messageId:string)=>({id,ordinal,userMessageId:messageId,status:'running',requestedAt:'2026-10-06T03:03:00Z',completedAt:null});
 event('subagent.updated',{...child('one'),status:'completed',completionDelivery:{state:'pending'}});h.clock.advance(80);
 assert.equal(h.updates.at(-1)!.completionVerified,false);
 event('run.created',resume('resume-one',2,'delivery-one'));
 event('message.updated',{id:'delivery-one',role:'user',runId:'resume-one',text:'First child finished',streaming:false,delegatedCompletion:{parentRunId:'turn',generation:1,taskIds:['one']}});
 event('subagent.updated',{...child('one'),status:'completed',completionDelivery:{state:'acknowledged',observedByRunId:'resume-one'}});
 event('turn-item.updated',{id:'progress-item',messageId:'progress',runId:'resume-one',type:'assistant_message',text:'One report arrived',streaming:false,updatedAt:'2026-10-06T03:03:30Z'});
 event('run.updated',{...resume('resume-one',2,'delivery-one'),status:'completed',completedAt:'2026-10-06T03:04:00Z'});await settle();
 assert.equal(h.updates.at(-1)!.turnId,'resume-one');assert.match(h.updates.at(-1)!.body,/Waiting for 1 subagent</);assert.match(h.updates.at(-1)!.body,/One report arrived/);assert.deepEqual(reads,[]);
 // A new ordinary prompt is not a delegated result and must not enter this block.
 event('run.created',resume('other',3,'other-prompt'));
 event('message.updated',{id:'other-output',runId:'other',role:'assistant',text:'Unrelated answer',streaming:false});h.clock.advance(80);
 assert.equal(h.updates.at(-1)!.turnId,'resume-one');assert.doesNotMatch(h.updates.at(-1)!.body,/Unrelated answer/);
 event('message.updated',{id:'delivery-two',role:'user',runId:'resume-two',text:'Second child finished',streaming:false,delegatedCompletion:{parentRunId:'turn',generation:2,taskIds:['two']}});
 event('run.created',resume('resume-two',4,'delivery-two'));
 event('subagent.updated',{...child('two'),status:'completed',completionDelivery:{state:'acknowledged',observedByRunId:'resume-two'}});
 event('turn-item.updated',{id:'final-item',messageId:'combined',threadId:'thread',runId:'resume-two',type:'assistant_message',status:'completed',text:'Combined report',streaming:false,updatedAt:'2026-10-06T03:01:00.000Z'});
 event('run.updated',{...resume('resume-two',4,'delivery-two'),status:'completed',completedAt:'2026-10-06T03:05:00Z'});await settle();
 const update=h.updates.at(-1)!;assert.equal(update.turnId,'resume-two');assert.equal(update.phase,'complete');assert.equal(update.completionVerified,true,JSON.stringify({reads,checkpoint:update.checkpoint,body:update.body}));assert.deepEqual(update.turnIds,['turn','resume-one','resume-two']);assert.deepEqual(reads,['final-item']);assert.match(update.body,/· Completed/);assert.match(update.body,/Combined report/);assert.doesNotMatch(update.body,/Waiting for subagents|Unrelated answer/);
 h.preview.dispose();
});
test('a local source awaiting final save cannot adopt a late question answer run',async()=>{
 const h=fixture(false,async()=>finalItem('Source final'));h.record.request.localOnly=true;h.preview.tick(true);h.item(completeV2(h,2,'Source final'));await settle();
 const next=completeV2(h,3,'Source final') as any,thread=next.snapshot.thread;
 thread.messages.push({id:'async-answer:late',role:'user',turnId:'next-run',text:'Yes',streaming:false,createdAt:'2026-10-06T03:03:00Z'},{id:'next-answer',role:'assistant',turnId:'next-run',text:'New run must have its own stream',streaming:true,createdAt:'2026-10-06T03:03:01Z'});
 thread.activities=[{id:'asked',kind:'user-input.requested',summary:'Question',turnId:'turn',payload:{requestId:'late',responseMode:'message',questions:[]}},{id:'resolved',kind:'user-input.resolved',summary:'Resolved',turnId:'turn',payload:{requestId:'late',answers:{choice:'Yes'}}}];
 thread.latestTurn={turnId:'next-run',state:'running',messageId:'async-answer:late',requestedAt:'2026-10-06T03:03:00Z'};thread.turns['next-run']=thread.latestTurn;thread.session={status:'running',activeTurnId:'next-run'};
 h.item(next);await settle();const update=h.updates.at(-1)!;
 assert.equal(update.turnId,'turn');assert.equal(update.phase,'complete');assert.match(update.body,/Source final/);assert.doesNotMatch(update.body,/New run must|data-t3-answer-id/);h.preview.dispose();
});
test('live native question resolution produces a compact answer row and keeps it through subsequent stream text',()=>{
 const h=fixture();h.preview.tick(true);h.item(h.snapshot(2,'Before input.\n\n'));
 const event=(sequence:number,activity:any)=>h.item({kind:'event',event:{sequence,aggregateId:'thread',type:'thread.activity-appended',payload:{activity}}});
 event(3,{id:'question',kind:'user-input.requested',turnId:'turn',summary:'Question',createdAt:'2026-10-06T03:00:10Z',payload:{requestId:'request',questions:[{id:'device',header:'Device',question:'Which device and vault?',options:[]}]}});
 assert.match(h.updates.at(-1)!.body,/t3-question:/);
 event(4,{id:'resolved',kind:'user-input.resolved',turnId:'turn',summary:'Resolved',createdAt:'2026-10-06T03:00:20Z',payload:{requestId:'request',answers:{device:'laptop QLO2'}}});
 h.clock.advance(1000);
 assert.match(h.updates.at(-1)!.body,/data-t3-answer-id="request"/);assert.doesNotMatch(h.updates.at(-1)!.body,/t3-question:/);
 h.event(5,'After input.');h.clock.advance(1000);
 const body=h.updates.at(-1)!.body;
 assert.equal(body.match(/data-t3-answer-id="request"/g)?.length,1);
 assert.ok(body.indexOf('Before input.')<body.indexOf('data-t3-answer-id='));assert.ok(body.indexOf('data-t3-answer-id=')<body.indexOf('After input.'));
 assert.match(body,/Which device and vault\?<\/p><p class="send-to-t3-answer-text">laptop QLO2<\/p>/);
 h.preview.dispose();
});
test('v2 saves from a matching final item without a thread download and unrelated events retain verification',async()=>{
 const calls:any[]=[],h=fixture(false,async(path,payload)=>{calls.push({path,payload});return finalItem();});h.record.request.deviceCompletion={version:1,actor:randomUUID(),originalHash:'0'.repeat(64)};
 h.preview.tick(true);h.item(completeV2(h));await settle();assert.equal(h.updates.at(-1)!.completionVerified,true);assert.deepEqual(calls.map(c=>c.path),['/api/orchestration/turn-item']);
 h.item({kind:'event',event:{sequence:3,aggregateId:'thread',type:'v2.unknown',payload:{}}});h.clock.advance(1000);h.preview.tick(true);await settle();assert.equal(h.updates.at(-1)!.completionVerified,true);assert.equal(calls.length,1);h.preview.dispose();
});
test('a corrected v2 final reply saves immediately after one authoritative read',async()=>{
 let calls=0;const h=fixture(false,async()=>{calls++;return finalItem('Actual final reply');});h.record.request.deviceCompletion={version:1,actor:randomUUID(),originalHash:'0'.repeat(64)};
 h.preview.tick(true);h.item(completeV2(h));await settle();assert.match(h.updates.at(-1)!.body,/Actual final reply/);assert.equal(h.updates.at(-1)!.completionVerified,true);
 h.clock.advance(1000);h.preview.tick(true);await settle();assert.equal(h.updates.at(-1)!.completionVerified,true);assert.equal(calls,1);h.preview.dispose();
});
test('run completion immediately retains collapsed intermediate history and adopts a shorter authoritative final',async()=>{
 let calls=0;const h=fixture(false,async()=>{calls++;return finalItem('Final');});h.record.request.deviceCompletion={version:1,actor:randomUUID(),originalHash:'0'.repeat(64)};h.record.request.intermediateMode='collapse';h.preview.tick(true);
 const live=completeV2(h) as any;live.snapshot.thread.turns.turn.state='running';live.snapshot.thread.latestTurn.state='running';live.snapshot.thread.messages.splice(1,0,{id:'progress',role:'assistant',turnId:'turn',streaming:false,text:'Intermediate history stays'});h.item(live);
 h.item({kind:'event',event:{sequence:3,aggregateId:'thread',type:'thread.run-updated',payload:{id:'turn',status:'completed',userMessageId:'prompt',ordinal:1,completedAt:'2026-10-06T03:02:00.000Z'}}});await settle();
 const update=h.updates.at(-1)!;assert.equal(update.completionVerified,true);assert.equal(calls,1);assert.equal(h.clock.now(),0);assert.match(update.body,/\[!t3-progress\]-/);assert.match(update.body,/Intermediate history stays/);assert.doesNotMatch(update.body,/Final reply/);assert.ok(update.body.indexOf('Intermediate history stays')<update.body.lastIndexOf('Final'));h.preview.dispose();
});
test('oversized final reads show failure and stop repeat downloads while text remains visible',async()=>{
 let calls=0;const h=fixture(false,async()=>{calls++;throw new T3ResponseTooLargeError();});h.record.request.deviceCompletion={version:1,actor:randomUUID(),originalHash:'0'.repeat(64)};
 h.preview.tick(true);h.item(completeV2(h));await settle();assert.equal(h.updates.at(-1)!.failure?.operation,'final-reply');assert.match(h.updates.at(-1)!.body,/Final reply/);assert.equal(h.updates.at(-1)!.completionVerified,false);
 for(let n=0;n<5;n++){h.clock.advance(5000);h.preview.tick(true);await settle();}assert.equal(calls,1);assert.equal(h.updates.at(-1)!.phase,'error');h.preview.dispose();
});
test('an oversized snapshot does not prevent completion through the small final-item read',async()=>{
 const h=fixture(false,async()=>finalItem());h.record.request.deviceCompletion={version:1,actor:randomUUID(),originalHash:'0'.repeat(64)};h.preview.tick(true);h.item(h.snapshot());h.streams[0].callbacks.failure?.(new T3ResponseTooLargeError());assert.equal(h.updates.at(-1)!.failure?.operation,'snapshot');
 h.item(completeV2(h,3));h.clock.advance(80);await settle();assert.equal(h.updates.at(-1)!.completionVerified,true);assert.equal(h.updates.at(-1)!.failure,undefined);h.preview.dispose();
});
test('a v2 item verification arriving after suspension cannot finish the response',async()=>{
 let release!:(value:any)=>void;const h=fixture(false,()=>new Promise(resolve=>{release=resolve;}));h.record.request.deviceCompletion={version:1,actor:randomUUID(),originalHash:'0'.repeat(64)};h.preview.tick(true);h.item(completeV2(h));await settle();const count=h.updates.length;h.preview.tick(false);release(finalItem());await settle();assert.equal(h.updates.length,count);h.preview.dispose();
});

test('direct completion verifies canonical final prose instead of sealing a session-ready commentary message',async()=>{
 let release!:(value:any)=>void;const pending=new Promise(resolve=>{release=resolve;}),h=fixture(false,()=>pending);
 h.record.request.deviceCompletion={version:1,actor:randomUUID(),originalHash:'0'.repeat(64)};
 h.preview.tick(true);const initial=h.snapshot() as any;initial.snapshot.thread.messages[1].streaming=false;h.item(initial);
 h.item({kind:'event',event:{sequence:3,aggregateId:'thread',type:'thread.session-set',payload:{session:{status:'ready',activeTurnId:null}}}});
 assert.equal(h.updates.at(-1)!.phase,'complete');assert.equal(h.updates.at(-1)!.completionVerified,false);
 const canonical=h.snapshot(4,'Actual final response') as any;canonical.snapshot.thread.messages[1].streaming=false;canonical.snapshot.thread.latestTurn.state='completed';canonical.snapshot.thread.latestTurn.assistantMessageId='answer';canonical.snapshot.thread.session={status:'ready',activeTurnId:null};release(canonical.snapshot);
 for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));
 assert.match(h.updates.at(-1)!.body,/Actual final response/);assert.equal(h.updates.at(-1)!.completionVerified,true);assert.equal(h.updates.at(-1)!.sequence,4);h.preview.dispose();
});

test('a streaming final message cannot be committed on session-ready and stale verification cannot finish after suspension',async()=>{
 let release!:(value:any)=>void;const pending=new Promise(resolve=>{release=resolve;}),h=fixture(false,()=>pending);
 h.record.request.deviceCompletion={version:1,actor:randomUUID(),originalHash:'0'.repeat(64)};
 h.preview.tick(true);h.item(h.snapshot());h.item({kind:'event',event:{sequence:3,aggregateId:'thread',type:'thread.session-set',payload:{session:{status:'ready',activeTurnId:null}}}});
 assert.equal(h.updates.at(-1)!.phase,'running');assert.equal(h.updates.at(-1)!.completionVerified,false);
 h.item({kind:'event',event:{sequence:4,aggregateId:'thread',type:'thread.message-sent',payload:{messageId:'answer',role:'assistant',turnId:'turn',text:'Final',streaming:false}}});
 const count=h.updates.length;h.preview.tick(false);const canonical=h.snapshot(5,'Late verification') as any;canonical.snapshot.thread.messages[1].streaming=false;canonical.snapshot.thread.latestTurn.state='completed';release(canonical.snapshot);
 for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(h.updates.length,count);h.preview.dispose();
});
test('direct text appears while the host is still waiting for Sync and old or duplicate data cannot regress it',()=>{
  const h=fixture();h.preview.tick(true);assert.equal(h.streams[0].cursor(),0);h.item(h.snapshot());
  assert.match(h.updates.at(-1)!.body,/First paragraph/);assert.match(h.updates.at(-1)!.body,/Working/);assert.equal(h.record.migrating,true);
  h.event(3,' continues');h.event(3,' continues');h.item(h.snapshot(1,'Old text'));h.event(4,'wrong','other-thread');
  assert.match(h.updates.at(-1)!.body,/First paragraph continues/);assert.doesNotMatch(h.updates.at(-1)!.body,/continues continues|Old text|wrong/);
  h.preview.dispose();
});
test('exact prompt identity excludes an unrelated latest turn and the wrong project',()=>{
  const h=fixture();h.preview.tick(true);h.item(h.snapshot(2,'Unrelated','other-prompt','other-turn'));assert.equal(h.updates.length,0);
  const wrong=h.snapshot(3) as any;wrong.snapshot.thread.projectId='different';h.item(wrong);assert.equal(h.updates.length,0);
  h.item(h.snapshot(3));assert.match(h.updates.at(-1)!.body,/First paragraph/);h.preview.dispose();
});
test('suspension and resume fence late callbacks and resume from the last applied sequence',()=>{
  const h=fixture();h.preview.tick(true);h.item(h.snapshot());h.preview.tick(false);assert.equal(h.streams[0].stopped,true);
  const count=h.updates.length;h.item(h.snapshot(99,'Late'));assert.equal(h.updates.length,count);
  h.preview.tick(true);assert.equal(h.streams[1].cursor(),2);h.event(3,' after reconnect');assert.match(h.updates.at(-1)!.body,/after reconnect/);
  h.preview.dispose();h.item(h.snapshot(99,'After disposal'));assert.doesNotMatch(h.updates.at(-1)!.body,/After disposal/);
});
test('host checkpoint import preserves newer device prose and cannot advance the replay cursor',()=>{
  const h=fixture();h.preview.tick(true);h.item(h.snapshot());h.event(3,' newer');
  h.preview.update({...h.record,state:{requestHash:'h',accepted:true,notePath:'Note.md',status:'running',hashes:[],updatedAt:'',turnIds:['turn'],prose:[{id:'answer',role:'assistant',turnId:'turn',streaming:true,text:'First paragraph'}],bindingCheckpoint:{sequence:200}}});
  h.preview.tick(false);h.preview.tick(true);assert.equal(h.streams[1].cursor(),3);h.event(4,' newest');assert.match(h.updates.at(-1)!.body,/First paragraph newer newest/);h.preview.dispose();
});
test('an exact delivery receipt binds a null-turn prompt without waiting for the host receipt write',()=>{
  const h=fixture();h.preview.tick(true);const snapshot=h.snapshot() as any;snapshot.snapshot.thread.messages[0].turnId=null;delete snapshot.snapshot.thread.latestTurn.messageId;snapshot.snapshot.thread.latestTurn.requestedAt=h.record.request.createdAt;
  h.item(snapshot);h.preview.delivery({messageId:'prompt',requestedAt:h.record.request.createdAt,sequence:1,turnId:'turn'});
  assert.match(h.updates.at(-1)!.body,/First paragraph/);h.preview.dispose();
});
test('stop and completed host records close the direct stream without producing a new save',()=>{
  for(const end of ['stop','complete'] as const){const h=fixture();h.preview.tick(true);h.item(h.snapshot());h.preview.update({...h.record,...(end==='stop'?{stopRequestedAt:1}:{state:{requestHash:'h',accepted:true,notePath:'Note.md',status:'complete',hashes:[],updatedAt:'',cleanupComplete:true}})});h.preview.tick(true);assert.equal(h.streams[0].stopped,true);const n=h.updates.length;h.item(h.snapshot(30,'Late'));assert.equal(h.updates.length,n);h.preview.dispose();}
});

test('a durable conflict suspends direct display work immediately and explicit resume keeps the replay cursor',()=>{
 const h=fixture(false);h.preview.tick(true);h.item(h.snapshot());h.event(3,' queued');
 const state={requestHash:'h',accepted:true,notePath:'Note.md',status:'conflict' as const,hashes:[],updatedAt:''};
 h.preview.update({...h.record,state});assert.equal(h.streams[0].stopped,true);const count=h.updates.length;
 h.clock.advance(1000);h.item(h.snapshot(99,'Late conflict data'));assert.equal(h.updates.length,count);h.preview.tick(true);assert.equal(h.streams.length,1);
 h.preview.update({...h.record,state:{...state,status:'waiting'}});h.preview.tick(true);assert.equal(h.streams.length,2);assert.equal(h.streams[1].cursor(),3);
 h.event(4,' after explicit resume');h.clock.advance(1000);assert.match(h.updates.at(-1)!.body,/First paragraph queued after explicit resume/);h.preview.dispose();
});

test('dense deltas advance the replay cursor immediately but display the full accumulated text at bounded intervals',()=>{
  const h=fixture(false);h.preview.tick(true);h.item(h.snapshot());assert.equal(h.updates.length,1);
  for(let sequence=3;sequence<=102;sequence++){h.event(sequence,'x');h.clock.advance(4);}
  assert.equal(h.streams[0].cursor(),102);assert.equal(h.updates.length,6);
  assert.match(h.updates.at(-1)!.body,new RegExp('First paragraph'+'x'.repeat(100)));
  h.event(103,' pending');assert.equal(h.updates.length,6);
  h.item({kind:'event',event:{sequence:104,type:'thread.session-set',payload:{session:{status:'ready',activeTurnId:null}}}});
  assert.equal(h.updates.length,7);assert.match(h.updates.at(-1)!.body,/pending/);
  h.clock.advance(1000);assert.equal(h.updates.length,7);h.preview.dispose();
});
test('suspension cancels trailing display work, and an exact delivery still displays immediately',()=>{
  const h=fixture(false);h.preview.tick(true);h.item(h.snapshot());h.event(3,' queued');h.preview.tick(false);h.clock.advance(1000);assert.equal(h.updates.length,1);
  h.preview.tick(true);h.preview.delivery({messageId:'prompt',turnId:'turn',requestedAt:h.record.request.createdAt,sequence:1});assert.match(h.updates.at(-1)!.body,/queued/);
  h.event(4,' disposed');h.preview.dispose();const n=h.updates.length;h.clock.advance(1000);assert.equal(h.updates.length,n);
});


test('removed delivery disposes a direct preview immediately and rejects queued or late events',()=>{
 const h=fixture(false);h.preview.tick(true);h.item(h.snapshot());const n=h.updates.length;
 h.preview.update({...h.record,responseRemovedAt:100,revision:1});
 assert.equal(h.streams[0].stopped,true);h.event(3,' late');h.clock.advance(1000);h.preview.tick(true);
 assert.equal(h.streams.length,1);assert.equal(h.updates.length,n);assert.equal(h.clock.pending.size,0);
});
