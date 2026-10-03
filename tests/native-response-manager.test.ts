import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeResponseManager} from '../native-response-manager';
import {responseAnchor,projectResponses} from '../native-response-projection';
import {contentHash} from '../completion';
import {readNativeCommitProof,type NativeCommitProof} from '../native-response-commit';
import type {LeaseRecord} from '../inline-lease';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',commitId='cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee';
const body='> Final answer',otherBody='> Independent response';
const before=`Before\n\n${responseAnchor(id)}\n\nBetween\n\n${responseAnchor(other)}\n\nAfter\n`;
const final=before.replace(responseAnchor(id),body);
function record(binding=id,revision=1):LeaseRecord {
  return {coordinated:true,owner:'host',epoch:1,revision,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:3,id:binding,vaultId:'vault',host:{environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:'Note.md',threadId:'thread',messageId:binding,projectId:'project',threadEnvironmentId:'host',initialHash:'initial',createdAt:'2026-10-03T12:00:00Z'},state:{requestHash:'request',accepted:true,notePath:'Note.md',status:'running',hashes:[],body:binding===id?body:otherBody,updatedAt:''}};
}
function completed(revision=2,document=final):LeaseRecord {const active=record(id,revision);return {...active,state:{...active.state!,status:'complete',finalBody:body,finalPhase:'complete',finalSaved:true,cleanupComplete:true,delivery:{commitId,hash:contentHash(document),verifiedOnHost:true,observedBy:[]}}};}
function evidence(document=final){const from=document.indexOf(body);const proof:NativeCommitProof={version:1,bindingId:id,commitId,hash:contentHash(document),document,ranges:[{from,to:from+body.length}]};const bytes=JSON.stringify(proof);return {bytes,proofHash:contentHash(bytes)};}
function fixture(panes=1){
  const file={path:'Note.md'},frames:string[][]=Array.from({length:panes},()=>[]),values=Array.from({length:panes},()=>before),conflicts:any[]=[];
  let disk=before,reads=0,read:()=>Promise<string>=async()=>disk;
  const views=values.map((_,i)=>({file,getViewData:()=>values[i],setViewData:(data:string)=>{values[i]=data;frames[i].push(data);},getMode:()=> 'preview',requestSave:()=>{},save:async()=>{disk=views[i].getViewData();}}));
  let leaves=views.map(view=>({view}));
  const app:any={workspace:{getLeavesOfType:()=>leaves},vault:{getFileByPath:(path:string)=>path===file.path?file:null,read:async()=>{reads++;return read();}},saveLocalStorage:(_key:string,data:any)=>conflicts.push(data)};
  const manager=new NativeResponseManager(app);
  return {manager,views,frames,conflicts,file,visible:(pane=0)=>values[pane],edit:(text:string,pane=0)=>{values[pane]=text;},disk:(text:string)=>{disk=text;},readWith:(fn:()=>Promise<string>)=>{read=fn;},reads:()=>reads,close:()=>{leaves=[];manager.refresh();}};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function start(h:ReturnType<typeof fixture>){await h.manager.receive(record());await h.manager.receive(record(other));for(const frames of h.frames)frames.length=0;}
function neverBlank(h:ReturnType<typeof fixture>){for(const frames of h.frames)assert.ok(frames.every(frame=>frame.includes(body)),JSON.stringify(frames));}

test('host completion retains final text throughout delayed Sync and adopts incoming saved bytes atomically',async()=>{
  const h=fixture(2);await start(h);await h.manager.receive(completed());
  for(let tick=0;tick<100;tick++)h.manager.refresh();
  assert.ok(h.views.every(view=>view.getViewData()===before));assert.ok(h.frames.every(frames=>frames.length===0));
  h.edit(h.visible().replace('Before','Local before'));
  h.disk(final);for(const view of h.views)view.setViewData(final);
  assert.ok(h.visible().includes('Local before'));assert.ok(h.views.every(view=>h.manager.view(view as any)!.hasMaterialized(id)));
  assert.ok(h.visible().includes(otherBody));assert.ok(!h.views[0].getViewData().includes(otherBody));neverBlank(h);
});
test('refresh during delayed saved-file read never removes a response in either pane',async()=>{
  const h=fixture(2);await start(h);const pending=deferred<string>();h.readWith(()=>pending.promise);
  const receiving=h.manager.receive(completed());for(let tick=0;tick<10;tick++)h.manager.refresh();
  assert.ok(h.frames.every(frames=>frames.length===0));pending.resolve(final);await receiving;
  assert.ok(h.views.every(view=>h.manager.view(view as any)!.hasMaterialized(id)));neverBlank(h);
});
test('file arriving before completion retains the display until verified metadata resolves the preserved view',async()=>{
  const h=fixture();await start(h);h.disk(final);h.views[0].setViewData(final);
  assert.ok(h.manager.view(h.views[0] as any)!.conflictRecord());assert.ok(h.visible().includes(body));
  await h.manager.receive(completed());assert.equal(h.manager.view(h.views[0] as any)!.conflictRecord(),undefined);assert.equal(h.views[0].getViewData(),final);neverBlank(h);
});
test('a failed pane merge preserves its response while another pane independently adopts',async()=>{
  const h=fixture(2);await start(h);h.edit(h.visible().replace('Before','Local before'));
  const remote=final.replace('Before','Remote before');h.disk(remote);await h.manager.receive(completed(2,remote));
  const blocked=h.manager.view(h.views[0] as any)!;assert.ok(blocked.conflictRecord());assert.equal(blocked.hasMaterialized(id),false);
  assert.equal(h.manager.view(h.views[1] as any)!.hasMaterialized(id),true);assert.ok(h.visible().includes('Local before'));neverBlank(h);
});
test('async read cannot apply superseded completion evidence or follow a pane to another file',async()=>{
  const h=fixture();await start(h);const pending=deferred<string>();h.readWith(()=>pending.promise);
  const receiving=h.manager.receive(completed());const newer=completed(3,final+'New version\n');await h.manager.receive({...newer,state:{...newer.state!,cleanupComplete:false,finalSaved:false,status:'running',delivery:undefined}});
  pending.resolve(final);await receiving;assert.equal(h.manager.view(h.views[0] as any)!.hasMaterialized(id),false);assert.equal(h.views[0].getViewData(),before);neverBlank(h);
  const switched=fixture();await start(switched);const later=deferred<string>();switched.readWith(()=>later.promise);const work=switched.manager.receive(completed());switched.views[0].file={path:'Other.md'};switched.views[0].setViewData('Another note');later.resolve(final);await work;assert.equal(switched.visible(),'Another note');
});
test('unload fences pending adoption reads instead of resurrecting disposed adapters',async()=>{
  const h=fixture();await start(h);const pending=deferred<string>();h.readWith(()=>pending.promise);const work=h.manager.receive(completed());h.manager.dispose();const afterUnload=h.visible();pending.resolve(final);await work;assert.equal(h.visible(),afterUnload);assert.equal(h.manager.view(h.views[0] as any),undefined);
});
test('proof permits unrelated later edits and an independently completed response with a different note checksum',async()=>{
  const h=fixture();await start(h);const proof=evidence(),metadata=completed();metadata.state!.delivery!.proofHash=proof.proofHash;
  await h.manager.receive(metadata,proof.bytes);
  const later=final.replace('Before','Ordinary before').replace(responseAnchor(other),'> Other finished').replace('After','Ordinary after');
  const otherDone=completed(2,later);otherDone.request={...record(other).request};otherDone.state={...otherDone.state!,body:'> Other finished',finalBody:'> Other finished',delivery:{...otherDone.state!.delivery!,commitId:'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee'}};
  await h.manager.receive(otherDone);h.disk(later);await h.manager.changed('Note.md');
  assert.equal(h.views[0].getViewData(),later);assert.equal(h.manager.view(h.views[0] as any)!.conflictRecord(),undefined);neverBlank(h);
});
test('changed result text does not satisfy commit proof or retire the locally preserved response',async()=>{
  const h=fixture();await start(h);const proof=evidence(),metadata=completed();metadata.state!.delivery!.proofHash=proof.proofHash;await h.manager.receive(metadata,proof.bytes);
  const damaged=final.replace(body,'> Changed result');h.disk(damaged);h.views[0].setViewData(damaged);await h.manager.changed('Note.md');assert.ok(h.manager.view(h.views[0] as any)!.conflictRecord());assert.equal(h.manager.view(h.views[0] as any)!.hasMaterialized(id),false);assert.ok(h.visible().includes(body));neverBlank(h);
});
test('authenticated proof rejects tampering, another binding and invalid protected ranges',()=>{
  const proof=evidence(),metadata=completed();metadata.state!.delivery!.proofHash=proof.proofHash;
  assert.throws(()=>readNativeCommitProof(proof.bytes+' ',id,metadata.state!.delivery!),/checksum/);
  assert.throws(()=>readNativeCommitProof(proof.bytes,other,metadata.state!.delivery!),/match/);
  const changed=JSON.stringify({...JSON.parse(proof.bytes),ranges:[{from:-1,to:20}]});assert.throws(()=>readNativeCommitProof(changed,id,{...metadata.state!.delivery!,proofHash:contentHash(changed)}),/ranges/);
});
test('a second file event during a delayed stale read is rechecked before adoption polling ends',async()=>{
  const h=fixture();await start(h);const pending=deferred<string>();let calls=0;h.readWith(()=>++calls===1?pending.promise:Promise.resolve(final));
  const work=h.manager.receive(completed());const again=h.manager.changed('Note.md');pending.resolve(before);await Promise.all([work,again]);assert.equal(calls,2);assert.equal(h.views[0].getViewData(),final);neverBlank(h);
});
test('autosave cannot replace an arrived final file with the panes stale empty anchor',async()=>{
  const h=fixture();await start(h);h.disk(final);await assert.rejects(h.views[0].save(),/anchor/);assert.ok(h.visible().includes(body));await h.manager.receive(completed());assert.equal(h.views[0].getViewData(),final);neverBlank(h);
});
test('a stale cross-pane echo cannot resurrect a completed anchor after successful adoption',async()=>{
  const h=fixture();await start(h);h.disk(final);await h.manager.receive(completed());
  const echo=projectResponses(before,[{id,body},{id:other,body:otherBody}]).display;h.views[0].setViewData(echo);
  assert.ok(h.manager.view(h.views[0] as any)!.conflictRecord());assert.ok(h.visible().includes(body));neverBlank(h);
});
