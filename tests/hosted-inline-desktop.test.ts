import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DesktopInlineHost,localInlineFiles} from '../hosted-inline-desktop';
import {hostedPaths,type HostedInlineRequest} from '../hosted-inline';
import {initialRegion} from '../inline-thread';
import {commandId} from '../direct';
import {build} from 'esbuild';
import {builtinModules,createRequire} from 'node:module';
import * as timers from 'node:timers';
import {setTimeout as pause} from 'node:timers/promises';
import {runInNewContext} from 'node:vm';
import {desktopTimersPlugin} from '../esbuild.config.mjs';
import {leasePaths} from '../inline-lease';
import {INLINE_SNAPSHOT_INTERVAL_MS} from '../leased-inline';

for(const missedStart of [false,true])test(`bundled desktop recovers ${missedStart?'a missing start from canonical evidence':'saved start evidence'} with the feed stopped and renderer timers suspended`,async()=>{
  const bundle=await build({stdin:{contents:"export {DesktopInlineHost,localInlineFiles} from './hosted-inline-desktop'; export {DeviceInlineManager} from './leased-inline'; export {desktopInterval,desktopPause} from './desktop-timers';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022',external:['node:*',...builtinModules.filter(name=>name!=='buffer')],plugins:[desktopTimersPlugin()]});
  const nativeRequire=createRequire(import.meta.url),lockDelays:number[]=[],module={exports:{} as any};
  let rendererIntervals=0;
  runInNewContext(bundle.outputFiles[0].text,{
    module,exports:module.exports,process,console,crypto:globalThis.crypto,performance,URL,TextEncoder,TextDecoder,Buffer,global:{},document:{createElement:()=>({})},
    require:(name:string)=>name==='node:timers'?{...timers,setTimeout:(callback:()=>void,delay:number)=>{lockDelays.push(delay);return timers.setTimeout(callback,delay);}}:nativeRequire(name),
    setInterval:()=>{rendererIntervals++;return 1;},clearInterval:()=>{},
    setTimeout:()=>1,clearTimeout:()=>{},setImmediate,
  });
  const {DesktopInlineHost:Host,localInlineFiles:localFiles,DeviceInlineManager:Manager,desktopInterval,desktopPause}=module.exports;
  const root=await mkdtemp(join(tmpdir(),'t3-background-')),directory='.obsidian/t3-code/inline/v1';
  const actor=randomUUID(),id=randomUUID(),region=initialRegion(id),identity={workspaceRoot:root,directory,environmentId:'env',vaultId:'vault'};
  const request:HostedInlineRequest={version:2,initialOwner:actor,id,vaultId:identity.vaultId,host:{workspaceRoot:root,directory,environmentId:identity.environmentId},notePath:'Note.md',threadId:randomUUID(),messageId:commandId(id,'message'),projectId:'p',threadEnvironmentId:identity.environmentId,initialHash:region.bodyHash,createdAt:new Date().toISOString(),independent:true};
  const files=localFiles(root,directory),app:any={workspace:{getLeavesOfType:()=>[]},vault:{getFileByPath:()=>undefined}};
  const host=await Host.open(app,identity,async()=>{throw Error('No turn has been sent yet.');});
  let complete=false,bound=false,document='Outside edit\n'+region.text,clockOffset=0,reads=0;
  const manager=new Manager(actor,identity.vaultId,{access:async()=>({origin:'https://t3.example',api:async(path:string)=>{
    if(path.includes('websocket-ticket'))throw Error('Stream stalled');
    reads++;return {snapshotSequence:complete?10:bound?5:1,thread:{id:request.threadId,projectId:request.projectId,messages:[{id:request.messageId,role:'user',text:'Question',createdAt:request.createdAt,turnId:null,streaming:false},{id:'answer',role:'assistant',text:complete?'Recovered desktop final':'Desktop progress',turnId:'turn',streaming:!complete}],activities:[],latestTurn:bound?{turnId:'turn',...(missedStart&&bound?{requestedAt:request.createdAt}:{}),state:complete?'completed':'running',assistantMessageId:'answer'}:undefined,session:{status:complete?'ready':bound?'running':'starting',activeTurnId:complete||!bound?null:'turn'}}};
  }}),readNote:async()=>document,isSaved:async()=>true,isOpen:()=>true,updateNote:async(_path:string,change:(value:string)=>string,allowed:()=>boolean)=>{assert.equal(allowed(),true);return document=change(document);}},async()=>({files,close:()=>{}}),undefined,()=>performance.now()+clockOffset,desktopPause);
  const stop=desktopInterval(()=>manager.tick(),150);
  try{
    const started=Date.now();
    await Promise.race([manager.register(request),pause(2000).then(()=>{throw Error('Registration waited for a suspended renderer timer.');})]);
    assert.ok(Date.now()-started<2000,'Registration finishes within the send deadline');
    const path=leasePaths(directory,id).record,initial=JSON.parse((await files.read(path))!);
    await pause(300);
    assert.doesNotMatch(document,/Desktop progress/,'The initial unmatched response cannot borrow the latest turn');
    bound=true;
    if(!missedStart){
      for(const runtime of manager.jobs.values()){
        runtime.state={messages:[{id:request.messageId,role:'user',text:'Question',createdAt:request.createdAt,turnId:null,streaming:false}],activities:[],sequence:1};
        manager.item(runtime,{kind:'event',event:{sequence:2,type:'thread.turn-start-requested',payload:{messageId:request.messageId,createdAt:request.createdAt}}});
        manager.item(runtime,{kind:'event',event:{sequence:3,type:'thread.session-set',payload:{session:{status:'running',activeTurnId:'turn',updatedAt:request.createdAt}}}});
        manager.item(runtime,{kind:'event',event:{sequence:4,type:'thread.message-sent',payload:{messageId:'answer',role:'assistant',text:'Desktop progress',streaming:true,turnId:'turn',createdAt:request.createdAt}}});
      }
    }else for(const runtime of manager.jobs.values())runtime.nextSnapshot=0;
    await pause(3400);
    const renewed=JSON.parse((await files.read(path))!);
    assert.equal(renewed.owner,actor);assert.equal(renewed.epoch,initial.epoch);
    assert.ok(renewed.expiresAt>initial.expiresAt,'Background ownership is renewed');
    assert.ok(lockDelays.includes(5000),'The coordinator lock schedules its renewal on Node timers');
    assert.equal(rendererIntervals,0,'Coordinator and heartbeat intervals do not use browser timers');
    assert.match(document,/Desktop progress/);assert.equal(renewed.state.status,'running');
    const before=reads;complete=true;clockOffset+=INLINE_SNAPSHOT_INTERVAL_MS;
    for(let n=0;n<20;n++){
      await pause(100);
      if(JSON.parse((await files.read(path))!).state?.status==='complete')break;
    }
    const final=JSON.parse((await files.read(path))!);
    assert.equal(final.state.status,'complete');assert.equal(final.state.finalSaved,true);assert.equal(final.state.cleanupComplete,true);assert.equal(final.state.bindingCheckpoint.bindings[request.messageId].turnId,'turn');assert.equal(final.epoch,initial.epoch);assert.equal(final.owner,actor);
    assert.ok(reads>before,'Native coordination performs an independent canonical read');
    assert.match(document,/Recovered desktop final/);assert.match(document,/Outside edit/);assert.doesNotMatch(document,/Working|send-to-t3-inline-spinner|t3-inline:/);
  }finally{stop();manager.dispose();host.dispose();await pause(100);await rm(root,{recursive:true,force:true});}
});

test('one desktop host owns a vault and writes closed notes while deferring unsaved editors',async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-hosted-')),directory='.obsidian/t3-code/inline/v1',environmentId='env',vaultId='vault';
  const identity={workspaceRoot:root,directory,environmentId,vaultId},files=localInlineFiles(root,directory),id=randomUUID(),region=initialRegion(id);
  const request:HostedInlineRequest={version:1,id,vaultId,host:{workspaceRoot:root,directory,environmentId},notePath:'Note.md',threadId:randomUUID(),messageId:commandId(id,'message'),projectId:'p',threadEnvironmentId:environmentId,initialHash:region.bodyHash,createdAt:new Date().toISOString()};
  let document='User note\n'+region.text,unsaved=true,closed=false,complete=false,race=false,writes=0;
  const file={path:request.notePath};
  const app:any={workspace:{getLeavesOfType:()=>unsaved?[{view:{file,editor:{getValue:()=>document+'Unsaved'}}}]:[]},vault:{getFileByPath:()=>file,read:async()=>document,process:async(_:any,change:any)=>{if(race){race=false;document='Concurrent outside edit\n'+document;}const next=change(document);writes++;return document=next;}}};
  const access=async()=>({origin:'https://t3.example',close:()=>{closed=true;},api:async()=>({thread:{id:request.threadId,projectId:'p',messages:[{id:request.messageId,role:'user',text:'q',streaming:false,createdAt:request.createdAt},{id:'a',role:'assistant',turnId:'turn',text:complete?'Hosted final':'Hosted progress',streaming:!complete}],latestTurn:{turnId:'turn',requestedAt:request.createdAt,state:complete?'completed':'running'},session:{status:complete?'ready':'running',activeTurnId:complete?null:'turn'}}})});
  const host=await DesktopInlineHost.open(app,identity,access);
  try{
    await assert.rejects(DesktopInlineHost.open(app,identity,access),/Lock file is already being held/);
    await files.write(hostedPaths(directory,id).request,JSON.stringify(request));
    await host.tick();assert.doesNotMatch(document,/Hosted final/);
    unsaved=false;await host.tick();assert.match(document,/Hosted progress/);assert.equal(writes,1);
    await host.tick();assert.equal(writes,1,'Unchanged progress and probes do not rewrite the note');
    complete=true;race=true;await host.tick();assert.match(document,/Concurrent outside edit/);assert.match(document,/t3-inline:/);
    assert.equal(JSON.parse((await files.read(hostedPaths(directory,id).state))!).status,'running','A raced atomic edit must retry before marking completion');
    await host.tick();assert.match(document,/Hosted final/);assert.match(document,/Concurrent outside edit/);assert.doesNotMatch(document,/t3-inline:/);assert.equal(writes,2);
    const state=JSON.parse((await files.read(hostedPaths(directory,id).state))!);assert.equal(state.status,'complete');
  }finally{host.dispose();for(let n=0;n<30&&!closed;n++)await new Promise(r=>setTimeout(r,10));await rm(root,{recursive:true,force:true});}
  assert.equal(closed,true);
});
