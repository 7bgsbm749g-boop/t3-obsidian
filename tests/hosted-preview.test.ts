import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {HostedPreviewReader,hostedPreviewRanges} from '../hosted-preview';
import {hostedPaths,hostedRequestHash,type HostedInlineRequest,type HostedInlineState} from '../hosted-inline';
import {initialRegion} from '../inline-thread';

function fixture(){
  const id=randomUUID(),region=initialRegion(id),host={environmentId:'env',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'};
  const request:HostedInlineRequest={version:1,id,vaultId:'vault',host,notePath:'Test.md',threadId:'thread',messageId:randomUUID(),projectId:'project',threadEnvironmentId:'env',initialHash:region.bodyHash,createdAt:new Date().toISOString()};
  const state:HostedInlineState={requestHash:hostedRequestHash(request),accepted:true,notePath:'Test.md',status:'running',hashes:[region.bodyHash],body:'**T3 · Working**\n\n> Live paragraph',updatedAt:new Date().toISOString()};
  const paths=hostedPaths(host.directory,id),files=new Map([[paths.request,JSON.stringify(request)],[paths.state,JSON.stringify(state)]]);
  return {id,region,host,request,state,paths,files};
}

test('direct host progress is visible before Sync changes Sending, without mutating the note',async()=>{
  const f=fixture();let opened=0,closed=0;
  const reader=new HostedPreviewReader('vault',async()=>f.host,async()=>{opened++;return {files:{read:async path=>f.files.get(path),write:async()=>assert.fail('A preview must never write')},close:()=>{closed++;}};});
  const document='Question\n'+f.region.text+'Outside paragraph';
  const preview=await reader.read(f.id),ranges=hostedPreviewRanges(document,'Test.md',new Map([[f.id,preview!]]));
  assert.equal(ranges.length,1);assert.match(ranges[0].body,/Live paragraph/);
  assert.equal(document.slice(ranges[0].from,ranges[0].to),'**T3 · Sending…**');
  assert.equal(hostedPreviewRanges(document.replace('Sending…','My edit'),'Test.md',new Map([[f.id,preview!]])).length,0);
  assert.equal(hostedPreviewRanges(document,'Different.md',new Map([[f.id,preview!]])).length,0);
  await reader.read(f.id);assert.equal(opened,1);
  reader.dispose();await Promise.resolve();assert.equal(closed,1);
  assert.equal(await reader.read(f.id),undefined);
});

test('a preview rejects another vault and a stale or conflicting job',async()=>{
  const f=fixture();
  const reader=new HostedPreviewReader('vault',async()=>f.host,async()=>({files:{read:async path=>f.files.get(path),write:async()=>assert.fail()},close:()=>{}}));
  f.files.set(f.paths.state,JSON.stringify({...f.state,requestHash:'wrong'}));assert.equal(await reader.read(f.id),undefined);
  f.files.set(f.paths.state,JSON.stringify({...f.state,status:'conflict'}));assert.equal(await reader.read(f.id),undefined);
  f.files.set(f.paths.state,JSON.stringify(f.state));
  f.files.set(f.paths.request,JSON.stringify({...f.request,vaultId:'other'}));assert.equal(await reader.read(f.id),undefined);
  reader.dispose();
});

test('failed progress connections close and reconnect on the next poll',async()=>{
  const f=fixture();let fail=true,opened=0,closed=0;
  const reader=new HostedPreviewReader('vault',async()=>f.host,async()=>{opened++;return {files:{read:async path=>{if(fail)throw Error('offline');return f.files.get(path);},write:async()=>assert.fail()},close:()=>{closed++;}};});
  await assert.rejects(reader.read(f.id),/offline/);fail=false;
  assert.ok(await reader.read(f.id));assert.equal(opened,2);assert.equal(closed,1);reader.dispose();
});
