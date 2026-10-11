import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeResponseManager} from '../native-response-manager';
import {responseAnchor,projectResponses} from '../native-response-projection';
import {initialRegion,regionBody} from '../inline-thread';
import {contentHash} from '../completion';
import {readNativeCommitProof,type NativeCommitProof} from '../native-response-commit';
import type {LeaseRecord} from '../inline-lease';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {RESPONSE_SIZE_FAILURE} from '../t3-response-limits';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',commitId='cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee';
const body='> Final answer',otherBody='> Independent response';
const before=`Before\n\n${responseAnchor(id)}\n\nBetween\n\n${responseAnchor(other)}\n\nAfter\n`;
const final=before.replace(responseAnchor(id),body);
function record(binding=id,revision=1):LeaseRecord {
  return {coordinated:true,owner:'host',epoch:1,revision,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:3,id:binding,vaultId:'vault',host:{environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:'Note.md',threadId:'thread',messageId:binding,projectId:'project',threadEnvironmentId:'host',initialHash:'initial',createdAt:'2026-10-03T12:00:00Z'},state:{requestHash:'request',accepted:true,notePath:'Note.md',status:'running',hashes:[],body:binding===id?body:otherBody,updatedAt:''}};
}
function completed(revision=2,document=final):LeaseRecord {const active=record(id,revision);return {...active,state:{...active.state!,status:'complete',finalBody:body,finalPhase:'complete',finalSaved:true,cleanupComplete:true,delivery:{commitId,hash:contentHash(document),verifiedOnHost:true,observedBy:[]}}};}
function evidence(document=final){const from=document.indexOf(body);const proof:NativeCommitProof={version:1,bindingId:id,commitId,hash:contentHash(document),document,ranges:[{from,to:from+body.length}]};const bytes=JSON.stringify(proof);return {bytes,proofHash:contentHash(bytes)};}
function fixture(panes=1,local=new Map<string,unknown>()){
  const file={path:'Note.md'},frames:string[][]=Array.from({length:panes},()=>[]),values=Array.from({length:panes},()=>before),conflicts:any[]=[];
  let disk=before,reads=0,read:()=>Promise<string>=async()=>disk;
  const views=values.map((_,i)=>({file,getViewData:()=>values[i],setViewData:(data:string)=>{values[i]=data;frames[i].push(data);},getMode:()=> 'preview',requestSave:()=>{},save:async()=>{disk=views[i].getViewData();}}));
  let leaves=views.map(view=>({view}));
  const app:any={workspace:{getLeavesOfType:()=>leaves},vault:{getFileByPath:(path:string)=>path===file.path?file:null,read:async()=>{reads++;return read();}},loadLocalStorage:(key:string)=>local.get(key),saveLocalStorage:(key:string,data:any)=>{local.set(key,structuredClone(data));conflicts.push(data);}};
  const manager=new NativeResponseManager(app);
  return {manager,views,frames,conflicts,file,local,visible:(pane=0)=>values[pane],edit:(text:string,pane=0)=>{values[pane]=text;},disk:(text:string)=>{disk=text;},readWith:(fn:()=>Promise<string>)=>{read=fn;},reads:()=>reads,open:(view:any)=>{leaves.push({view});},close:()=>{leaves=[];manager.refresh();}};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function start(h:ReturnType<typeof fixture>){await h.manager.receive(record());await h.manager.receive(record(other));for(const frames of h.frames)frames.length=0;}
function neverBlank(h:ReturnType<typeof fixture>){for(const frames of h.frames)assert.ok(frames.every(frame=>frame.includes(body)),JSON.stringify(frames));}

test('the size failure is visible only on its response and retained text survives until recovery',async()=>{
 const h=fixture();await start(h);const failed=record(id,2);failed.state!.streamFailure={kind:'response-too-large',operation:'snapshot'};failed.state!.status='error';await h.manager.receive(failed);
 assert.match(h.visible(),/Reply not saved: T3 data exceeds the 8 MB limit/);assert.ok(h.visible().includes(body));assert.ok(h.visible().includes(otherBody));assert.equal(h.visible().split(RESPONSE_SIZE_FAILURE).length-1,1);assert.ok(h.visible().startsWith('Before\n'));assert.ok(h.visible().endsWith('After\n'));
 h.manager.stream({request:failed.request,messageId:failed.request.messageId,sequence:10,body,phase:'complete',completionVerified:true});assert.equal(h.visible().includes(RESPONSE_SIZE_FAILURE),false);assert.ok(h.visible().includes(body));h.manager.dispose();
});

test('resolved native conflicts delete full copies only after the chosen text reaches disk',async()=>{
  const h=fixture();await start(h);h.edit(h.visible().replace('Before','Local edit'));const incoming=before.replace('Before','Remote edit');h.disk(incoming);h.views[0].setViewData(incoming);const conflict=h.manager.view(h.views[0] as any)!.conflictRecord()!;assert.ok(conflict);
  const keys=[...h.local.keys()].filter(key=>key.startsWith('t3-native-conflict:'));assert.equal(keys.length,1);
  await h.manager.resolve(h.views[0] as any,incoming,'local');assert.equal(h.local.get(keys[0]),null);assert.equal(h.views[0].getViewData(),conflict.local);const receipts=h.local.get('t3-native-resolutions:local') as any[];assert.equal(receipts.length,1);assert.equal('local' in receipts[0],false);h.manager.dispose();
});
test('a failed native conflict save preserves the full conflict and requires another review',async()=>{
  const h=fixture();await start(h);h.edit(h.visible().replace('Before','Local edit'));const incoming=before.replace('Before','Remote edit');h.disk(incoming);h.views[0].setViewData(incoming);const adapter=h.manager.view(h.views[0] as any)!,conflict=adapter.conflictRecord()!;h.readWith(async()=>incoming);
  await assert.rejects(h.manager.resolve(h.views[0] as any,incoming,'local'),/not reached/);assert.deepEqual(adapter.conflictRecord(),conflict);assert.ok([...h.local].some(([key,value])=>key.startsWith('t3-native-conflict:')&&value!==null));h.manager.dispose();
});

test('device completion tombstones protect a reloaded native pane from a late old response anchor',async()=>{
 const h=fixture();h.edit(final);h.disk(final);const proof:NativeCommitProof={version:1,bindingId:id,commitId,hash:contentHash(final),document:final,ranges:[{from:final.indexOf(body),to:final.indexOf(body)+body.length}]};
 h.manager.deviceCommitted('Note.md',proof);assert.ok(h.manager.view(h.views[0] as any));
 h.edit(h.visible().replace('Before','New ordinary edit'));
 h.views[0].setViewData(before);assert.equal(h.conflicts.length,1);assert.match(h.conflicts[0].local,/New ordinary edit/);assert.equal(h.conflicts[0].incoming,before);
 await assert.rejects(h.views[0].save(),/resurrected/);h.manager.dispose();
});

test('a stale anchor already on disk at reload is preserved against the retained verified device result',()=>{
 const h=fixture();const proof:NativeCommitProof={version:1,bindingId:id,commitId,hash:contentHash(final),document:final,ranges:[{from:final.indexOf(body),to:final.indexOf(body)+body.length}]};
 h.manager.deviceCommitted('Note.md',proof);assert.equal(h.conflicts.length,1);assert.equal(h.conflicts[0].local,final);assert.equal(h.conflicts[0].incoming,before);h.manager.dispose();
});

test('a reopened observer pane with a proven saved result also rejects late stale anchors',async()=>{
 const h=fixture();h.edit(final);h.disk(final);const proof=evidence(),done=completed();done.state!.delivery!.proofHash=proof.proofHash;
 await h.manager.receive(done,proof.bytes);assert.ok(h.manager.view(h.views[0] as any));
 h.views[0].setViewData(before);assert.equal(h.conflicts.length,1);assert.equal(h.conflicts[0].local,final);assert.equal(h.conflicts[0].incoming,before);h.manager.dispose();
});

test('ordinary edits to an adopted completed response survive repeated delivery and late stream events',async()=>{
 const h=fixture(),proof=evidence(),done=completed();done.state!.delivery!.proofHash=proof.proofHash;
 h.edit(final);h.disk(final);await h.manager.receive(done,proof.bytes);
 const edited=final.replace(body,'User edited the completed answer.');h.edit(edited);h.disk(edited);
 await h.manager.receive(done,proof.bytes);
 h.manager.stream({request:done.request,messageId:done.request.messageId,sequence:999,body:'Late response text',phase:'complete',completionVerified:true});
 h.manager.refresh();await h.manager.changed('Note.md');
 assert.equal(h.views[0].getViewData(),edited);assert.equal(h.visible(),edited);assert.equal(h.conflicts.length,0);h.manager.dispose();
 h.manager.refresh();assert.equal(h.visible(),edited);
});

async function previewCheckpoint(){
  const h=fixture(2);let saved:unknown;
  h.manager.configurePreviewCache('vault',undefined,async value=>{saved=structuredClone(value);});
  await start(h);h.manager.stream({request:record().request,messageId:id,sequence:12,body:'> Latest device paragraph'});
  await h.manager.flushPreviewCache();h.manager.dispose();return saved;
}
test('reload restores several local previews before host discovery without saving generated text',async()=>{
  const saved=await previewCheckpoint(),h=fixture(2);let latest:unknown;
  h.manager.configurePreviewCache('vault',saved,async value=>{latest=value;});h.manager.refresh();
  assert.ok(h.views.every((_,i)=>h.visible(i).includes('Latest device paragraph')&&h.visible(i).includes(otherBody)));
  h.views.forEach((_,i)=>assert.doesNotMatch(h.visible(i),/Reconnecting/));
  assert.deepEqual(h.manager.reconnectingResponseIds().sort(),[id,other].sort());
  assert.equal(h.reads(),0);assert.ok(h.views.every(view=>view.getViewData()===before));
  h.edit(h.visible().replace('Before','Ordinary edit'));await h.views[0].save();
  assert.equal(h.views[0].getViewData(),before.replace('Before','Ordinary edit'));assert.ok(!h.views[0].getViewData().includes('Latest device paragraph'));
  await h.manager.flushPreviewCache();assert.equal(latest,undefined);h.manager.dispose();
});
test('reload discovers saved native anchors without a cache and after an offline rename',()=>{
  const h=fixture();h.file.path='Renamed.md';h.manager.configurePreviewCache('vault',undefined,async()=>{});
  assert.deepEqual(h.manager.reconnectingResponseIds().sort(),[id,other].sort());
  h.edit(before.replace(responseAnchor(id),'Ordinary saved text'));
  assert.deepEqual(h.manager.reconnectingResponseIds(),[other]);h.manager.dispose();
});
test('reloaded preview cannot regress to delayed host prose or earlier direct events',async()=>{
  const h=fixture();h.manager.configurePreviewCache('vault',await previewCheckpoint(),async()=>{});h.manager.refresh();
  await h.manager.receive({...record(id,2),state:{...record().state!,body:'> Delayed host',bindingCheckpoint:{sequence:200}}});
  h.manager.stream({request:record().request,messageId:id,sequence:11,body:'> Earlier direct'});
  assert.ok(h.visible().includes('Latest device paragraph'));assert.doesNotMatch(h.visible(),/Reconnecting/);
  assert.deepEqual(h.manager.reconnectingResponseIds().sort(),[id,other].sort());
  h.manager.stream({request:record().request,messageId:id,sequence:13,body:'> Fresh direct'});
  assert.ok(h.visible().includes('Fresh direct'));assert.ok(!h.visible().includes('Latest device paragraph'));assert.equal(h.views[0].getViewData(),before);h.manager.dispose();
});
test('stop removes the durable preview and late events cannot restore it on another reload',async()=>{
  const h=fixture();let saved:unknown;h.manager.configurePreviewCache('vault',await previewCheckpoint(),async value=>{saved=structuredClone(value);});
  await h.manager.receive({...record(id,2),stopRequestedAt:123});
  h.manager.stream({request:record().request,messageId:id,sequence:40,body:'> Late stopped output'});
  await h.manager.flushPreviewCache();h.manager.dispose();const reloaded=fixture();reloaded.manager.configurePreviewCache('vault',saved,async()=>{});reloaded.manager.refresh();
  assert.ok(!reloaded.visible().includes('Latest device paragraph'));assert.ok(!reloaded.visible().includes('Late stopped output'));assert.ok(reloaded.visible().includes(otherBody));reloaded.manager.dispose();
});
test('removed or changed saved markers cannot be restored from a preview cache',async()=>{
  for(const document of [before.replace(responseAnchor(id),''),before.replace(responseAnchor(id),responseAnchor(id).replace('\n\n','\nUser text\n'))]){
    const h=fixture();h.edit(document);h.manager.configurePreviewCache('vault',await previewCheckpoint(),async()=>{});h.manager.refresh();
    assert.ok(!h.visible().includes('Latest device paragraph'));assert.equal(h.views[0].getViewData(),document);h.manager.dispose();
  }
});
test('cached preview rejects another vault, prompt, path and damaged persisted data',async()=>{
  const saved:any=await previewCheckpoint();
  const otherVault=fixture();otherVault.manager.configurePreviewCache('another-vault',saved,async()=>{});otherVault.manager.refresh();assert.equal(otherVault.visible(),before);otherVault.manager.dispose();
  const differentPrompt=fixture();differentPrompt.manager.configurePreviewCache('vault',saved,async()=>{});await differentPrompt.manager.receive({...record(id,2),state:{...record().state!,messageId:'new-prompt',body:'> New prompt'}});assert.ok(!differentPrompt.visible().includes('Latest device paragraph'));differentPrompt.manager.dispose();
  for(const mutate of [(entry:any)=>{entry.notePath='../Note.md';},(entry:any)=>{entry.id='invalid';},(entry:any)=>{entry.body='nested '+responseAnchor(other);}]){
    const corrupt=structuredClone(saved);corrupt.entries=corrupt.entries.filter((entry:any)=>entry.id===id);mutate(corrupt.entries[0]);
    const h=fixture();h.manager.configurePreviewCache('vault',corrupt,async()=>{});h.manager.refresh();assert.equal(h.visible(),before);h.manager.dispose();
  }
});
test('saved completion removes cached output and keeps ordinary edits through native adoption',async()=>{
  const h=fixture();let saved:unknown;h.manager.configurePreviewCache('vault',await previewCheckpoint(),async value=>{saved=structuredClone(value);});h.manager.refresh();
  h.disk(final);await h.manager.receive(completed(2));assert.equal(h.views[0].getViewData(),final);await h.manager.flushPreviewCache();h.manager.dispose();
  const reloaded=fixture();reloaded.edit(final);reloaded.manager.configurePreviewCache('vault',saved,async()=>{});reloaded.manager.refresh();assert.ok(!reloaded.visible().includes('Latest device paragraph'));assert.equal(reloaded.views[0].getViewData(),final);reloaded.manager.dispose();
});
test('native rename updates the cache path without copying a preview to a reused note path',async()=>{
  const h=fixture();let saved:any;h.manager.configurePreviewCache('vault',await previewCheckpoint(),async value=>{saved=structuredClone(value);});h.manager.refresh();h.file.path='Renamed.md';h.manager.renamed('Note.md','Renamed.md');
  assert.ok(h.visible().includes('Latest device paragraph'));await h.manager.flushPreviewCache();assert.ok(saved.entries.every((entry:any)=>entry.notePath==='Renamed.md'));h.manager.dispose();
  const oldPath=fixture();oldPath.manager.configurePreviewCache('vault',saved,async()=>{});oldPath.manager.refresh();assert.equal(oldPath.visible(),before);oldPath.manager.dispose();
});
test('deleting a note removes its preview even when the host is unavailable',async()=>{
  const h=fixture();let saved:any;h.manager.configurePreviewCache('vault',await previewCheckpoint(),async value=>{saved=value;});h.manager.deleted('Note.md');await h.manager.flushPreviewCache();assert.deepEqual(saved.entries,[]);h.manager.dispose();
});
test('failed cache storage does not prevent fresh display or final saves',async()=>{
  const h=fixture();h.manager.configurePreviewCache('vault',undefined,async()=>{throw Error('Device disk full');});await start(h);await h.manager.flushPreviewCache();assert.ok(h.visible().includes(body));h.disk(final);await h.manager.receive(completed());assert.equal(h.views[0].getViewData(),final);h.manager.dispose();
});
test('restored replies retain separate Markdown blocks without a reconnect banner',async()=>{
  const h=fixture();h.manager.configurePreviewCache('vault',await previewCheckpoint(),async()=>{});h.manager.refresh();
  const blocks=unified().use(remarkParse).parse(h.visible()).children.filter(node=>node.type==='blockquote');
  assert.equal(blocks.length,2,'Two independent replies each retain their own reply block');
  assert.doesNotMatch(h.visible(),/Reconnecting/);h.manager.dispose();
});

test('live title metadata updates provisional and migrating headers without changing saved notes or waiting for host output',async()=>{
 const h=fixture(2),initial=regionBody(initialRegion(id,undefined,'New thread').text,id)!.body;
 h.manager.preview(h.views[0] as any,id,initial);h.manager.title(id,'Generated **title**');
 assert.ok(h.visible().includes('Generated \\*\\*title\\*\\* · Working'));
 assert.ok(h.views.every(view=>view.getViewData()===before));
 const migrating=record();migrating.migrating=true;migrating.state!.accepted=false;migrating.state!.body=undefined;migrating.request.threadTitle='New thread';
 await h.manager.receive(migrating);assert.ok(h.visible().includes('Generated \\*\\*title\\*\\* · Working'));
 h.manager.title(id,'Latest title');await h.manager.receive({...migrating,revision:2});
 assert.ok(h.visible().includes('Latest title · Working'));assert.ok(h.views.every(view=>view.getViewData()===before));
 h.manager.dispose();
});

test('direct device text wins over delayed host output until the checked final commit and Sync adoption',async()=>{
 const h=fixture(2),active=record();active.migrating=true;active.state!.body=undefined;active.state!.accepted=false;
 await h.manager.receive(active);
 h.manager.stream({request:active.request,messageId:active.request.messageId,sequence:12,body:'> Direct first paragraph'});
 h.edit(h.visible().replace('Before','Local before'));
 await h.manager.receive({...active,revision:2,state:{...active.state!,body:'> Delayed old paragraph',bindingCheckpoint:{sequence:20}}});
 h.manager.stream({request:active.request,messageId:active.request.messageId,sequence:11,body:'> Old direct paragraph'});
 assert.ok(h.visible().includes('Direct first paragraph'));assert.ok(h.visible().includes('Local before'));
 assert.ok(h.views.every(view=>!view.getViewData().includes('Direct first paragraph')));
 await h.manager.receive(completed(3));assert.ok(h.visible().includes(body));assert.ok(!h.visible().includes('Direct first paragraph'));
 h.manager.stream({request:active.request,messageId:active.request.messageId,sequence:30,body:'> Late direct paragraph'});assert.ok(!h.visible().includes('Late direct paragraph'));
 h.disk(final);await h.manager.changed('Note.md');assert.ok(h.visible().includes('Local before'));assert.ok(h.manager.view(h.views[0] as any)!.hasMaterialized(id));h.manager.dispose();
});
test('a direct stream cannot project another thread and keeps its placement after a native rename',async()=>{
 const h=fixture();const active=record();await h.manager.receive(active);
 h.manager.stream({request:{...active.request,threadId:'wrong'},messageId:id,sequence:30,body:'> Wrong thread'});assert.ok(!h.visible().includes('Wrong thread'));
 h.manager.stream({request:active.request,messageId:id,sequence:10,body:'> Direct stream'});
 h.file.path='Renamed.md';h.manager.renamed('Note.md',h.file.path);await h.manager.receive({...active,revision:2});
 assert.ok(h.visible().includes('Direct stream'));assert.equal(h.views[0].getViewData(),before);h.manager.dispose();
});

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
test('a verified rename retains the native reply through stale host leases, successive moves and final adoption',async()=>{
  const h=fixture();await start(h);h.file.path='Folder/Renamed.md';h.manager.renamed('Note.md',h.file.path);
  assert.ok(h.visible().includes(body));assert.ok(h.visible().includes(otherBody));assert.equal(h.views[0].getViewData(),before);
  await h.manager.receive(record(id,2));assert.ok(h.visible().includes(body));
  h.file.path='Moved/Renamed.md';h.manager.renamed('Folder','Moved');
  await h.manager.receive({...record(id,3),state:{...record(id,3).state!,notePath:'Folder/Renamed.md'}});
  assert.ok(h.visible().includes(body));
  h.disk(final);await h.manager.receive(completed(4));assert.equal(h.views[0].getViewData(),final);neverBlank(h);
});
test('renaming back follows the same file while stale leases cannot remove its projection',async()=>{
  const h=fixture();await start(h);h.file.path='Other.md';h.manager.renamed('Note.md','Other.md');h.file.path='Note.md';h.manager.renamed('Other.md','Note.md');
  await h.manager.receive({...record(id,2),state:{...record(id,2).state!,notePath:'Other.md'}});assert.ok(h.visible().includes(body));assert.equal(h.views[0].getViewData(),before);neverBlank(h);
});
test('reusing a renamed path for an independent response keeps its own registration and projection',async()=>{
  const h=fixture();await h.manager.receive(record());h.file.path='Moved.md';h.manager.renamed('Note.md','Moved.md');
  let visible=responseAnchor(other);const view:any={file:{path:'Note.md'},getViewData:()=>visible,setViewData:(value:string)=>{visible=value;},getMode:()=> 'preview',save:async()=>{},requestSave:()=>{}};
  h.open(view);await h.manager.receive(record(other));
  assert.ok(visible.includes(otherBody));assert.equal(view.getViewData(),responseAnchor(other));assert.ok(h.visible().includes(body));assert.ok(!h.visible().includes(otherBody));
});


test('removed response drops direct and cached display without restoring a stale stream or changing saved note bytes',async()=>{
 const h=fixture();await start(h);const saved=h.manager.view(h.views[0] as any)!.saved();
 const current=record();await h.manager.receive({...current,revision:3,responseRemovedAt:100});
 assert.equal(h.manager.view(h.views[0] as any)!.saved(),saved);assert.doesNotMatch(h.visible(),/Final answer/);assert.match(h.visible(),/Independent response/);
 h.manager.stream({request:current.request,messageId:current.request.messageId,sequence:100,body:'Late removed reply'});
 await h.manager.receive({...current,revision:2});assert.doesNotMatch(h.visible(),/Late removed reply|Final answer/);
 assert.equal(h.manager.view(h.views[0] as any)!.saved(),saved);h.manager.dispose();
});

for(const hidden of [false,true])test(`local native ${hidden?'failure':'stop'} seals all panes before a host reply and survives stale streams and reload`,async()=>{
  const h=fixture(2);h.manager.configurePreviewCache('vault',undefined,async()=>{});await start(h);
  h.manager.stream({request:record().request,messageId:id,sequence:9,body:'**T3 · Working** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n\n> Latest partial reply'});
  h.manager.stop(id,'Note.md',hidden);
  for(let pane=0;pane<2;pane++){
    assert.doesNotMatch(h.visible(pane),/Working|spinner/);
    assert.equal(h.visible(pane).includes('Latest partial reply'),!hidden);
    assert.ok(h.visible(pane).includes(otherBody));assert.equal(h.views[pane].getViewData(),before);
  }
  await h.manager.receive({...record(),revision:10,state:{...record().state!,body:'**T3 · Working**\n\n> Stale host'}});
  h.manager.stream({request:record().request,messageId:id,sequence:99,body:'**T3 · Working**\n\n> Late event'});
  assert.doesNotMatch(h.visible(),/Working|Stale host|Late event/);h.manager.dispose();
  const restarted=fixture(2,h.local);restarted.manager.configurePreviewCache('vault',undefined,async()=>{});
  await start(restarted);restarted.manager.stream({request:record().request,messageId:id,sequence:200,body:'**T3 · Working**\n\n> After restart'});
  assert.doesNotMatch(restarted.visible(),/Working|spinner|After restart/);
  assert.equal(restarted.visible().includes('Latest partial reply'),!hidden);assert.equal(restarted.views[0].getViewData(),before);restarted.manager.dispose();
});

test('reply and presence updates leave unrelated native notes unread while a full refresh adopts their edits',async()=>{
 const h=fixture();let unrelated='Other ordinary text',reads=0;
 const otherView:any={file:{path:'Other.md'},getViewData:()=>{reads++;return unrelated;},setViewData:(text:string)=>{unrelated=text;},getMode:()=> 'preview'};
 h.open(otherView);await start(h);reads=0;
 h.manager.stream({request:record().request,messageId:id,sequence:12,body:'> New paragraph'});
 await h.manager.receive(record(id,2));assert.match(h.visible(),/New paragraph/);assert.equal(reads,0);
 unrelated='Other ordinary edit';h.manager.refresh();assert.ok(reads>0);assert.equal(unrelated,'Other ordinary edit');h.manager.dispose();
});

test('scoped stale lease updates still reach a renamed native pane and its second view',async()=>{
 const h=fixture(2);await start(h);h.file.path='Moved.md';h.manager.renamed('Note.md','Moved.md');
 const update=record(id,2);update.state!.body='> New host paragraph after rename';await h.manager.receive(update);
 assert.ok(h.views.every((_,i)=>h.visible(i).includes('New host paragraph after rename')));
 h.manager.stream({request:update.request,messageId:id,sequence:13,body:'> New direct paragraph after rename'});
 assert.ok(h.views.every((_,i)=>h.visible(i).includes('New direct paragraph after rename')));h.manager.dispose();
});
