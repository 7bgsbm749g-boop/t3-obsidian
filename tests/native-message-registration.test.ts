import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isT3MessageId} from '../t3-message-id';
import {validateResponseRequest} from '../response-model';
import {compactResponseBinding,loadResponseBindingData,updateResponseBindingData,responseBindingRequests,type ResponseBindingData} from '../response-binding-data';
import {normalizeV2Snapshot} from '../orchestration-v2';
import {applyThreadItem,turnForMessage} from '../inline-thread';
import {displayCommand,tickDisplay,type ThreadDisplay,type DisplayHost} from '../thread-display';
import {LocalResponseManager} from '../local-response-manager';
import {editorStream} from '../editor-stream';
import {responseAnchor} from '../native-response-projection';
import {localResponseBindings} from '../local-response-binding';
import {validateNoteCommand} from '../note-command';
import {noteContext,mergeNoteContexts} from '../note-context';
import {validSteeringInput} from '../inline-steering';
import {nativeRequest,nativeLaunchId,nativeFollowUpId,nativeAt} from './fixtures/native-message';

test('native message IDs remain bounded opaque tokens, distinct from local async answers',()=>{
  for(const value of [randomUUID(),nativeLaunchId,nativeFollowUpId,'message:future-format:1','x'.repeat(256)])assert.equal(isT3MessageId(value),true);
  for(const value of [undefined,null,0,{},'', 'x'.repeat(257),'two words',' leading','trailing ','tab\there','line\nbreak','nul\0id','id\x7f','id\u0085','id\u202e','async-answer:request'])assert.equal(isT3MessageId(value),false);
});

for(const messageId of [nativeLaunchId,nativeFollowUpId])test(`native identity survives registration storage, reload and related entry points: ${messageId}`,()=>{
  const request=nativeRequest(messageId);
  assert.equal(validateResponseRequest(request).messageId,messageId);
  assert.equal(validateResponseRequest({...request,initialInput:undefined}).messageId,messageId);
  request.localSteering=[{messageId:nativeFollowUpId,text:'Synthetic follow-up',before:[],sourceResponseId:request.id}];
  const data=loadResponseBindingData(JSON.parse(JSON.stringify(updateResponseBindingData({},request,'actor',1))));
  assert.equal(data[request.id].request.messageId,messageId);
  assert.equal(data[request.id].request.initialInput?.messageId,messageId);
  assert.equal(data[request.id].request.localSteering?.[0].messageId,nativeFollowUpId);
  assert.equal(validateNoteCommand({version:1,id:randomUUID(),kind:'attach-response',threadId:request.threadId,messageId,notePath:request.notePath,destinations:[request.notePath],streamReply:true}).messageId,messageId);
  assert.equal(validSteeringInput({messageId,text:'Synthetic follow-up'}),true);
  assert.equal(validSteeringInput({messageId,text:'Synthetic follow-up',sourceResponseId:nativeLaunchId}),false,'A plugin response ID still requires a UUID');
  const records=mergeNoteContexts([{messageId,threadId:request.threadId,projectId:request.projectId,environmentId:request.threadEnvironmentId,notePath:request.notePath,bindingIds:[request.id],createdAt:nativeAt}]);
  const context=noteContext({version:1,id:randomUUID(),kind:'note-context',threadId:request.threadId,messageId,environmentId:request.threadEnvironmentId},records,[request],{name:'synthetic',id:request.vaultId});
  assert.equal(context.context.send.messageId,messageId);assert.equal(context.context.destinations[0].bindingId,request.id);
});

test('native message support does not weaken binding, actor or structured async-answer validation',()=>{
  const request=nativeRequest();
  for(const changed of [{id:nativeLaunchId},{initialOwner:nativeLaunchId},{initialInput:{...request.initialInput!,messageId:nativeFollowUpId}},{messageId:'bad\nmessage',initialInput:undefined}])assert.throws(()=>validateResponseRequest({...request,...changed}));
  const messageId='async-answer:synthetic-request',answer={requestId:'synthetic-request',questions:[{id:'choice',question:'Continue?'}]};
  assert.equal(validateResponseRequest({...request,messageId,initialInput:{messageId,text:'Continue? Yes',answer}}).messageId,messageId);
  assert.throws(()=>validateResponseRequest({...request,messageId,initialInput:{messageId,text:'Continue? Yes'}}),/initial response/);
  assert.throws(()=>validateResponseRequest({...request,initialInput:{...request.initialInput!,answer}}),/initial response/);
});

for(const state of ['running','completed'] as const)for(const messageId of [randomUUID(),nativeLaunchId,nativeFollowUpId])test(`canonical ${state} history registers and restores the exact ${messageId} binding`,async()=>{
  const template=nativeRequest(messageId),runId=`run:thread:${encodeURIComponent(template.threadId)}:ordinal:1`;
  const snapshot=normalizeV2Snapshot({projection:{thread:{id:template.threadId,projectId:template.projectId},messages:[{id:messageId,role:'user',text:'Synthetic prompt',runId,createdBy:'agent',creationSource:'mcp',createdAt:nativeAt,streaming:false}],
    runs:[{id:runId,userMessageId:messageId,status:state,ordinal:1,requestedAt:nativeAt,...(state==='completed'?{completedAt:nativeAt}:{})}],turnItems:[]}});
  const history=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
  assert.equal(history.historyComplete,true);
  assert.equal(turnForMessage(history,messageId),runId);
  let document='# Synthetic note\n',bindings:ResponseBindingData={},networkAccesses=0;
  const manager=new LocalResponseManager(template.initialOwner!,template.vaultId,{
    readNote:async()=>document,updateNote:async(_path:string,change:(s:string)=>string)=>document=change(document),
    saveLocalBinding:async (request:ReturnType<typeof nativeRequest>)=>{bindings=updateResponseBindingData(bindings,request,'actor',1);},localBindings:()=>responseBindingRequests(bindings),isOpen:()=>true,
    access:async()=>{networkAccesses++;throw Error('No network access expected');},
  } as any,{read:async()=>document,compareAndSet:async()=>false},()=>1,()=>({tick(){},update(){},restore(){},dispose(){},stop(){}} as any));
  let prepares=0;
  const host:DisplayHost={readThread:async()=>history,validateDestination:async()=>{},responseBindings:async()=>[],save:async()=>{},
    prepareDisplay:async()=>{prepares++;return template;},
    attachDisplay:async(request,path)=>{await editorStream(request,path,{updateNote:async(_path,change)=>document=change(document)},()=>true,request.id);await manager.register(request);}};
  const displays:ThreadDisplay[]=[];
  await displayCommand(displays,{version:1,id:randomUUID(),kind:'stream-thread',scope:'thread',source:{threadId:template.threadId,projectId:template.projectId,environmentId:template.threadEnvironmentId},destinations:[template.notePath],start:'history'},host,1);
  assert.deepEqual(displays[0].boundary,[]);
  // Recreate a retained failed plan and empty slot from the previous release.
  if(messageId!==snapshot.thread.id){document+=responseAnchor(template.id)+'\n';displays[0].bindings.push({messageId,turnId:runId,destinationId:displays[0].destinations[0].id,request:template,status:'planned',error:'Invalid initial response input.'});}
  await tickDisplay(displays[0],host);
  const before=document,binding=displays[0].bindings[0];
  assert.equal(binding.status,'attached',binding.error);assert.equal(binding.error,undefined);assert.equal(binding.bindingId,template.id);
  assert.equal(prepares,messageId!==snapshot.thread.id?0:1);
  const reloaded=loadResponseBindingData(JSON.parse(JSON.stringify(bindings))),stored=responseBindingRequests(reloaded);
  assert.equal(stored.length,1);assert.equal(stored[0].messageId,messageId);assert.equal(stored[0].initialInput?.messageId,messageId);
  assert.equal(localResponseBindings(document,stored)[0].messageId,messageId);
  await tickDisplay(displays[0],host);assert.equal(document,before);assert.equal(networkAccesses,0);manager.dispose();
});

test('invalid attachment data fails before any note callback or placeholder insertion',async()=>{
  const valid=nativeRequest(),badRequests=[{...valid,id:nativeLaunchId},{...valid,initialOwner:nativeLaunchId},{...valid,messageId:'bad\nmessage',initialInput:undefined},{...valid,initialInput:{...valid.initialInput!,messageId:nativeFollowUpId}}];
  for(const request of badRequests){
    let calls=0,document='# Keep this note unchanged\n';
    await assert.rejects(editorStream(request,valid.notePath,{completed:async()=>{calls++;return false;},beforeInsert:async()=>{calls++;},updateNote:async(_path,change)=>{calls++;return document=change(document);}},()=>true,request.id));
    assert.equal(calls,0);assert.equal(document,'# Keep this note unchanged\n');
  }
  assert.equal(compactResponseBinding(valid).messageId,nativeLaunchId);
});
