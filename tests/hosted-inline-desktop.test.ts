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
