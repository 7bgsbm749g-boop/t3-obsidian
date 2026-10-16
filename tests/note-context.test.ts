import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {noteContext,mergeNoteContexts,type NoteContextRecord} from '../note-context';
import {validateAgentCommand} from '../note-command';
import type {ResponseRequest} from '../response-model';

const record=():NoteContextRecord=>({messageId:randomUUID(),threadId:randomUUID(),projectId:randomUUID(),environmentId:'env',notePath:'Source.md',bindingIds:[randomUUID(),randomUUID()],waitForOtherThreads:true,createdAt:'2026-10-16T12:00:00Z'});
function bindings(send:NoteContextRecord):ResponseRequest[]{return send.bindingIds.map((id,i)=>({version:4,localOnly:true,nativeProjection:true,responseContainer:true,initialOwner:randomUUID(),id,vaultId:'vault',host:{environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:`Destination ${i}.md`,threadId:send.threadId,messageId:send.messageId,projectId:send.projectId,threadEnvironmentId:send.environmentId,initialHash:'a'.repeat(64),createdAt:send.createdAt}));}
const vault={name:'QLO2',id:'vault',workspaceRoot:'/vault'};

test('exact context lookup returns all mirrored destinations without exposing prompt or credentials',()=>{
  const send=record(),other=record(),all=bindings(send),before=JSON.stringify(all);
  const result=noteContext({version:1,id:randomUUID(),kind:'note-context',notePath:'Source.md',threadId:send.threadId,messageId:send.messageId},[other,send],all,vault);
  assert.deepEqual(result.context.destinations.map(item=>item.notePath),['Destination 0.md','Destination 1.md']);
  assert.equal(result.context.send.waitForOtherThreads,true);assert.equal(result.context.destinations[0].stagingSupported,true);
  assert.equal(JSON.stringify(all),before);assert.doesNotMatch(JSON.stringify(result),/initialHash|initialOwner|initialInput|token|prompt/);
});
test('note-only lookup refuses multiple sends and identity filters must all agree',()=>{
  const first=record(),second=record(),command={version:1 as const,id:randomUUID(),kind:'note-context' as const,notePath:'Source.md'};
  assert.throws(()=>noteContext(command,[first,second],[],vault),/Several sends/);
  for(const change of [{messageId:randomUUID()},{notePath:'Other.md'},{environmentId:'other'}])assert.throws(()=>noteContext({...command,threadId:first.threadId,...change},[first],bindings(first),vault),/No matching/);
  assert.throws(()=>noteContext({...command,messageId:first.messageId},[first],bindings(first).map(b=>({...b,vaultId:'foreign'})),vault),/unavailable/);
});
test('nonstream sends keep context without creating a destination and histories merge deterministically',()=>{
  const send={...record(),bindingIds:[]},other=record();
  assert.equal(noteContext({version:1,id:randomUUID(),kind:'note-context',messageId:send.messageId},[send],[],vault).context.destinations.length,0);
  assert.deepEqual(mergeNoteContexts([send],[other]),mergeNoteContexts([other],[send],[send]));
  const many=Array.from({length:300},(_,i)=>({...record(),createdAt:new Date(1700000000000+i*1000).toISOString()}));
  const retained=mergeNoteContexts(many,[{...send,notePath:'../outside.md'}]);assert.equal(retained.length,256);assert.equal(retained[0].messageId,many[44].messageId);
});
test('context command validation rejects traversal, missing selectors and malformed message IDs',()=>{
  const command={version:1,id:randomUUID(),kind:'note-context',notePath:'Task.md'};
  assert.deepEqual(validateAgentCommand(command),command);
  for(const change of [{notePath:'../outside.md'},{notePath:undefined},{messageId:'wrong'},{threadId:'bad\nidentity'}])assert.throws(()=>validateAgentCommand({...command,...change}),/context lookup/);
});
