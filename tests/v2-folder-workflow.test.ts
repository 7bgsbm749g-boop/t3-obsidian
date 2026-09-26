import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {AutomationStore} from '../automation-store';
import {releaseHash,matchWorkflow} from '../automation-ir';
import {exactHash,type NormalizedEventPayload} from '../automation-protocol';
import {DurableExecutionDriver} from '../execution-driver';
import {DeterministicWorkflowRuntime,noteSnapshot,type RuntimeRelease} from '../workflow-runtime';
import {folderWorkflowIR} from '../v2-folder-workflow';

beforeEach(()=>{globalThis.indexedDB=new IDBFactory();});
function event(id:string,type:NormalizedEventPayload['type'],afterHash:string):NormalizedEventPayload{return {eventId:id,type,note:{noteId:'note',incarnationId:'inc',pathBefore:type==='note.created'?null:'Gym/A.md',pathAfter:'Gym/A.md'},revision:{id:`r-${id}`,parentIds:[],beforeHash:type==='note.created'?null:'sha256:before',afterHash,hashProfile:'utf8-exact-v1'},facts:{},evidence:{observationIds:[],captureProfile:'saved-state-text-diff-v1',beforeKnown:true,historyComplete:true},provenance:{attribution:'unknown',causedByOperationId:null},causality:{rootEventId:id,workflowRunId:null},content:{beforeBlob:null,afterBlob:null},coordinator:{destinationId:'qlo2',assignmentId:'assignment',epoch:1,sequence:1}};}

test('a direct v2 folder workflow plans a linked-project T3 send and suppresses its own output',async()=>{
  let time=0,n=0,content='initial',creates=0;const store=new AutomationStore('vault','device','stream');
  const ir=folderWorkflowIR({id:'format',name:'Format',folderPath:'Gym',includeSubfolders:true,events:['create','modify'],task:'Format the note.',destinationId:'qlo2',projectId:'project',connectionId:'machine',enabled:true,order:0});
  assert.equal(matchWorkflow(ir,event('outside','note.changed',exactHash('x'))).result,'true');
  const release:RuntimeRelease={ir,hash:releaseHash(ir),activatedAt:new Date(0).toISOString(),activationSequence:1};
  const runtime=new DeterministicWorkflowRuntime(store,{currentNote:async()=>noteSnapshot('note','inc','Gym/A.md',content),environmentId:()=> 'machine',now:()=>new Date(time),id:()=>`id-${++n}`},'vault');
  await runtime.accept(event('create','note.created',exactHash(content)),[release]);time=5000;
  const planned=await runtime.planReady([release]);assert.equal(planned.length,1);
  assert.equal(planned[0].plan.projectId,'project');assert.equal(planned[0].plan.connectionId,'machine');assert.equal(planned[0].plan.notePath,'Gym/A.md');assert.match(planned[0].plan.prompt,/Format the note/);
  const requestId=planned[0].plan.requestId;
  time=6000;
  const driver=new DurableExecutionDriver(store,{createThread:async plan=>{creates++;assert.equal(plan.requestId,requestId);assert.equal((await store.executions())[0].state,'create_attempted');return 'thread';},startTurn:async()=>{},poll:async()=>{content='formatted';return {state:'complete',result:{threadId:'thread',outputHash:exactHash(content)}};},apply:async()=>{throw Error('unexpected apply');},emit:async()=>{throw Error('unexpected emit');},now:()=>new Date(time).toISOString()});
  await driver.recover();assert.equal((await store.executions())[0].state,'succeeded');assert.equal(creates,1);
  time=7000;await runtime.accept(event('output','note.changed',exactHash(content)),[release]);time=12000;
  assert.equal((await runtime.planReady([release])).length,0);await driver.recover();assert.equal(creates,1);
});

test('pausing a v2 workflow before debounce prevents its pending event from dispatching',async()=>{
  let time=0;const store=new AutomationStore('vault','device','stream'),ir=folderWorkflowIR({id:'format',name:'Format',folderPath:'Gym',includeSubfolders:false,events:['create'],task:'Format.',destinationId:'qlo2',projectId:'project',enabled:true,order:0}),release:RuntimeRelease={ir,hash:releaseHash(ir),activatedAt:'',activationSequence:1};
  const runtime=new DeterministicWorkflowRuntime(store,{currentNote:async()=>noteSnapshot('note','inc','Gym/A.md','x'),environmentId:()=> 'machine',now:()=>new Date(time),id:()=> 'id'},'vault');
  await runtime.accept(event('create','note.created',exactHash('x')),[release]);time=5000;
  assert.equal((await runtime.planReady([{...release,ir:{...ir,enabled:false}}])).length,0);
  assert.equal((await store.executions()).length,0);
});
