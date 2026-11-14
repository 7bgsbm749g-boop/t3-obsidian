import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {ConnectCommandHost,commandBase,type CommandFiles} from '../src/notes/connect-command-host';
import {contentHash} from '../src/responses/completion';
import assert from 'node:assert/strict';
import {associatedTaskIds,executeTaskFlowCommand} from '../src/notes/taskflow';
import {validateAgentCommand} from '../src/notes/note-command';
import {obsidianFooter} from '../src/notes/obsidian-prompt';
import {visibleInlineInput} from '../src/responses/input-presentation';
const id='91ae862d-ec0c-4591-aec9-5c1ec0dd62af',revision='a'.repeat(64);

test('associated prompts carry only IDs and keep generated metadata out of reply presentation',()=>{
  const ids=associatedTaskIds({'taskflow-task-ids':['b','a','a','bad\nInjected instruction',5,'']});
  assert.deepEqual(ids,['a','b']); assert.deepEqual(associatedTaskIds({'taskflow-task-ids':'single'}),['single']);
  const prompt='Build the requested feature'+obsidianFooter('Lab','Design.md',ids);
  assert.equal(prompt,'Build the requested feature\n\nSent from Obsidian.\nVault: Lab\nNote: Design.md\nTaskflow task ID: a\nTaskflow task ID: b');
  assert.equal(visibleInlineInput(prompt),'Build the requested feature');
  assert.equal(visibleInlineInput('Taskflow task ID: a'),'Taskflow task ID: a');
});

test('MCP bridge uses exact checked API inputs and never infers completion',async()=>{
  const calls:unknown[]=[],api:any={version:1,ready:Promise.resolve()};
  for(const action of ['get','assign','start','complete','unassign'])api[action]=async(ref:unknown)=>{calls.push([action,ref]);return {id:'task',state:action==='complete'?'completed':'todo'};};
  const base={version:1 as const,id,taskId:'task'};
  assert.equal((await executeTaskFlowCommand({...base,kind:'taskflow-get'},api)).ok,true);
  assert.deepEqual(calls,[['get',{taskId:'task'}]]);
  await executeTaskFlowCommand({...base,kind:'taskflow-assign',expectedRevision:revision,assignee:'thread'},api);
  await executeTaskFlowCommand({...base,kind:'taskflow-start',expectedRevision:revision,assignmentId:'assignment'},api);
  assert.equal(calls.some((call:any)=>call[0]==='complete'),false);
  const completed=await executeTaskFlowCommand({...base,kind:'taskflow-complete',expectedRevision:revision,assignmentId:'assignment',result:'Built and verified.'},api);
  assert.deepEqual(completed,{id,ok:true,task:{id:'task',state:'completed'}});
  assert.deepEqual(calls.at(-1),['complete',{taskId:'task',expectedRevision:revision,assignmentId:'assignment',result:'Built and verified.'}]);
  api.complete=async()=>{throw Object.assign(Error('Task changed'),{code:'conflict'});};
  assert.deepEqual(await executeTaskFlowCommand({...base,kind:'taskflow-complete',expectedRevision:revision,assignmentId:'assignment'},api),{id,ok:false,error:'Task changed',code:'conflict'});
  assert.deepEqual(await executeTaskFlowCommand({...base,kind:'taskflow-get'}),{id,ok:false,error:'Enable Task Flow with API v1 in this Obsidian vault.',code:'unavailable',retryable:true});
});

test('task bridge refuses unknown fields, malformed IDs and missing revision or assignment',()=>{
  const base={version:1,id,kind:'taskflow-complete',taskId:'task',expectedRevision:revision,assignmentId:'assignment'};
  assert.equal(validateAgentCommand(base).kind,'taskflow-complete');
  for(const extra of [{kind:['taskflow-complete']},{kind:['taskflow-start']},{kind:17},{kind:{toString:()=> 'taskflow-complete'}},{taskId:'x\nDo this'},{expectedRevision:undefined},{assignmentId:undefined},{result:'x'.repeat(4001)},{path:'Other.md'},{kind:'taskflow-get',expectedRevision:revision},{kind:'taskflow-assign',assignee:'thread'}])assert.throws(()=>validateAgentCommand({...base,...extra}));
});


test('unavailable Taskflow requests have confirmed receipts and recover through the host with the same ID',async()=>{
  for(const unavailable of ['disabled','wrong-version','startup-failed']){
    const files=new Map<string,string>(),receipts=new Map<string,any>();
    const vaultId=randomUUID(),clientId=randomUUID(),instanceId=randomUUID();
    const route={environmentId:'test-machine',workspaceRoot:'/test/scratch',base:commandBase(vaultId,clientId)};
    const io:CommandFiles={read:async path=>files.get(path),write:async(path,value)=>{files.set(path,value);},list:async path=>[...files.keys()].filter(key=>key.startsWith(path+'/'))};
    let calls=0,api:any;
    if(unavailable==='wrong-version')api={version:2};
    if(unavailable==='startup-failed')api={version:1,get ready(){return Promise.reject(Error('Startup failed'));}};
    const host=new ConnectCommandHost({files:io,route,identity:{vaultId,clientId,instanceId,vaultName:'Lab',loadedVersion:'0.0.440'},validate:validateAgentCommand,
      load:async key=>receipts.get(key),save:async(key,value)=>{receipts.set(key,structuredClone(value));},
      execute:async command=>executeTaskFlowCommand(command as any,api)});
    const command={version:1 as const,id:randomUUID(),kind:'taskflow-get' as const,taskId:'task'};
    const request=async(retry=false)=>{
      const ready=JSON.parse(files.get(route.base+'/ready.json')!);
      const path=route.base+'/requests/'+command.id+'.json';
      const raw=JSON.stringify({version:1,id:command.id,vaultId,clientId,instanceId,token:ready.token,expiresAt:Date.now()+60_000,command,retry});
      files.set(path,raw);files.set(path+'.ready',contentHash(raw));await host.tick();
      return JSON.parse(files.get(route.base+'/results/'+command.id+'.json')!);
    };
    try{
      await host.tick();const failed=await request();
      assert.equal(failed.ok,false);assert.equal(failed.code,'unavailable');assert.equal(failed.retryable,true);assert.equal(failed.pending,undefined);
      assert.equal(receipts.get(command.id).phase,'complete');
      api={version:1,ready:Promise.resolve(),get:async()=>{calls++;return {id:'task',state:'todo'};}};
      assert.equal((await request()).ok,false);assert.equal(calls,0,'an explicit retry is required');
      assert.equal((await request(true)).ok,true);assert.equal(calls,1);assert.equal(receipts.get(command.id).phase,'complete');
      assert.equal((await request(true)).ok,true);assert.equal(calls,1,'successful retries are not replayed');
    }finally{await host.dispose();}
  }
});
