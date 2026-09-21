import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FolderWorkflowService,loadWorkflows,normalizeWorkflow,reorderFolderWorkflows,workflowForPath,workflowsForPath,type FolderWorkflow,type WorkflowHost,type WorkflowRun} from '../workflow';

const wait=(ms=25)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean){for(let n=0;n<100&&!check();n++)await wait(5);assert.ok(check(),'event did not finish');}
function rule(overrides:Partial<FolderWorkflow>={}):FolderWorkflow{return {id:'workflow',name:'Format',folderPath:'Gym',includeSubfolders:true,events:['create'],task:'Format this workout.',connectionId:'machine',projectId:'project',deviceId:'device',enabled:true,...overrides};}
function fixture(workflows=[rule()]){
  const notes=new Map([['Gym/today.md',{path:'Gym/today.md',content:'squats 5x5',mtime:1}]]),runs:WorkflowRun[]=[],sent:any[]=[],reports:string[]=[];let saved=0,status:'wait'|'complete'|'failed'='wait',now=1_000_000,stopped=false;
  const host:WorkflowHost={deviceId:'device',getWorkflows:()=>workflows,getRuns:()=>runs,read:async path=>notes.get(path),save:async()=>{saved++;},send:async(note,workflow,requestId,inputHash)=>{assert.ok(saved>0);sent.push({note,workflow,requestId,inputHash});return {threadId:'thread'};},status:async()=>status,isStopped:()=>stopped,report:text=>reports.push(text),now:()=>now,id:(()=>{let id=0;return()=>`id-${++id}`;})()};
  const service=new FolderWorkflowService(host,5,5);return {host,service,workflows,notes,runs,sent,reports,saved:()=>saved,setStatus:(value:typeof status)=>status=value,setNow:(value:number)=>now=value,stop:()=>{stopped=true;service.stop();}};
}

test('workflow settings validate and malformed synced records remain inert',()=>{
  assert.deepEqual(normalizeWorkflow(rule({events:['create','create','modify']})).events,['create','modify']);
  assert.throws(()=>normalizeWorkflow(rule({task:''})),/Complete/);
  assert.throws(()=>normalizeWorkflow(rule({folderPath:'../Gym'})),/Complete/);
  assert.deepEqual(loadWorkflows({folderWorkflows:[rule(),{bad:true}]}),[rule()]);
});

test('the most specific workflow owns a subtree and a disabled nested rule shields its parent',()=>{
  const parent=rule(),nested=rule({id:'nested',folderPath:'Gym/Private',enabled:false});
  assert.equal(workflowForPath([parent,nested],'Gym/Private/note.md','create','device'),undefined);
  nested.enabled=true;assert.equal(workflowForPath([parent,nested],'Gym/Private/note.md','create','device')?.id,'nested');
  nested.includeSubfolders=false;assert.equal(workflowForPath([parent,nested],'Gym/Private/Deep/note.md','create','device')?.id,'workflow');
});

test('all eligible workflows on the most-specific folder are returned in saved order',()=>{
  const first=rule({id:'first'}),second=rule({id:'second'}),parent=rule({id:'parent',folderPath:'/'}),otherDevice=rule({id:'other',deviceId:'other'});
  assert.deepEqual(workflowsForPath([parent,first,second,otherDevice],'Gym/today.md','create','device').map(item=>item.id),['first','second']);
});

test('reordering preserves definitions, paused workflows, and unrelated folder slots',()=>{
  const first=rule({id:'first'}),paused=rule({id:'paused',enabled:false,deviceId:'other'}),last=rule({id:'last'}),other=rule({id:'other',folderPath:'Other'});
  const original=[first,other,paused,last],next=reorderFolderWorkflows(original,'Gym',['last','paused','first'],['first','paused','last']);
  assert.deepEqual(next,[last,other,paused,first]);assert.equal(next[1],other);assert.equal(next[2],paused);
  assert.deepEqual(original,[first,other,paused,last]);
  assert.deepEqual(workflowsForPath(next,'Gym/today.md','create','device').map(item=>item.id),['last','first']);
  for(const ids of [['first'],['first','first','last'],['first','other','last']])assert.throws(()=>reorderFolderWorkflows(original,'Gym',ids,['first','paused','last']),/invalid/);
  assert.throws(()=>reorderFolderWorkflows(original,'Gym',['last','paused','first'],['paused','first','last']),/changed/);
});

test('a saved reorder affects future batches but never changes a queued batch sequence',async()=>{
  const f=fixture([rule({id:'first'}),rule({id:'second'})]);
  try{
    f.service.schedule('Gym/today.md','create');await until(()=>f.sent.length===1);
    f.workflows.reverse();f.setStatus('complete');await f.service.poll();await until(()=>f.sent.length===2);
    assert.deepEqual(f.sent.map(item=>item.workflow.id),['first','second']);
    f.notes.set('Gym/next.md',{path:'Gym/next.md',content:'next workout',mtime:2});f.service.schedule('Gym/next.md','create');await until(()=>f.sent.length===3);
    assert.equal(f.sent[2].workflow.id,'second');
  }finally{f.stop();}
});

test('create and initial typing events debounce into one durable dispatch',async()=>{
  const f=fixture();f.service.schedule('Gym/today.md','create');
  f.notes.get('Gym/today.md')!.content='squats 5x5\nbench 3x5';f.service.schedule('Gym/today.md','modify');
  await until(()=>f.sent.length===1);assert.equal(f.runs.length,1);assert.equal(f.runs[0].state,'running');assert.equal(f.sent[0].note.content,'squats 5x5\nbench 3x5');f.stop();
});

test('intent is saved first, a pre-dispatch edit is not sent, and it debounces again',async()=>{
  const f=fixture();let release!:()=>void;f.host.save=()=>new Promise<void>(resolve=>{release=resolve;});
  f.service.schedule('Gym/today.md','create');await until(()=>Boolean(release));f.notes.get('Gym/today.md')!.content='newer';f.host.save=async()=>{};release();
  await until(()=>f.runs[0]?.state==='failed');assert.equal(f.sent.length,0);f.stop();
});

test('completion settles to an output hash and its modify event cannot loop',async()=>{
  const f=fixture([rule({events:['create','modify']})]);f.service.schedule('Gym/today.md','create');await until(()=>f.sent.length===1);
  f.notes.get('Gym/today.md')!.content='# Workout\n\n- Squats: 5x5';f.service.schedule('Gym/today.md','modify');f.setStatus('complete');await f.service.poll();await until(()=>f.runs[0]?.state==='completed');
  const output=f.runs[0].outputHash;assert.ok(output);f.service.schedule('Gym/today.md','modify');await wait();assert.equal(f.sent.length,1);f.stop();
});

test('multiple matching workflows form a durable serialized batch and consume settled output in order',async()=>{
  const first=rule({id:'first',name:'First'}),second=rule({id:'second',name:'Second'}),f=fixture([first,second]);
  f.service.schedule('Gym/today.md','create');await until(()=>f.sent.length===1);
  assert.equal(f.sent[0].workflow.id,'first');assert.equal(f.runs.length,2);assert.equal(f.runs[1].state,'queued');assert.equal(f.runs[0].batchId,f.runs[1].batchId);
  f.notes.get('Gym/today.md')!.content='first output';f.service.schedule('Gym/today.md','modify');f.setStatus('complete');await f.service.poll();await until(()=>f.sent.length===2);
  assert.equal(f.sent[1].workflow.id,'second');assert.equal(f.sent[1].note.content,'first output');assert.equal(f.runs[0].state,'completed');assert.equal(f.runs[1].state,'running');
  f.notes.get('Gym/today.md')!.content='final output';f.service.schedule('Gym/today.md','modify');await f.service.poll();await until(()=>f.runs[1].state==='completed');
  assert.equal(f.runs[0].outputHash,f.runs[1].outputHash,'the final batch hash suppresses every member');
  f.service.schedule('Gym/today.md','create');await wait();assert.equal(f.sent.length,2,'the batch output must not restart the first workflow');f.stop();
});

test('a failed workflow blocks later workflows in its batch',async()=>{
  const f=fixture([rule({id:'first'}),rule({id:'second'})]);f.host.send=async()=>{throw Error('offline');};
  f.service.schedule('Gym/today.md','create');await until(()=>f.runs[0]?.state==='failed');
  assert.equal(f.runs[1].state,'queued');assert.match(f.runs[1].detail!,/earlier failed/);f.stop();
});

test('multiple distinct edits during an active run surface a conflict',async()=>{
  const f=fixture([rule({events:['create','modify']})]);f.service.schedule('Gym/today.md','create');await until(()=>f.sent.length===1);
  f.notes.get('Gym/today.md')!.content='edit one';f.service.schedule('Gym/today.md','modify');await wait();f.notes.get('Gym/today.md')!.content='edit two';f.service.schedule('Gym/today.md','modify');await wait();
  f.setStatus('complete');await f.service.poll();await until(()=>f.runs[0]?.state==='conflicted');assert.match(f.runs[0].detail!,/changed more than once/);f.stop();
});

test('rename preserves run history, delete cancels debounce, and manual run works',async()=>{
  const f=fixture();f.service.runNow('Gym/today.md','workflow');await until(()=>f.sent.length===1);
  const note=f.notes.get('Gym/today.md')!;f.notes.delete(note.path);note.path='Gym/renamed.md';f.notes.set(note.path,note);await f.service.rename('Gym/today.md','Gym/renamed.md');assert.equal(f.runs[0].notePath,'Gym/renamed.md');
  f.runs.splice(0);f.service.schedule('Gym/renamed.md','create');f.service.delete('Gym/renamed.md');await wait();assert.equal(f.sent.length,1);f.stop();
});

test('three recent runs trip the circuit breaker',async()=>{
  const f=fixture();for(let n=0;n<3;n++)f.runs.push({id:`old${n}`,workflowId:'workflow',notePath:'Gym/today.md',inputHash:`old${n}`,requestId:`request${n}`,state:'failed',createdAt:999_000+n,updatedAt:999_000+n});
  f.service.runNow('Gym/today.md','workflow');await until(()=>f.reports.length===1);assert.match(f.runs[2].detail!,/Circuit breaker/);assert.equal(f.sent.length,0);f.stop();
});

test('a durable queued run can be resumed with its original request ID',async()=>{
  const f=fixture(),run:WorkflowRun={id:'run',workflowId:'workflow',notePath:'Gym/today.md',inputHash:'old',requestId:'stable-request',state:'queued',createdAt:1,updatedAt:1};f.runs.push(run);
  await f.service.retry(run);assert.equal(f.sent.length,1);assert.equal(f.sent[0].requestId,'stable-request');assert.equal(run.state,'running');f.stop();
});
