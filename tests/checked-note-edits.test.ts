import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CheckedNoteEdits,checkedStageDraft,type EditSnapshot,type CheckedStage} from '../src/notes/checked-note-edits';
import {commandBase} from '../src/notes/connect-command-host';
import {responseAnchor} from '../src/responses/native-response-projection';
import type {ResponseRequest} from '../src/responses/response-model';
import {contentHash} from '../src/responses/completion';
function fixture(active=true){
 const id=randomUUID(),snapshots=new Map<string,EditSnapshot>(),payloads=new Map<string,string>();let document='Title\n\n'+(active?responseAnchor(id)+'\n\n':'')+'User tail\n',binding:ResponseRequest|undefined=active?{id,notePath:'Note.md'} as ResponseRequest:undefined,failCommit=false,fastSave=false;
 const files={read:async(path:string)=>payloads.get(path),write:async(path:string,text:string)=>{payloads.set(path,text);},list:async()=>[]};
 const route={environmentId:'machine',workspaceRoot:'/scratch',base:commandBase(randomUUID(),randomUUID())};
 const service=new CheckedNoteEdits({load:async id=>structuredClone(snapshots.get(id)),save:async value=>{snapshots.set(value.editId,structuredClone(value));},read:async()=>document,binding:()=>binding,files:async()=>files,
 attach:async(_binding,stage,attached)=>{binding={...binding!,localStage:stage};await attached();assert.equal(snapshots.get(stage.editId!)?.status,'submitted','persist the submission before final save can run');if(fastSave)snapshots.set(stage.editId!,{...snapshots.get(stage.editId!)!,status:'saved'});},detach:async(_binding,editId,hash,detached)=>{assert.equal(binding?.localStage?.editId,editId);assert.equal(contentHash(document),hash);binding={...binding!,localStage:undefined};await detached();},commit:async(_path,before,after)=>{if(failCommit||document!==before)return false;document=after;return true;},now:()=>100});
 const prepare=()=>service.execute({version:1,id:randomUUID(),kind:'prepare-note-edit',notePath:'Note.md',...(active?{bindingId:id}:{})},route);
 const submit=(snapshot:any,proposed:string)=>service.execute({version:1,id:randomUUID(),kind:'submit-note-edit',editId:snapshot.editId,originalHash:snapshot.originalHash,proposed},route);
 return {id,service,prepare,submit,files,route,payloads,snapshots,get binding(){return binding;},get document(){return document;},setDocument:(value:string)=>document=value,finish:()=>binding=undefined,failCommit:()=>failCommit=true,fastSave:()=>fastSave=true};
}
test('a streaming proposal stays out of the note until the existing final writer merges it',async()=>{
 const f=fixture(),snapshot=await f.prepare(),original=f.document,proposal=original.replace('Title','Agent title');await f.submit(snapshot,proposal);assert.equal(f.document,original);assert.equal(f.snapshots.get(String(snapshot.editId))?.status,'submitted');
 f.setDocument(original.replace('User tail','User changed tail'));const draft=await checkedStageDraft(f.document,f.binding!,f.files);assert.match(draft,/Agent title/);assert.match(draft,/User changed tail/);assert.ok(draft.includes(responseAnchor(f.id)));
 const replay=await f.submit(snapshot,proposal);assert.equal(replay.status,'submitted');await assert.rejects(f.submit(snapshot,proposal+'Different'),/different content/);
});
test('response boundaries, original checksums, finished replies and concurrent conflicts are protected',async()=>{
 const f=fixture(),snapshot=await f.prepare(),original=f.document;
 await assert.rejects(f.submit(snapshot,original.replace(responseAnchor(f.id),'')),/boundaries/);
 await assert.rejects(f.submit({...snapshot,originalHash:'f'.repeat(64)},original),/checksum/);
 f.setDocument(original.replace('Title','User title'));await assert.rejects(f.submit(snapshot,original.replace('Title','Agent title')),/conflict|overlap|changed/i);
 f.setDocument(original);f.finish();await assert.rejects(f.submit(snapshot,original.replace('Title','Agent title')),/finished|moved/);assert.equal(f.document,original);
});
test('ordinary notes use a checked native save; an intervening reply or changed write never gets overwritten',async()=>{
 const f=fixture(false),snapshot=await f.prepare();f.setDocument(f.document.replace('User tail','Typed tail'));const saved=await f.submit(snapshot,String(snapshot.original).replace('Title','Agent title'));assert.equal(saved.status,'saved');assert.match(f.document,/Agent title/);assert.match(f.document,/Typed tail/);
 const next=await f.prepare();f.failCommit();await assert.rejects(f.submit(next,f.document+'More'),/changed before saving/);
 const other=fixture(false),prepared=await other.prepare();other.setDocument(other.document+'\n'+responseAnchor(randomUUID()));await assert.rejects(other.submit(prepared,String(prepared.original)+'More'),/reply started/);
});
test('missing or changed proposal chunks cannot reach a final save',async()=>{
 const f=fixture(),snapshot=await f.prepare();await f.submit(snapshot,f.document.replace('Title','Agent title'));const key=[...f.payloads.keys()].find(key=>key.endsWith('.proposed.md'))!;f.payloads.set(key,'tampered');await assert.rejects(checkedStageDraft(f.document,f.binding!,f.files),/changed/);
});
test('withdrawing a conflicting proposal requires the reviewed note hash and never rewrites content',async()=>{
 const f=fixture(),snapshot=await f.prepare();await f.submit(snapshot,f.document.replace('Title','Agent title'));f.setDocument(f.document.replace('Title','User title'));
 const status=await f.service.execute({version:1,id:randomUUID(),kind:'note-edit-status',editId:snapshot.editId},f.route),before=f.document;
 const cancel={version:1,id:randomUUID(),kind:'cancel-note-edit',editId:snapshot.editId,hash:status.currentHash};
 await assert.rejects(f.service.execute({...cancel,hash:'a'.repeat(64)},f.route),/changed/);assert.ok(f.binding?.localStage);
 assert.equal((await f.service.execute(cancel,f.route)).status,'cancelled');assert.equal(f.binding?.localStage,undefined);assert.equal(f.document,before);
 await assert.rejects(f.submit(snapshot,before),/withdrawn/);
 const ordinary=fixture(false),prepared=await ordinary.prepare();await ordinary.submit(prepared,ordinary.document+'Saved');await assert.rejects(ordinary.service.execute({...cancel,editId:prepared.editId,hash:contentHash(ordinary.document)},ordinary.route),/already saved/);
});
test('new notes and moves use native ports with exact paths and reviewed content hashes',async()=>{
 const calls:unknown[]=[],service=new CheckedNoteEdits({load:async()=>undefined,save:async()=>{},read:async()=>undefined,binding:()=>undefined,files:async()=>{throw Error('No transport payload is needed');},attach:async()=>{},commit:async()=>false,create:async(path,content)=>{calls.push({path,content});},rename:async(path,destination,expectedHash)=>{calls.push({path,destination,expectedHash});}}),route={environmentId:'machine',workspaceRoot:'/scratch',base:commandBase(randomUUID(),randomUUID())};
 const create={version:1,id:randomUUID(),kind:'create-note',notePath:'Draft/New.md',proposed:'# New note\n'};assert.equal((await service.execute(create,route)).status,'saved');await assert.rejects(service.execute({...create,notePath:'../Outside.md'},route));await assert.rejects(service.execute({...create,proposed:responseAnchor(randomUUID())},route));
 const rename={version:1,id:randomUUID(),kind:'rename-note',notePath:'Draft/New.md',destination:'Settled/0.0.398 New.md',originalHash:'a'.repeat(64)};assert.equal((await service.execute(rename,route)).notePath,rename.destination);assert.equal(calls.length,2);await assert.rejects(service.execute({...rename,originalHash:'invalid'},route));
});

test('a fast final writer cannot have its saved receipt replaced by the earlier submission',async()=>{
 const f=fixture(),snapshot=await f.prepare();f.fastSave();await f.submit(snapshot,f.document.replace('Title','Agent title'));assert.equal(f.snapshots.get(String(snapshot.editId))?.status,'saved');
});
