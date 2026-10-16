import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {continueQuestionAnswer,questionAnswerBindingId,type QuestionContinuationIO} from '../question-continuation';
import {QuestionController,type QuestionAnswerFollow} from '../question-controller';
import {renderQuestion,type QuestionTarget} from '../questions';
import {contentHash} from '../completion';
import {responseAnchor} from '../native-response-projection';
import {LocalResponseManager} from '../local-response-manager';
import {responseBindingRequests,updateResponseBindingData,type ResponseBindingData} from '../response-binding-data';
import type {ResponseRequest} from '../response-model';
import type {DirectInlineUpdate} from '../direct-inline-preview';

const at=(second:number)=>`2026-10-16T00:00:${String(second).padStart(2,'0')}.000Z`;
const drain=async()=>{for(let n=0;n<10;n++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(){
 const target:QuestionTarget={environmentId:'environment',threadId:randomUUID(),requestId:randomUUID()},path='Late answer.md';
 const request={requestId:target.requestId,turnId:'source',responseMode:'message' as const,createdAt:at(1),questions:[{id:'choice',header:'Choice',question:'Continue?',options:[],multiSelect:false}]};
 const follow:QuestionAnswerFollow={request,command:{type:'thread.user-input.respond',commandId:randomUUID(),threadId:target.threadId,requestId:target.requestId,answers:{choice:'Yes'},createdAt:at(20)},notePath:path,accepted:true};
 const source:ResponseRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,id:randomUUID(),initialOwner:randomUUID(),vaultId:'vault',host:{environmentId:'environment',workspaceRoot:'/synthetic',directory:'.obsidian/inline'},notePath:path,threadId:target.threadId,messageId:randomUUID(),projectId:randomUUID(),threadEnvironmentId:'environment',initialHash:contentHash(''),createdAt:at(0),intermediateMode:'collapse',finalAnswerFormat:'raw-markdown'};
 let records:ResponseBindingData=updateResponseBindingData({},source,'test'),registrations=0,closed=0;
 const saved='Original saved final.\n\n'+renderQuestion(request,target)+'\n\nOutside user text.\n';
 const documents=new Map([[path,saved]]),registered:ResponseRequest[]=[];
 const thread:any={id:target.threadId,projectId:source.projectId,title:'Late question',messages:[{id:'before',role:'assistant',turnId:'source',text:'Original saved final.',streaming:false,createdAt:at(5)},{id:`async-answer:${target.requestId}`,role:'user',turnId:'answer-run',text:'Continue? Yes',streaming:false,createdAt:at(20)}],activities:[{id:'requested',kind:'user-input.requested',summary:'Question',turnId:'source',createdAt:at(1),payload:request},{id:'resolved',kind:'user-input.resolved',summary:'Resolved',turnId:'source',createdAt:at(20),payload:{requestId:target.requestId,responseMode:'message',answers:{choice:'Yes'}}}],turns:{source:{turnId:'source',state:'completed',requestedAt:at(0),completedAt:at(10),assistantMessageId:'before'}},latestTurn:{turnId:'answer-run',state:'running',messageId:`async-answer:${target.requestId}`,requestedAt:at(20)},session:{status:'running',activeTurnId:'answer-run'}};
 const io:QuestionContinuationIO={vaultId:'vault',owner:randomUUID(),allowed:()=>true,access:async()=>({origin:'https://synthetic.invalid',api:async()=>({snapshotSequence:10,thread}),close:()=>{closed++;}}),bindings:()=>responseBindingRequests(records),notePaths:()=>[...documents.keys()],readNote:async path=>documents.get(path),updateNote:async(path,change,allowed)=>{if(!allowed())return;const current=documents.get(path);if(current===undefined)return;const next=change(current);documents.set(path,next);return next;},host:async()=>{throw Error('Use the original host');},policy:()=>({intermediateMode:'keep',finalAnswerFormat:'formatted'}),register:async value=>{registrations++;records=updateResponseBindingData(records,value,'test');registered.push(value);}};
 return {target,path,source,follow,thread,saved,documents,io,registered,registrations:()=>registrations,closed:()=>closed,records:()=>records};
}

test('a late answer gets one new binding for its exact message while saved prose and user edits remain intact',async()=>{
 const h=fixture();assert.equal(await continueQuestionAnswer(h.target,h.follow,h.io),true);
 const binding=h.registered[0],note=h.documents.get(h.path)!;
 assert.equal(binding.id,questionAnswerBindingId(h.target,h.path));assert.equal(binding.messageId,`async-answer:${h.target.requestId}`);
 assert.equal(binding.initialInput?.answer?.questions[0].question,'Continue?');assert.equal(binding.initialInput?.answer?.answers?.choice,'Yes');
 assert.equal(binding.finalAnswerFormat,'raw-markdown');assert.equal(binding.intermediateMode,'collapse');assert.ok(note.startsWith(h.saved));
 assert.equal(h.closed(),1);assert.equal(responseBindingRequests(h.records()).length,2);
 await continueQuestionAnswer(h.target,h.follow,h.io);assert.equal(h.documents.get(h.path),note);assert.equal(note.split(responseAnchor(binding.id)).length-1,1);
 // A completed or removed continuation must never be resurrected by a retry.
 h.documents.set(h.path,note.replace(responseAnchor(binding.id),'Saved follow-up final.'));
 const complete=h.documents.get(h.path);await continueQuestionAnswer(h.target,h.follow,h.io);assert.equal(h.documents.get(h.path),complete);
});

test('active-run answers use their current stream; unrelated output cannot stand in for an unprojected answer',async()=>{
 const h=fixture();h.thread.messages[1].turnId='source';
 assert.equal(await continueQuestionAnswer(h.target,h.follow,h.io),true);assert.equal(h.registrations(),0);
 h.thread.messages=h.thread.messages.slice(0,1);assert.equal(await continueQuestionAnswer(h.target,h.follow,h.io),false);assert.equal(h.documents.get(h.path),h.saved);
});

test('native runtime request identities longer than 200 characters retain their exact async-answer binding',async()=>{
 const h=fixture(),id='runtime-request:provider:codex:'+('native-request:async%3Acall_'.repeat(12));
 h.target.requestId=id;h.follow.request.requestId=id;h.follow.command.requestId=id;
 h.thread.messages[1].id=`async-answer:${id}`;h.thread.latestTurn.messageId=`async-answer:${id}`;h.thread.activities[1].payload.requestId=id;
 assert.equal(await continueQuestionAnswer(h.target,h.follow,h.io),true);assert.equal(h.registered[0].messageId,`async-answer:${id}`);
});

test('failed registration after insertion retries the same container without another answer or duplicate block',async()=>{
 const h=fixture(),register=h.io.register;let failed=false;
 h.io.register=async request=>{if(!failed){failed=true;throw Error('Settings save failed');}await register(request);};
 await assert.rejects(continueQuestionAnswer(h.target,h.follow,h.io),/Settings save failed/);
 const pending=h.documents.get(h.path);assert.equal(await continueQuestionAnswer(h.target,h.follow,h.io),true);
 assert.equal(h.documents.get(h.path),pending);assert.equal(h.registered.length,1);
});

test('native answers and dismissals never create answer-stream recovery intents',async()=>{
 for(const native of [false,true]){
  const h=fixture();if(native)delete (h.follow.request as any).responseMode;
  const activities=[{id:'asked',kind:'user-input.requested',summary:'Question',turnId:'source',payload:h.follow.request}],sent:any[]=[],saved:any[]=[];let follows=0;
  const controller=new QuestionController(async()=>({origin:'https://synthetic.invalid',api:async(_path,command)=>{if(command){sent.push(command);return {};}return {thread:{id:h.target.threadId,activities}};}}),{load:()=>[],save:value=>{saved.splice(0,saved.length,...JSON.parse(JSON.stringify(value)));}},randomUUID,()=>at(20),async()=>{follows++;return true;});
  await controller.refresh([h.target]);controller.draft(h.target,'choice',{text:'Yes'});await controller.submit(h.target,!native,h.path);
  assert.equal(sent.length,1);assert.equal(follows,0);assert.equal(saved[0].answerFollow,undefined);controller.dispose();
 }
});

test('null-turn late answers use the source terminal boundary and do not adopt an unrelated latest run',async()=>{
 const h=fixture();h.thread.messages[1].turnId=null;h.thread.latestTurn={turnId:'unrelated',state:'running'};h.thread.session.activeTurnId='unrelated';
 assert.equal(await continueQuestionAnswer(h.target,h.follow,h.io),true);assert.equal(h.registered[0].messageId,`async-answer:${h.target.requestId}`);assert.equal(h.registered[0].importTurn,undefined);
});

test('a renamed origin is found from its generated question, without adding streams to unrelated notes',async()=>{
 const h=fixture();h.documents.delete(h.path);h.documents.set('Moved.md',h.saved);h.documents.set('Unrelated.md','Ordinary text');
 assert.equal(await continueQuestionAnswer(h.target,h.follow,h.io),true);assert.equal(h.registered.length,1);assert.equal(h.registered[0].notePath,'Moved.md');assert.equal(h.documents.get('Unrelated.md'),'Ordinary text');
});

test('an accepted answer remains recoverable through missing projection, reload, and a lost acknowledgement without redispatch',async()=>{
 const h=fixture();let stored:any[]=[],dispatches=0;
 h.thread.messages=h.thread.messages.slice(0,1);h.thread.activities=h.thread.activities.slice(0,1);
 const access=async()=>({origin:'https://synthetic.invalid',api:async(_path:string,command?:any)=>{
   if(command){dispatches++;h.thread.activities.push({id:'resolved',kind:'user-input.resolved',summary:'Resolved',turnId:'source',payload:{requestId:h.target.requestId,answers:command.answers,responseMode:'message'}});throw Error('Lost acknowledgement');}
   return {snapshotSequence:10,thread:h.thread};
 }});
 const store={load:()=>stored,save:(value:any)=>{stored=JSON.parse(JSON.stringify(value));}};
 let controller=new QuestionController(access,store,randomUUID,()=>at(20),(target,follow)=>continueQuestionAnswer(target,follow,h.io));
 await controller.refresh([h.target]);controller.draft(h.target,'choice',{text:'Yes'});await assert.rejects(controller.submit(h.target,false,h.path),/Lost acknowledgement/);controller.dispose();
 controller=new QuestionController(access,store,randomUUID,()=>at(20),(target,follow)=>continueQuestionAnswer(target,follow,h.io));
 await controller.refresh([h.target]);await controller.recoverAnswerStreams();assert.equal(h.registrations(),0);assert.ok(stored[0].answerFollow);
 h.thread.messages.push({id:`async-answer:${h.target.requestId}`,role:'user',turnId:'answer-run',text:'Yes',streaming:false,createdAt:at(20)});
 await Promise.all([controller.recoverAnswerStreams(),controller.recoverAnswerStreams()]);assert.equal(h.registrations(),1);assert.equal(dispatches,1);assert.equal(stored[0].answerFollow,undefined);controller.dispose();
});

test('local final saving of the follow-up replaces only the new container',async()=>{
 const h=fixture(),callbacks=new Map<string,(update:DirectInlineUpdate)=>void>(),register=h.io.register;
 const managerIO:any={...h.io,localBindings:h.io.bindings,saveLocalBinding:register,openedNotes:()=>[...h.documents].map(([path,document])=>({path,document})),isOpen:()=>true,syncReady:()=>true};
 const manager=new LocalResponseManager(h.io.owner,'vault',managerIO,{read:h.io.readNote,compareAndSet:async(path,before,after,guard)=>{if(h.documents.get(path)!==before||guard?.()===false)return false;h.documents.set(path,after);return true;}},()=>0,(record,_access,receive)=>{callbacks.set(record.request.id,receive);return {tick(){},update(){},delivery(){},reconnect(){},suspend(){},dispose(){}} as any;});
 h.io.register=request=>manager.register(request);
 await continueQuestionAnswer(h.target,h.follow,h.io);const binding=h.registered[0];
 callbacks.get(binding.id)!({request:binding,messageId:binding.messageId,sequence:20,body:'New follow-up final.',turnId:'answer-run',phase:'complete',completionVerified:true});await drain();
 assert.equal(h.documents.get(h.path),h.saved+'New follow-up final.\n');manager.dispose();h.io.register=register;
});
