import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {HostedInlineWriter,handoffInline,hostedPaths,hostedRequestHash,validateHostedRequest,type HostedInlineRequest,type HostedInlineState,type HostedWriterIO} from '../hosted-inline';
import {initialRegion,regionBody} from '../inline-thread';
import {contentHash} from '../completion';
import {commandId} from '../direct';

function harness(){
  const id=randomUUID(),initial=initialRegion(id),host={environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'};
  const request:HostedInlineRequest={version:1,id,vaultId:'vault',host,notePath:'Notes/test.md',threadId:randomUUID(),messageId:commandId(id,'message'),projectId:'project',threadEnvironmentId:'thread-machine',initialHash:initial.bodyHash,createdAt:new Date().toISOString()};
  const paths=hostedPaths(host.directory,id),files=new Map<string,string>([[paths.request,JSON.stringify(request)]]);
  let document:string|undefined='User introduction\n'+initial.text+'User tail',answer='Progress A',phase='running',dispatched=false,unsaved=false,crashAfterEdit=false,failState=false,accessible=true;
  const calls:any[]=[];
  const snapshot=()=>({thread:{id:request.threadId,projectId:request.projectId,messages:[{id:request.messageId,role:'user',text:'Question',streaming:false,createdAt:request.createdAt},{id:'answer',role:'assistant',text:answer,streaming:phase==='running',turnId:'turn'}],activities:[],latestTurn:{turnId:'turn',state:phase,requestedAt:request.createdAt,assistantMessageId:'answer'},session:{status:phase==='running'?'running':'ready',activeTurnId:phase==='running'?'turn':null}}});
  const io:HostedWriterIO={read:async path=>files.get(path),write:async(path,bytes)=>{if(failState)throw Error('disk unavailable');files.set(path,bytes);},requests:async()=>[paths.request],
    access:async environmentId=>{calls.push({access:environmentId});if(!accessible)throw Error('Host is not paired');return {origin:'https://t3.example',api:async(path,payload)=>{if(payload){calls.push(payload);return {};}if(!dispatched)throw Error('Thread is not dispatched yet');return snapshot();}};},
    updateNote:async(path,change)=>{assert.equal(path,request.notePath);if(document===undefined||unsaved)return undefined;const before=document;document=change(document);if(crashAfterEdit&&before!==document){failState=true;throw Error('simulated crash after note edit');}return document;},
  };
  const create=()=>new HostedInlineWriter({vaultId:request.vaultId,...host},io);
  return {request,paths,files,io,create,calls,get document(){return document!;},set document(value:string){document=value;},get state():HostedInlineState{return JSON.parse(files.get(paths.state)!);},
    dispatch:()=>{dispatched=true;},answer:(text:string,complete=false)=>{answer=text;phase=complete?'completed':'running';},missing:()=>{document=undefined;},unsaved:(value:boolean)=>{unsaved=value;},access:(value:boolean)=>{accessible=value;},crash:(value:boolean)=>{crashAfterEdit=value;if(!value)failState=false;}};
}

test('handoff waits for a saved synced anchor and host-owned access before dispatch',async()=>{
  const h=harness(),writer=h.create();h.unsaved(true);
  await writer.tick();assert.equal(h.state.accepted,false);
  h.unsaved(false);h.access(false);await writer.tick();assert.equal(h.state.accepted,false);
  h.access(true);
  await handoffInline(h.io,h.request,()=>true,async()=>writer.tick());
  assert.equal(h.state.accepted,true);assert.equal(h.state.status,'waiting');
  assert.equal(h.calls.at(-1).access,'thread-machine');
  assert.equal(regionBody(h.document,h.request.id)?.body,'**T3 · Sending…**');
});

test('host continues after sender disappears, handles outside edits and known Sync rollbacks, and finalizes a closed note',async()=>{
  const h=harness();await h.create().tick();h.dispatch();
  await h.create().tick();assert.match(h.document,/Progress A/);
  const earlier=h.document;
  h.document='New outside paragraph\n'+h.document;
  h.answer('Progress A and B');await h.create().tick();assert.match(h.document,/New outside paragraph/);assert.match(h.document,/and B/);
  h.document='Another outside edit\n'+earlier;h.answer('Final answer',true);
  await h.create().tick();assert.equal(h.state.status,'complete');
  assert.match(h.document,/Another outside edit\nUser introduction/);assert.match(h.document,/> Final answer/);assert.match(h.document,/User tail/);assert.doesNotMatch(h.document,/t3-inline:/);
  const finished=h.document;await h.create().tick();assert.equal(h.document,finished);
});

test('editing generated text preserves the edit and stops only that writer',async()=>{
  const h=harness();h.dispatch();const writer=h.create();await writer.tick();
  h.document=h.document.replace('Progress A','My correction');h.answer('Progress B');await writer.tick();
  assert.equal(h.state.status,'conflict');assert.match(h.document,/My correction/);assert.doesNotMatch(h.document,/Progress B/);
  await h.create().tick();assert.match(h.document,/My correction/);
});

for(const complete of [false,true])test(`write-ahead recovery survives a crash after ${complete?'final':'progress'} insertion`,async()=>{
  const h=harness();h.dispatch();await h.create().tick();h.answer('New answer',complete);h.crash(true);
  await assert.rejects(h.create().tick(),/disk unavailable/);assert.match(h.document,/New answer/);
  h.crash(false);await h.create().tick();
  assert.equal(h.state.status,complete?'complete':'running');assert.equal((h.document.match(/New answer/g)??[]).length,1);
});

test('remote Stop interrupts the bound turn with one stable command and writes interrupted status',async()=>{
  const h=harness();h.dispatch();const writer=h.create();await writer.tick();
  h.files.set(h.paths.stop,'{}');await writer.tick();await writer.tick();
  assert.equal(h.state.status,'interrupted');assert.match(h.document,/T3 · Interrupted/);
  const interrupts=h.calls.filter(call=>call.type==='thread.turn.interrupt');assert.equal(interrupts.length,1);assert.equal(interrupts[0].turnId,'turn');assert.equal(interrupts[0].commandId,commandId(h.request.id,'interrupt'));
});

test('handoff is immutable and the wrong machine cannot claim a synced request',async()=>{
  const h=harness();
  await new HostedInlineWriter({vaultId:'vault',environmentId:'another',workspaceRoot:'/vault',directory:h.request.host.directory},h.io).tick();
  assert.equal(h.files.has(h.paths.state),false);
  await assert.rejects(handoffInline(h.io,{...h.request,notePath:'Other.md'},()=>true,async()=>{}),/different hosted job/);
  await assert.rejects(handoffInline(h.io,h.request,()=>true,async()=>{}),/not accepted/);
  assert.equal(h.files.get(h.paths.request),JSON.stringify(h.request));
  assert.throws(()=>validateHostedRequest({...h.request,notePath:'../secret.md'}),/Invalid/);
});

test('a handoff acknowledgement belongs to the exact request',async()=>{
  const h=harness();await h.create().tick();assert.equal(h.state.requestHash,hostedRequestHash(h.request));
  h.files.set(h.paths.state,JSON.stringify({...h.state,requestHash:contentHash('different')}));
  await assert.rejects(handoffInline(h.io,h.request),/different response job/);
});
