import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completionSource,leaseExplorerResponse,noteIndicators,relocateExplorerResponses,loadExplorerResponses} from '../explorer-responses';
import {folderNotePath} from '../folder-note-adapter';
import type {ResponseRecord} from '../response-record';
const record=(state?:any):ResponseRecord=>({request:{id:'binding',notePath:'Note.md'} as any,epoch:1,revision:2,owner:'writer',expiresAt:0,state});
test('completion sources require exact successful run evidence and never invent a timestamp',()=>{
  const request={threadEnvironmentId:'machine',projectId:'project',threadId:'thread'};
  assert.equal(completionSource(request,undefined),undefined);
  assert.equal(completionSource(request,{turnId:'failed',state:'error',completedAt:'2026-10-20T10:01:00Z'}),undefined);
  assert.deepEqual(completionSource(request,{turnId:'run',state:'completed',completedAt:'invalid'}),{environmentId:'machine',projectId:'project',threadId:'thread',runId:'run'});
  const result=record({status:'complete',turnId:'run',bindingCheckpoint:{turns:{run:{turnId:'run',state:'completed',completedAt:'2026-10-20T10:01:00Z'}}}});
  Object.assign(result.request,request);
  assert.deepEqual(leaseExplorerResponse(result).completion,{environmentId:'machine',projectId:'project',threadId:'thread',runId:'run',completedAt:'2026-10-20T10:01:00Z'});
});
test('terminal exact runs and permanent final grants stop the spinner while their save is pending',()=>{
  for(const status of ['running','waiting']){
    const pending=record({status});pending.finalWriter={actor:'device',token:'token',messageId:'message',turnId:'run',sequence:1,body:'Reply',phase:'complete'};
    assert.equal(leaseExplorerResponse(pending).active,false);
    delete pending.finalWriter;pending.state!.turnId='run';pending.state!.bindingCheckpoint={turns:{run:{turnId:'run',state:'completed'}}};
    assert.equal(leaseExplorerResponse(pending).active,false);
  }
});

test('exact binding checkpoints distinguish running, unresolved input, answered followups and terminal failure',()=>{
  assert.equal(leaseExplorerResponse(record()).active,true);
  for(const status of ['running','waiting','complete']){
    const response=leaseExplorerResponse(record({status,questionFollows:[{requestId:'q'}]}));
    assert.equal(response.input,true);assert.equal(response.complete,false);
    assert.equal(response.active,status==='running');
  }
  const saving=leaseExplorerResponse(record({status:'running',finishedAt:'2026-10-02T18:28:12Z',questionFollows:[{completed:true}]}));
  assert.equal(saving.active,false,'A finished exact turn does not spin during a write-ahead checkpoint');assert.equal(saving.input,true);assert.equal(saving.complete,false);
  assert.equal(leaseExplorerResponse(record({status:'complete',questionFollows:[{answered:true}]})).complete,true);
  assert.equal(leaseExplorerResponse(record({status:'complete',pendingMessageId:'follow'})).active,true);
  assert.equal(leaseExplorerResponse(record({status:'complete',pendingMessageId:'follow'})).complete,false);
  for(const status of ['interrupted','error','paused','conflict']){
    const response=leaseExplorerResponse(record({status}));assert.equal(response.active,false);assert.equal(response.complete,false);
  }
  const stopped=leaseExplorerResponse({...record({status:'running',userStopped:true,questionFollows:[{}]}),stopRequestedAt:1});
  assert.equal(stopped.active,false);assert.equal(stopped.input,false);
});
test('several replies and mirrored destinations aggregate independently; relocation and deletion survive serialization',()=>{
  const a=leaseExplorerResponse(record({status:'running'})),b={...a,id:'second',active:false,input:true},mirror={...a,id:'mirror',notePath:'Mirror.md'};
  let responses=[a,b,mirror];let notes=noteIndicators(responses,()=>true);
  assert.deepEqual(notes.get('Note.md'),{active:1,input:1,complete:0,total:2});assert.equal(notes.get('Mirror.md')?.active,1);
  responses=relocateExplorerResponses(responses,'Note.md','Folder/Note.md');responses=relocateExplorerResponses(responses,'Folder','Renamed');
  responses=loadExplorerResponses(JSON.parse(JSON.stringify(responses)));
  notes=noteIndicators(responses,path=>path!=='Mirror.md');assert.equal(notes.has('Note.md'),false);assert.equal(notes.get('Renamed/Note.md')?.total,2);
  responses=relocateExplorerResponses(responses,'Renamed');assert.equal(noteIndicators(responses,()=>true).has('Renamed/Note.md'),false,'Recreated paths do not resurrect deleted bindings');
});
test('folder-notes adapter matches inside/parent storage, templates, fixed names, extension priority and absence',()=>{
  const settings={folderNoteName:'{{folder_name}}',folderNoteType:'.md',storageLocation:'insideFolder',supportedFileTypes:['md','canvas']};
  assert.equal(folderNotePath('App',settings,path=>path==='App/App.md'),'App/App.md');
  assert.equal(folderNotePath('Parent/App',{...settings,storageLocation:'parentFolder'},path=>path==='Parent/App.md'),'Parent/App.md');
  assert.equal(folderNotePath('App',{...settings,folderNoteName:'_index'},path=>path==='App/_index.md'),'App/_index.md');
  assert.equal(folderNotePath('App',{...settings,folderNoteName:'About {{folder_name}}'},path=>path==='App/About App.canvas'),'App/About App.canvas');
  assert.equal(folderNotePath('App',undefined,()=>true),undefined);assert.equal(folderNotePath('App',settings,()=>false),undefined);
});
