import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DirectInlinePreview,type DirectInlineUpdate,type PreviewClock} from '../direct-inline-preview';
import type {LeaseRecord} from '../inline-lease';
import type {ThreadStreamCallbacks,ThreadStreamItem,watchThread} from '../thread-stream';
import {DeviceInlineManager} from '../leased-inline';
import {InlineLeaseAuthority,leasePaths,type LeaseFiles} from '../inline-lease';

class TestClock implements PreviewClock {
  time=0;next=0;pending=new Map<number,{at:number;callback:()=>void}>();
  now=()=>this.time;
  later=(callback:()=>void,ms:number)=>{const id=++this.next;this.pending.set(id,{at:this.time+ms,callback});return id;};
  cancel=(id:unknown)=>{this.pending.delete(id as number);};
  advance(ms:number){const end=this.time+ms;for(;;){const entry=[...this.pending].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>end)break;this.time=entry[1].at;this.pending.delete(entry[0]);entry[1].callback();}this.time=end;}
}
function fixture(paced=true){
  const request={version:4 as const,nativeProjection:true,id:randomUUID(),vaultId:randomUUID(),host:{environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/inline'},initialOwner:randomUUID(),notePath:'Note.md',threadId:'thread',messageId:'prompt',projectId:'project',threadEnvironmentId:'host',initialHash:'hash',createdAt:'2026-10-06T03:00:00Z',intermediateMode:'keep' as const};
  const record:LeaseRecord={request,coordinated:true,migrating:true,owner:'host',epoch:1,revision:0,expiresAt:Number.MAX_SAFE_INTEGER};
  const streams:Array<{callbacks:ThreadStreamCallbacks;cursor:()=>number|undefined;stopped:boolean}>=[],updates:DirectInlineUpdate[]=[];
  const watch:typeof watchThread=(_id,_access,callbacks,_socket,_targets,replay)=>{const stream={callbacks,cursor:replay!.afterSequence,stopped:false};streams.push(stream);return {stop:()=>{stream.stopped=true;}};};
  const clock=new TestClock();
  const preview=new DirectInlinePreview(record,async()=>{throw Error('No file or writer access in preview fixture');},update=>updates.push(update),watch,clock);
  const snapshot=(sequence=2,text='First paragraph',messageId='prompt',turnId='turn'):ThreadStreamItem=>({kind:'snapshot',snapshot:{snapshotSequence:sequence,thread:{id:'thread',projectId:'project',title:'Test',messages:[{id:messageId,role:'user',text:'Question',turnId,streaming:false},{id:'answer',role:'assistant',text,turnId,streaming:true}],activities:[],latestTurn:{turnId,state:'running',messageId},session:{status:'running',activeTurnId:turnId}}}});
  const item=(item:ThreadStreamItem,index=streams.length-1)=>{if(paced)clock.advance(80);streams[index].callbacks.item(item);};
  return {preview,record,streams,updates,clock,item,snapshot,event:(sequence:number,text:string,aggregateId='thread')=>item({kind:'event',event:{sequence,aggregateId,type:'thread.message-sent',payload:{messageId:'answer',role:'assistant',text,turnId:'turn',streaming:true}}})};
}
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

test('device registration starts the direct transport while host migration has no note, with no checkpoint or note writes',async()=>{
 const h=fixture(),storage=new Map<string,string>(),updates:DirectInlineUpdate[]=[],identity={...h.record.request.host,vaultId:h.record.request.vaultId};
 const files:LeaseFiles={read:async path=>storage.get(path),write:async(path,value)=>{storage.set(path,value);},remove:async path=>{storage.delete(path);},list:async dir=>[...storage.keys()].filter(path=>path.startsWith(dir+'/'))};
 const authority=new InlineLeaseAuthority(identity,files),remote={...files,read:async(path:string)=>{if(path.includes('/replies/'))await authority.tick();return files.read(path);}};
 const oldSocket=globalThis.WebSocket;
 class Socket {onopen?:()=>void;onclose?:()=>void;onmessage?:(item:{data:string})=>void;onerror?:()=>void;constructor(){queueMicrotask(()=>this.onopen?.());}send(raw:string){if(JSON.parse(raw).tag==='orchestration.subscribeThread')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Chunk',requestId:'1',values:[h.snapshot()]})}));}close(){this.onclose?.();}}
 globalThis.WebSocket=Socket as any;
 const manager=new DeviceInlineManager(h.record.request.initialOwner!,identity.vaultId,{receiveDirect:update=>updates.push(update),receiveCoordinated:()=>{},access:async()=>({origin:'https://fixture',api:async()=>({ticket:'fixture'})}),readNote:async()=>undefined,isOpen:()=>true,updateNote:async()=>{throw Error('Direct transport must not save generated text');}},async()=>({files:remote,close:()=>{}}),undefined,undefined,async()=>{await authority.tick();});
 try{
  await manager.register({...h.record.request,messageId:randomUUID(),initialHash:'0'.repeat(64)});
  // The fixture's response belongs to a different prompt, so it is excluded.
  await new Promise(resolve=>setImmediate(resolve));assert.equal(updates.length,0);
  const request={...h.record.request,id:randomUUID(),messageId:randomUUID(),initialHash:'0'.repeat(64)};
  const originalSnapshot=h.snapshot;h.snapshot=(...args)=>{const item=originalSnapshot(...args) as any;item.snapshot.thread.messages[0].id=request.messageId;item.snapshot.thread.latestTurn.messageId=request.messageId;return item;};
  await manager.register(request);for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(updates.some(update=>update.request.id===request.id&&update.body.includes('First paragraph')));
  const record=JSON.parse(storage.get(leasePaths(identity.directory,request.id).record)!);assert.equal(record.migrating,true);assert.equal(record.state,undefined);
  const commands=[...storage].filter(([path])=>path.includes('/commands/')).map(([,bytes])=>JSON.parse(bytes));assert.ok(commands.every(command=>command.kind!=='checkpoint'));
 }finally{manager.dispose();authority.stop();globalThis.WebSocket=oldSocket;}
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
