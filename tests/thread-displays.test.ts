import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ThreadDisplays} from '../src/conversations/thread-displays';
import {applyThreadItem,type InlineThreadState} from '../src/conversations/inline-thread';
import {initialRegion} from '../src/conversations/inline-thread';
import type {ResponseRequest} from '../src/responses/response-model';
function fixture(){
 const target={threadId:'thread',projectId:'project',environmentId:'machine'},first=randomUUID(),next=randomUUID(),attached:ResponseRequest[]=[],saved:any[]=[];
 let now=0,persisted:unknown,watch:any,stops=0;
 const snapshot=(ids:string[],sequence=1)=>applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{sequence,thread:{id:target.threadId,projectId:target.projectId,messages:ids.flatMap((id,index)=>[{id,role:'user',text:'Prompt '+index,createdAt:`2026-10-16T00:00:0${index}Z`,turnId:'turn'+index,streaming:false},{id:'answer'+index,role:'assistant',text:'Answer',turnId:'turn'+index,streaming:false}]),activities:[],latestTurn:{turnId:'turn'+(ids.length-1),requestedAt:`2026-10-16T00:00:0${ids.length-1}Z`,state:'completed'},session:{status:'ready',activeTurnId:null}}}}).state;
 let state:InlineThreadState={...snapshot([first]),historyComplete:true};
 const host={load:async()=>persisted,save:async(value:unknown)=>{persisted=structuredClone(value);saved.push(persisted);},now:()=>now,displayHost:{readThread:async()=>state,validateDestination:async()=>{},responseBindings:async()=>[],prepareDisplay:async(display:any,destination:any,message:any)=>({version:4,id:randomUUID(),initialOwner:randomUUID(),vaultId:'vault',host:{environmentId:target.environmentId,workspaceRoot:'/scratch',directory:'.obsidian/inline'},notePath:destination.path,threadId:target.threadId,projectId:target.projectId,threadEnvironmentId:target.environmentId,messageId:message.id,initialHash:initialRegion(randomUUID()).bodyHash,createdAt:'2026-10-16T00:00:00Z'}) as ResponseRequest,attachDisplay:async(request:ResponseRequest)=>{attached.push(request);}},watchThread:(_target:any,item:any)=>{watch=item;return {stop:()=>stops++};}};
 const create=()=>new ThreadDisplays(host);
 return {target,first,next,attached,saved,create,watch:(item:unknown)=>watch?.(item),advance:()=>now+=31_000,setHistory:(ids:string[],sequence=1)=>state={...snapshot(ids,sequence),historyComplete:true},updateState:(update:(value:InlineThreadState)=>InlineThreadState)=>state=update(state),get persisted(){return persisted;},setPersisted:(value:unknown)=>persisted=value,stops:()=>stops};
}
test('an automatic event continuation streams to the original destination after client restart',async()=>{
 const f=fixture(),registration={version:1 as const,id:randomUUID(),kind:'stream-thread' as const,scope:'thread' as const,source:f.target,destinations:['Replies.md'],start:'future' as const};
 let service=f.create();await service.initialize();await service.command(registration);await service.tick();assert.equal(f.attached.length,0);service.stop();
 f.setHistory([f.first,f.next]);f.updateState(state=>({...state,messages:state.messages.map(message=>message.id===f.next?{...message,text:'Desktop control is available. Resume the remaining work.',createdBy:'agent',creationSource:'mcp'}:message)}));
 service=f.create();await service.initialize();await service.tick();assert.equal(f.attached.length,1);assert.equal(f.attached[0].notePath,'Replies.md');assert.equal(f.attached[0].threadId,f.target.threadId);assert.equal(f.attached[0].messageId,f.next);
 await service.tick();assert.equal(f.attached.length,1);service.stop();
});
test('registering after the original prompt catches an already started continuation without importing the original reply',async()=>{
 const f=fixture(),service=f.create();f.setHistory([f.first,f.next]);await service.initialize();await service.command({version:1,id:randomUUID(),kind:'stream-thread',scope:'thread',source:f.target,destinations:['Replies.md'],start:'after',afterMessageId:f.first});
 await service.tick();assert.deepEqual(f.attached.map(request=>[request.notePath,request.messageId]),[['Replies.md',f.next]]);await service.tick();assert.equal(f.attached.length,1);service.stop();
});
test('following imports only new prompt turns and survives restart without duplicate bindings',async()=>{
 const f=fixture();let service=f.create();await service.initialize();const command={version:1 as const,id:randomUUID(),kind:'stream-thread' as const,scope:'thread' as const,source:f.target,destinations:['Note.md'],start:'future' as const};await service.command(command);await service.tick();assert.equal(f.attached.length,0);
 f.setHistory([f.first,f.next]);f.advance();await service.tick();assert.equal(f.attached.length,1);assert.equal(f.attached[0].messageId,f.next);await service.tick();assert.equal(f.attached.length,1);service.stop();assert.equal(f.stops(),1);
 service=f.create();await service.initialize();await service.tick();assert.equal(f.attached.length,1);await assert.rejects(service.command(command),/already exists/);service.stop();
});
test('reply reservations, pause boundaries, rename and cancellation remain independent of removed notifications',async()=>{
 const f=fixture(),service=f.create();await service.initialize();const registration=await service.command({version:1,id:randomUUID(),kind:'stream-thread',scope:'thread',source:f.target,destinations:['Note.md'],start:'future'}),id=registration.subscriptionId!;
 await service.command({version:1,id:randomUUID(),kind:'pause-thread-stream',subscriptionId:id});f.setHistory([f.first,f.next]);await service.command({version:1,id:randomUUID(),kind:'resume-thread-stream',subscriptionId:id});f.advance();await service.tick();assert.equal(f.attached.length,0,'paused turns are skipped');await service.rename('Note.md','Moved.md');assert.equal(service.snapshot.displays[0].destinations[0].path,'Moved.md');await service.command({version:1,id:randomUUID(),kind:'cancel-thread-stream',subscriptionId:id});assert.equal(service.active,false);assert.ok(!('subscriptions' in service.snapshot));service.stop();
});
test('migration keeps only reply registrations and discards all old emission state',async()=>{
 const f=fixture();f.setPersisted({version:1,displays:[],responseReservations:[],subscriptions:[{enabled:true}],notifications:[{command:{type:'send'}}]});const service=f.create();await service.initialize();assert.deepEqual(Object.keys(f.persisted as object).sort(),['commands','displays','responseReservations','version']);service.stop();
});
