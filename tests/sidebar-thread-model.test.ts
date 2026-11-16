import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SidebarThreadTransport,sidebarTarget,subagentTarget,type SidebarTarget} from '../src/conversations/sidebar-thread-model';
import type {ThreadAccess} from '../src/conversations/thread-stream';
import type {NormalizedThread} from '../src/connection/wire-types';
const target:SidebarTarget={environmentId:'env',projectId:'project',threadId:'parent',title:'Parent',kind:'thread'};
function fixture(){
 const calls:any[]=[],closed:string[]=[],threads=new Map<string,NormalizedThread>();let id=0;
 threads.set('parent',{id:'parent',projectId:'project',messages:[],activities:[],session:{status:'ready',activeTurnId:null}});
 const access=async(environmentId:string):Promise<ThreadAccess>=>({origin:'http://synthetic',close:()=>{closed.push(environmentId);},api:async(path,body)=>{
  calls.push({path,body});if(path==='/api/orchestration/dispatch'){
   if((body as any).type==='thread.fork')threads.set((body as any).targetThreadId,{...threads.get('parent')!,id:(body as any).targetThreadId});return {};
  }
  const id=decodeURIComponent(path.split('/').at(-1)!.split('?')[0]);const thread=threads.get(id);if(!thread)throw Error('404');return {thread};
 }});
 const transport=new SidebarThreadTransport(access,()=>`uuid-${++id}`);
 return {transport,threads,calls,closed,dispatch:()=>calls.filter(call=>call.path.endsWith('/dispatch'))};
}
test('target restoration and subagents require exact identities and a local child thread',()=>{
 assert.equal(sidebarTarget({...target,kind:'other'}),undefined);
 assert.equal(sidebarTarget({...target,kind:'side-chat'}),undefined);
 assert.equal(sidebarTarget({...target,kind:'side-chat',parent:{...target,environmentId:'wrong'}}),undefined);
 assert.equal(subagentTarget(target,{id:'node',runId:'run',status:'running'}),undefined);
 assert.equal(subagentTarget(target,{id:'node',runId:'run',status:'running',childThreadId:'child',remoteChild:{}}),undefined);
 assert.equal(subagentTarget(target,{id:'node',runId:'run',status:'running',childThreadId:'child'})?.threadId,'child');
});
test('sidebar send checks fresh identity and sends only typed text with stable IDs and no note destinations',async()=>{
 const f=fixture();await f.transport.send(target,'Exact follow-up','command','message');
 const command=f.dispatch()[0].body;assert.equal(command.threadId,'parent');assert.equal(command.text,'Exact follow-up');assert.equal(command.commandId,'command');assert.equal(command.messageId,'message');assert.deepEqual(command.attachments,[]);assert.deepEqual(f.closed,['env']);
 f.threads.get('parent')!.projectId='wrong';await assert.rejects(f.transport.send(target,'Do not send','command2','message2'),/requested T3 thread/);assert.equal(f.dispatch().length,1);assert.equal(f.closed.length,2);
});
test('archived, deleted, pending-input and read-only child threads reject mutation',async()=>{
 for(const patch of [{archivedAt:'today'},{deletedAt:'today'},{hasPendingUserInput:true},{hasPendingApprovals:true}]){
  const f=fixture();Object.assign(f.threads.get('parent')!,patch);await assert.rejects(f.transport.send(target,'No','command','message'));assert.equal(f.dispatch().length,0);
 }
 const f=fixture();await assert.rejects(f.transport.send({...target,kind:'subagent',parent:target},'No','command','message'),/read-only/);assert.equal(f.calls.length,0);
});
test('side chat uses the server latest stable fork and retains parent identity',async()=>{
 const f=fixture();const side=await f.transport.fork(target),command=f.dispatch()[0].body;
 assert.equal(command.type,'thread.fork');assert.equal(command.sideChat,true);assert.deepEqual(command.sourcePoint,{type:'latest_stable'});assert.equal(command.sourceThreadId,'parent');assert.equal(command.targetThreadId,side.threadId);assert.deepEqual(side.parent,{threadId:'parent',projectId:'project',environmentId:'env'});assert.equal(side.kind,'side-chat');assert.deepEqual(f.closed,['env']);
});
test('bring back requires idle parent and a finished child reply; stop uses current app run',async()=>{
 const f=fixture(),side=await f.transport.fork(target);await assert.rejects(f.transport.bringBack(side),/finished reply/);
 f.threads.get(side.threadId)!.turns={done:{turnId:'done',state:'completed',completedAt:'2026-11-15T12:00:00Z'}};
 f.threads.get('parent')!.session={status:'running',activeTurnId:'active'};
 await assert.rejects(f.transport.bringBack(side),/finish/);await f.transport.stop(target);assert.equal(f.dispatch().at(-1).body.runId,'active');
 f.threads.get('parent')!.session={status:'ready',activeTurnId:null};await f.transport.bringBack(side);const merged=f.dispatch().at(-1).body;assert.equal(merged.type,'thread.merge_back');assert.equal(merged.targetThreadId,'parent');assert.deepEqual(merged.sourcePoint,{type:'run',runId:'done'});
});

test('composer sends attachments and selected model, and steers the exact active app run',async()=>{
 const f=fixture();f.threads.get('parent')!.session={status:'running',activeTurnId:'active'};
 const attachment={id:'image',name:'synthetic.png',mimeType:'image/png',dataUrl:'data:image/png;base64,aA=='};
 await f.transport.send(target,'Follow up','command','message',{attachments:[attachment],modelSelection:{instanceId:'codex',model:'model',options:[{id:'reasoningEffort',value:'high'}]}});
 const command=f.dispatch()[0].body;assert.equal(command.type,'message.dispatch');assert.deepEqual(command.dispatchMode,{type:'steer_active',targetRunId:'active'});assert.equal(command.deliveryIntent,'steer');assert.deepEqual(command.attachments,[attachment]);assert.equal(command.modelSelection.options[0].value,'high');
});
test('model, effort, permissions and plan changes use the stock thread controls; deletion is side-chat scoped',async()=>{
 const f=fixture();await f.transport.configure(target,{modelSelection:{instanceId:'codex',model:'model'},runtimeMode:'approval-required',interactionMode:'plan'});
 assert.deepEqual(f.dispatch().map(call=>call.body.type),['thread.model-selection.set','thread.runtime-mode.set','thread.interaction-mode.set']);
 await assert.rejects(f.transport.deleteSideChat(target),/side chat/);const side=await f.transport.fork(target);await f.transport.deleteSideChat(side);assert.equal(f.dispatch().at(-1).body.type,'thread.delete');assert.equal(f.dispatch().at(-1).body.threadId,side.threadId);
});
