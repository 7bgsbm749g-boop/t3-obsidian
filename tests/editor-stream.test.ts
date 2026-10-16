import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {editorStream} from '../editor-stream';
import {initialRegion,inlineTargetAt,regionBody,completionProof,hasCompletionProof} from '../inline-thread';
import {validateNoteCommand} from '../note-command';
import type {ResponseRequest} from '../response-model';
import {eventContent} from '../event-subscriptions';
import {captureCursorInsertion} from '../cursor-insertion';
import {responseAnchor} from '../native-response-projection';

const source=():ResponseRequest=>({version:2,id:randomUUID(),initialOwner:randomUUID(),vaultId:'vault',host:{environmentId:'machine',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:'A.md',threadId:randomUUID(),messageId:randomUUID(),projectId:'project',threadEnvironmentId:'machine',initialHash:initialRegion(randomUUID()).bodyHash,createdAt:new Date().toISOString()});
test('native replies use the captured cursor, preserve both sides, and remain separate Markdown blocks',async()=>{
  for(const cursor of [0,3,'First paragraph.'.length,'First paragraph.\n'.length]){
    const original='First paragraph.\n\nLater paragraph.',insertion=captureCursorInsertion(original,cursor);
    let document=original;
    const request={...source(),nativeProjection:true,responseContainer:true},io={updateNote:async(_path:string,change:(current:string)=>string)=>document=change(document)};
    const binding=await editorStream(request,'A.md',io,()=>true,undefined,insertion),anchor=responseAnchor(binding.id),at=document.indexOf(anchor);
    assert.ok(at<document.indexOf('Later paragraph.'));
    if(cursor)assert.ok(at>document.indexOf('First paragraph.'));
    else assert.equal(at,0);
    const completed=document.replace(anchor,'Final answer.');
    assert.ok(!cursor||completed.includes('First paragraph.\n\nFinal answer.'));
    assert.ok(completed.includes(cursor?'Final answer.\n\nLater paragraph.':'Final answer.\n\nFirst paragraph.'));
    const once=document;await editorStream(request,'A.md',io,()=>true,undefined,insertion);assert.equal(document,once);
  }
});
test('an explicit destination section takes precedence over a cursor hint',async()=>{
  const original='Introduction.\n\n## Replies\n\nExisting material.\n\n## Later\n\nTail';let document=original;
  await editorStream({...source(),nativeProjection:true,destinationSection:'Replies'},'A.md',{updateNote:async(_path,change)=>document=change(document)},()=>true,undefined,captureCursorInsertion(original,0));
  assert.ok(document.indexOf('t3-inline:start:')>document.indexOf('Existing material.'));
  assert.ok(document.indexOf('t3-inline:start:')<document.indexOf('## Later'));
});
test('native section registration preserves the watcher baseline without adding ordinary blank lines',async()=>{
  const original='# Note\n\n## CURRENT\n\n## AFTER\n\nTail\n';let document=original;
  await editorStream({...source(),nativeProjection:true,destinationSection:'CURRENT'},'A.md',{updateNote:async(_path,change)=>document=change(document)},()=>true);
  assert.equal(eventContent(document),eventContent(original));
  assert.equal((document.match(/## AFTER/g)??[]).length,1);
});
test('bindings have independent destination IDs and retain one source message; replay never duplicates a block',async()=>{
  const documents=new Map([['A.md','Keep A'],['B.md','Keep B']]);
  const io={updateNote:async(path:string,change:(document:string)=>string,allowed:()=>boolean)=>{assert.ok(allowed());const value=documents.get(path);if(value===undefined)return;const next=change(value);documents.set(path,next);return next;}};
  const x={...source(),version:3 as const,finalAnswerFormat:'raw-markdown' as const},a=await editorStream(x,'A.md',io,()=>true),b=await editorStream(x,'B.md',io,()=>true);
  assert.notEqual(a.id,b.id);assert.notEqual(a.id,x.id);assert.equal(a.messageId,b.messageId);assert.equal(a.finalAnswerFormat,'raw-markdown');assert.equal(b.finalAnswerFormat,'raw-markdown');assert.equal(a.version,3);
  const before=documents.get('A.md');assert.deepEqual(await editorStream(x,'A.md',io,()=>true),a);assert.equal(documents.get('A.md'),before);
  const y=await editorStream(source(),'A.md',io,()=>true);assert.ok(regionBody(documents.get('A.md')!,a.id));assert.ok(regionBody(documents.get('A.md')!,y.id));
  await assert.rejects(editorStream(x,'../Outside.md',io,()=>true),/relative/);
});
test('cursor routing targets only its own block; completion proofs survive independent note changes',()=>{
  const a=initialRegion(randomUUID()),b=initialRegion(randomUUID());
  const aId=/start:([0-9a-f-]+)/.exec(a.text)![1],bId=/start:([0-9a-f-]+)/.exec(b.text)![1];
  const document='Outside\n'+a.text+'Middle\n'+b.text;
  assert.equal(inlineTargetAt(document,0),undefined);
  assert.equal(inlineTargetAt(document,regionBody(document,aId)!.from),aId);
  assert.equal(inlineTargetAt(document,regionBody(document,bId)!.from),bId);
  const finished=completionProof(aId,'Answer A');assert.ok(hasCompletionProof(finished+'\nChanged elsewhere',aId,'Answer A'));
  assert.equal(hasCompletionProof(finished.replace('Answer A','User edit'),aId,'Answer A'),false);
});
test('a completed binding receipt prevents reinsertion after cleanup and later user edits',async()=>{
  const x=source();let document='Source';
  const io={updateNote:async(_path:string,change:(current:string)=>string)=>document=change(document)};
  const binding=await editorStream(x,'A.md',io,()=>true);
  document='User changed the completed answer and surrounding note';
  const replay=await editorStream(x,'A.md',{...io,completed:async id=>id===binding.id},()=>true);
  assert.deepEqual(replay,binding);assert.equal(document,'User changed the completed answer and surrounding note');
});
test('agent commands reject path traversal, hidden notes, duplicate destinations, and ambiguous attachment',()=>{
  const command={version:1,id:randomUUID(),kind:'send-note',notePath:'A.md',destinations:['A.md','B.md'],streamReply:true};
  assert.equal(validateNoteCommand(command),command);
  for(const notePath of ['../A.md','/A.md','.obsidian/data.md','A\\B.md'])assert.throws(()=>validateNoteCommand({...command,notePath}));
  assert.throws(()=>validateNoteCommand({...command,destinations:['A.md','A.md']}));
  assert.throws(()=>validateNoteCommand({...command,streamReply:false}));
  assert.throws(()=>validateNoteCommand({...command,kind:'attach-response',threadId:'thread'}));
});
