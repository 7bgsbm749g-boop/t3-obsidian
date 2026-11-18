import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changeInboxThreads,inboxThreadTargets,type InboxThreadTarget} from '../src/notes/note-inbox-threads';
import type {InboxNote} from '../src/notes/note-inbox';
import type {ResponseRequest} from '../src/responses/response-model';
import type {NormalizedThread} from '../src/connection/wire-types';
import type {ThreadAccess} from '../src/conversations/thread-stream';
const target=(environmentId='one',threadId='thread'):InboxThreadTarget=>({environmentId,threadId,projectId:'project'});
function fixture(){
 const calls:any[]=[],closed:string[]=[],threads=new Map<string,NormalizedThread>();let serial=0;
 for(const env of ['one','two'])threads.set(env,{id:'thread',projectId:'project',messages:[],activities:[],session:{status:'ready',activeTurnId:null}});
 const access=async(env:string):Promise<ThreadAccess>=>({origin:'http://synthetic',close:()=>{closed.push(env);},api:async(path,body)=>{calls.push({env,path,body});if(body)return {};return {thread:threads.get(env)};}});
 return {access,calls,closed,threads,run:(targets=[target()],settled=true,check=()=>{})=>changeInboxThreads(targets,settled,access,check,()=>`command-${++serial}`),commands:()=>calls.filter(call=>call.body)};
}
test('all stream destinations retain their original machine; duplicate threads settle once',()=>{
 const note={ids:['a','b','c']} as InboxNote,bindings=[{id:'a',threadEnvironmentId:'one',projectId:'project',threadId:'thread'},{id:'b',threadEnvironmentId:'one',projectId:'project',threadId:'thread'}] as ResponseRequest[];
 assert.deepEqual(inboxThreadTargets(note,bindings,[{id:'c',completion:{...target('two'),runId:'run'}} as any]),[target(),target('two')]);
 assert.throws(()=>inboxThreadTargets(note,bindings,[]),/unavailable/);
});
test('settle preflights every exact thread and dispatches stock commands; reopening sends the user reason',async()=>{
 const f=fixture();await f.run([target(),target('two')]);assert.deepEqual(f.calls.map(call=>call.body?.type??'read'),['read','read','thread.settle','thread.settle']);assert.deepEqual(f.closed,['one','two']);
 assert.deepEqual(f.commands().map(call=>call.body.threadId),['thread','thread']);await f.run([target()],false);assert.equal(f.commands().at(-1).body.type,'thread.unsettle');assert.equal(f.commands().at(-1).body.reason,'user');
});
test('unreachable, mismatched or busy targets block all commands and release borrowed connections',async()=>{
 for(const patch of [{projectId:'wrong'},{session:{status:'running',activeTurnId:'run'}},{hasPendingUserInput:true}]){
  const f=fixture();Object.assign(f.threads.get('two')!,patch);await assert.rejects(f.run([target(),target('two')]));assert.equal(f.commands().length,0);assert.deepEqual(f.closed,['one','two']);
 }
 const f=fixture();f.threads.delete('two');await assert.rejects(f.run([target(),target('two')]));assert.equal(f.commands().length,0);
});
test('parked threads are preserved; an already settled thread is not settled again',async()=>{
 const f=fixture();f.threads.get('one')!.settledOverride='settled';f.threads.get('two')!.archivedAt='today';await f.run([target(),target('two')]);assert.equal(f.commands().length,0);
});
test('a changed note cancels dispatch and a rejected command propagates without leaking its connection',async()=>{
 const f=fixture();let checks=0;await assert.rejects(f.run([target()],true,()=>{if(++checks===3)throw Error('note changed');}),/note changed/);assert.equal(f.commands().length,0);assert.deepEqual(f.closed,['one']);
 const closed:string[]=[];await assert.rejects(changeInboxThreads([target()],true,async()=>({origin:'http://synthetic',close:()=>{closed.push('one');},api:async(_path,body)=>{if(body)throw Error('permission denied');return {thread:f.threads.get('one')};}}),()=>{},()=>''),/permission denied/);assert.deepEqual(closed,['one']);
});
