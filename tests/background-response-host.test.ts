import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {BackgroundResponseHost} from '../response-host-background';
import {ensurePrivateStorage} from '../private-storage-desktop';
import {localInlineFiles} from '../inline-host-storage-desktop';
import {InlineLeaseClient,leasePaths} from '../inline-lease';
import {responseAnchor} from '../native-response-projection';
import {prepareSendGuard,updateSendGuard,sendGuardPath} from '../send-response-guard';
import type {HostedInlineRequest} from '../hosted-inline';
import {editorStream} from '../editor-stream';
import {backgroundNoteSend} from '../background-note-send';
import {commandId} from '../direct';
import {removeFailedResponse} from '../failed-response-cleanup';
import {initialRegion} from '../inline-thread';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'background-response-')),vault=join(root,'vault');await mkdir(vault);
 const identity={vaultId:randomUUID(),environmentId:'local-test',workspaceRoot:vault,directory:'.obsidian/t3-code/inline/v1'},actor=randomUUID(),id=randomUUID(),messageId=randomUUID();
 const request:HostedInlineRequest={version:4,independent:true,nativeProjection:true,responseContainer:true,id,initialOwner:actor,vaultId:identity.vaultId,host:identity,notePath:'Note.md',threadId:randomUUID(),messageId,projectId:randomUUID(),threadEnvironmentId:identity.environmentId,initialHash:'0'.repeat(64),createdAt:new Date().toISOString()};
 const original=`# Synthetic task\n\n${responseAnchor(id)}\n\nKeep ordinary text.\n`;await writeFile(join(vault,'Note.md'),original);
 const route=await ensurePrivateStorage(vault,'.obsidian',{storageRoot:join(root,'private')}),files=localInlineFiles(vault,identity.directory,route.storageRoot);
 let accepted=true,complete=true;
 const access=async()=>({origin:'https://synthetic.invalid',api:async()=>{
  if(!accepted){const error:any=Error('Not found');error.status=404;throw error;}
  return {snapshotSequence:2,thread:{id:request.threadId,projectId:request.projectId,messages:[{id:messageId,role:'user',text:'Synthetic task',streaming:false,createdAt:request.createdAt},{id:'answer',role:'assistant',text:'Verified final reply.',turnId:'turn',streaming:!complete}],activities:[],latestTurn:{turnId:'turn',messageId,state:complete?'completed':'running',requestedAt:request.createdAt,assistantMessageId:'answer'},session:{status:complete?'ready':'running',activeTurnId:complete?null:'turn'}}};
 }});
 const open=()=>BackgroundResponseHost.open(identity,{access,journalRoot:join(root,'journal'),timers:false});
 let host=await open();const client=new InlineLeaseClient(actor,{...files,dispatch:command=>host.dispatch(command)},identity.directory);
 return {root,vault,identity,actor,request,original,files,client,get host(){return host;},setAccepted:(value:boolean)=>{accepted=value;},setComplete:(value:boolean)=>{complete=value;},restart:async()=>{await host.dispose();host=await open();},close:async()=>{client.dispose();await host.dispose();await files.close?.();await rm(root,{recursive:true,force:true});}};
}

test('background host registers and saves the final reply through real files without an Obsidian app',async()=>{
 const h=await fixture();try{
  await prepareSendGuard(h.files,h.request);assert.equal((await h.client.command({kind:'register',jobId:h.request.id,request:h.request})).ok,true);
  await updateSendGuard(h.files,h.request,'accepted');
  for(let n=0;n<5;n++)await h.host.tick();
  const saved=await readFile(join(h.vault,'Note.md'),'utf8'),record=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.request.id).record))!);
  assert.match(saved,/Verified final reply/);assert.match(saved,/Keep ordinary text/);assert.doesNotMatch(saved,/send-to-t3-response|t3-(inline|response):/);
  assert.equal(record.state.finalSaved,true);assert.equal(record.state.cleanupComplete,true);
  await h.restart();for(let n=0;n<3;n++)await h.host.tick();assert.equal(await readFile(join(h.vault,'Note.md'),'utf8'),saved);
 }finally{await h.close();}
});

test('failed send cleanup survives a service restart and preserves ordinary text and other responses',async()=>{
 const h=await fixture();try{
  const other=randomUUID(),note=h.original+'Later user text.\n'+responseAnchor(other)+'\n';await writeFile(join(h.vault,'Note.md'),note);
  await prepareSendGuard(h.files,h.request);await updateSendGuard(h.files,h.request,'failed');
  await h.restart();await h.host.tick();
  const saved=await readFile(join(h.vault,'Note.md'),'utf8');assert.doesNotMatch(saved,new RegExp(h.request.id));assert.match(saved,/Later user text/);assert.ok(saved.includes(other));
  assert.equal(JSON.parse((await h.files.read(sendGuardPath(h.request)))!).status,'cleaned');
  await writeFile(join(h.vault,'Note.md'),note+'Text added after a stale Sync echo.\n');await h.host.tick();
  const recovered=await readFile(join(h.vault,'Note.md'),'utf8');assert.doesNotMatch(recovered,new RegExp(h.request.id));assert.match(recovered,/Text added after a stale Sync echo/);assert.ok(recovered.includes(other));
 }finally{await h.close();}
});

test('a registered failure cannot recreate its tags after cleanup and host recovery',async()=>{
 const h=await fixture();try{
  h.setAccepted(false);await prepareSendGuard(h.files,h.request);await h.client.command({kind:'register',jobId:h.request.id,request:h.request});
  await updateSendGuard(h.files,h.request,'failed');await h.files.write(`${h.identity.directory}/stops/${h.request.id}.json`,JSON.stringify({id:h.request.id,discardResponse:true,requestedAt:new Date().toISOString()}));
  for(let n=0;n<4;n++)await h.host.tick();await h.restart();for(let n=0;n<4;n++)await h.host.tick();
  const saved=await readFile(join(h.vault,'Note.md'),'utf8');assert.doesNotMatch(saved,new RegExp(h.request.id));assert.match(saved,/Keep ordinary text/);
 }finally{await h.close();}
});

test('a lost send acknowledgement preserves an accepted message and cleans a confirmed absent message',async()=>{
 for(const accepted of [true,false]){
  const h=await fixture();try{
   h.setAccepted(accepted);await prepareSendGuard(h.files,h.request);await updateSendGuard(h.files,h.request,'failed',true);await h.host.tick();
   const guard=JSON.parse((await h.files.read(sendGuardPath(h.request)))!),saved=await readFile(join(h.vault,'Note.md'),'utf8');
   assert.equal(guard.status,accepted?'accepted':'cleaned');assert.equal(saved.includes(h.request.id),accepted);
  }finally{await h.close();}
 }
});

test('response insertion cannot precede its durable guard and a guard failure leaves no tags',async()=>{
 const h=await fixture();try{
  let note='Keep the original note.\n',guardSaved=false;
  await editorStream(h.request,h.request.notePath,{beforeInsert:async request=>{await prepareSendGuard(h.files,request);guardSaved=true;},updateNote:async(_path,change)=>{assert.equal(guardSaved,true);note=change(note);return note;}},()=>true);
  assert.match(note,/send-to-t3-response/);
  const before='Unaffected text.\n';note=before;
  await assert.rejects(editorStream({...h.request,id:randomUUID()},h.request.notePath,{beforeInsert:async()=>{throw Error('Persistent storage failed');},updateNote:async(_path,change)=>{note=change(note);return note;}},()=>true),/Persistent storage failed/);
  assert.equal(note,before);
 }finally{await h.close();}
});

test('background note commands freeze their prompt and replay the result without a second send or shared settings write',async()=>{
 const h=await fixture();try{
  const config=join(h.vault,'.obsidian/plugins/send-to-t3-code');await mkdir(config,{recursive:true});
  const data=JSON.stringify({vaultId:h.identity.vaultId,folderLinks:[{id:randomUUID(),folderPath:'/',projectId:h.request.projectId,projectTitle:'Synthetic',workspaceRoot:h.vault,connectionId:'',environmentId:h.identity.environmentId,self:true}],inlineStreaming:{enabled:true}});
  await writeFile(join(config,'data.json'),data);await writeFile(join(h.vault,'Note.md'),'Use this exact synthetic note.\n');
  const command={version:1 as const,id:randomUUID(),kind:'send-note' as const,notePath:'Note.md',destinations:[],streamReply:true};let sends=0;
  const io={readNote:async(path:string)=>readFile(join(h.vault,path),'utf8'),updateNote:async(path:string,change:(value:string)=>string)=>{const value=change(await readFile(join(h.vault,path),'utf8'));await writeFile(join(h.vault,path),value);return value;},register:async()=>{},send:async(request:any)=>{sends++;assert.ok(request.prompt.startsWith('Use this exact synthetic note.'));request.acceptedThreadId=commandId(command.id,'thread');return {threadId:request.acceptedThreadId};}};
  const first=await backgroundNoteSend(command,h.identity,h.files,io);await writeFile(join(h.vault,'Note.md'),'Later user text.\n');
  assert.deepEqual(await backgroundNoteSend(command,h.identity,h.files,io),first);assert.equal(sends,1);assert.equal(await readFile(join(config,'data.json'),'utf8'),data);
  await assert.rejects(backgroundNoteSend({...command,notePath:'Other.md'},h.identity,h.files,io),/another note send/);
 }finally{await h.close();}
});

test('confirmed failure cleanup removes duplicate tags and initial live controls while retaining prose',()=>{
 const id=randomUUID(),other=randomUUID(),initial=initialRegion(id).text;
 const saved=removeFailedResponse('Ordinary start\n'+initial+'User text between copies\n'+initial+'\n'+responseAnchor(other)+'Ordinary tail',id);
 assert.doesNotMatch(saved,new RegExp(id));assert.doesNotMatch(saved,/Working|spinner/);assert.match(saved,/User text between copies/);assert.ok(saved.includes(other));assert.match(saved,/Ordinary tail/);
 const single=removeFailedResponse(initial,id);assert.doesNotMatch(single,/Working|spinner|t3-inline:/);
});
