import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {PendingClientReload,clientRuntimeHash,clientReloadEditorsSaved,readPendingReload,type PendingReloadIO,type PendingReloadRequest,type PendingReloadState} from '../src/app/pending-client-reload';
import type {App} from 'obsidian';

function fixture(){
  const request:PendingReloadRequest={version:1,id:randomUUID(),vaultId:randomUUID(),clientId:randomUUID(),releaseVersion:'0.0.421',runtimeSha256:{'main.js':'a'.repeat(64),'manifest.json':'b'.repeat(64),'styles.css':'c'.repeat(64)}};
  let raw:string|undefined=JSON.stringify(request),stored:PendingReloadState|undefined,reloads=0,reads=0,active=true,idle=true;
  let actual={...request.runtimeSha256};const results:Record<string,unknown>[]=[];
  const io:PendingReloadIO={client:{loadedVersion:'0.0.420',instanceId:'old'},vaultId:request.vaultId,clientId:request.clientId,
    request:async()=>raw,runtime:async()=>{reads++;return {...actual};},load:async()=>structuredClone(stored),save:async value=>{stored=structuredClone(value);},
    result:async value=>{results.push(structuredClone(value));},reload:async()=>{reloads++;return true;},active:()=>active,idle:()=>idle};
  return {request,io,engine:new PendingClientReload(io),results,stored:()=>stored,reloads:()=>reloads,reads:()=>reads,
    raw:(value:string|undefined)=>{raw=value;},files:(value:typeof actual)=>{actual=value;},active:(value:boolean)=>{active=value;},idle:(value:boolean)=>{idle=value;}};
}

test('an offline device waits for all synced bytes, reloads once and confirms after restart without a server',async()=>{
  const h=fixture();h.files({...h.request.runtimeSha256,'styles.css':'0'.repeat(64)});
  await h.engine.check();assert.equal(h.stored()?.status,'waiting-for-sync');assert.equal(h.reloads(),0);
  h.files(h.request.runtimeSha256);await h.engine.check();assert.equal(h.stored()?.status,'reload-issued');assert.equal(h.reloads(),1);
  await h.engine.check();assert.equal(h.reloads(),1);assert.equal(h.stored()?.status,'reload-unconfirmed');
  h.engine.dispose();h.io.client={loadedVersion:'0.0.421',instanceId:'new'};
  const restarted=new PendingClientReload(h.io);await restarted.check();assert.equal(h.stored()?.status,'confirmed');assert.equal(h.results.at(-1)?.status,'confirmed');assert.equal(h.reloads(),1);
});
test('a current loaded version still needs matching runtime files before confirmation',async()=>{
  const h=fixture();h.io.client.loadedVersion='0.0.421';h.files({...h.request.runtimeSha256,'main.js':'0'.repeat(64)});
  await h.engine.check();assert.equal(h.stored()?.status,'waiting-for-sync');h.files(h.request.runtimeSha256);
  await h.engine.check();assert.equal(h.stored()?.status,'confirmed');assert.equal(h.reloads(),0);
});
test('background and busy devices resume on foreground or idle transitions',async()=>{
  const h=fixture();h.active(false);await h.engine.check();assert.equal(h.stored()?.status,'waiting-for-foreground');assert.equal(h.reads(),0);
  h.active(true);h.idle(false);await h.engine.check();assert.equal(h.stored()?.status,'waiting-for-idle');assert.equal(h.reloads(),0);
  h.idle(true);await h.engine.idleChanged();assert.equal(h.reloads(),1);
});
test('unsaved editor changes wait for a save event instead of polling or reloading',async()=>{
  const h=fixture();let saved=false;h.io.editorsSaved=async()=>saved;
  await h.engine.check();assert.equal(h.stored()?.status,'waiting-for-save');assert.equal(h.reloads(),0);
  const reads=h.reads();assert.equal(h.engine.idleChanged(),undefined);assert.equal(h.reads(),reads);
  saved=true;await h.engine.saveChanged();assert.equal(h.reloads(),1);
});
test('the editor save guard refuses dirty or concurrently edited text and ignores Reading views',async()=>{
  let text='Saved text',disk=text;
  const view={file:{path:'Synthetic.md',stat:{size:10}},getMode:()=>'source',getViewData:()=>text};
  const app={workspace:{getLeavesOfType:()=>[{view}]},vault:{cachedRead:async()=>disk}} as unknown as Pick<App,'workspace'|'vault'>;
  assert.equal(await clientReloadEditorsSaved(app),true);text='Unsaved';assert.equal(await clientReloadEditorsSaved(app),false);
  disk=text;app.vault.cachedRead=async()=>{const previous=disk;text='Changed during read';return previous;};assert.equal(await clientReloadEditorsSaved(app),false);
  view.getMode=()=>'preview';assert.equal(await clientReloadEditorsSaved(app),true);
});
test('a request is scoped to its exact device and vault',async()=>{
  for(const key of ['clientId','vaultId'] as const){const h=fixture();h.raw(JSON.stringify({...h.request,[key]:randomUUID()}));await h.engine.check();assert.equal(h.reads(),0);assert.equal(h.reloads(),0);assert.equal(h.stored(),undefined);}
});
test('stale Sync requests and newer running versions cannot cause a downgrade',async()=>{
  const h=fixture();h.io.client.loadedVersion='0.0.422';await h.engine.check();assert.equal(h.stored()?.status,'superseded');assert.equal(h.reloads(),0);
  h.raw(JSON.stringify({...h.request,id:randomUUID(),releaseVersion:'0.0.419'}));await h.engine.check();assert.equal(h.stored()?.request.releaseVersion,'0.0.421');assert.equal(h.reloads(),0);
});
test('a newer request arriving during hashing cancels the older dispatch',async()=>{
  const h=fixture(),next={...h.request,id:randomUUID(),releaseVersion:'0.0.422',runtimeSha256:{...h.request.runtimeSha256,'manifest.json':'d'.repeat(64)}};
  const runtime=h.io.runtime;let changed=false;
  h.io.runtime=async()=>{if(!changed){changed=true;h.raw(JSON.stringify(next));}return runtime();};
  await h.engine.check();assert.equal(h.stored()?.request.releaseVersion,'0.0.422');assert.equal(h.stored()?.status,'waiting-for-sync');assert.equal(h.reloads(),0);
  h.files(next.runtimeSha256);await h.engine.check();assert.equal(h.reloads(),1);
});
test('missing requests do not spin and a missing runtime waits for Sync',async()=>{
  const h=fixture();h.io.runtime=async()=>{h.raw(undefined);return h.request.runtimeSha256;};await h.engine.check();assert.equal(h.stored()?.status,'waiting-for-request');assert.equal(h.reloads(),0);
  const missing=fixture();missing.io.runtime=async()=>{throw Error('File has not arrived.');};await missing.engine.check();assert.equal(missing.stored()?.status,'waiting-for-sync');
});
test('uncertain reloads and replacement IDs for the same runtime never dispatch a second reload',async()=>{
  const h=fixture();let attempts=0;h.io.reload=async()=>{attempts++;throw Error('Acknowledgement lost.');};
  await h.engine.check();assert.equal(h.stored()?.status,'reload-unconfirmed');
  h.raw(JSON.stringify({...h.request,id:randomUUID()}));await h.engine.check();assert.equal(attempts,1);
  const restarted=new PendingClientReload(h.io);await restarted.check();assert.equal(attempts,1);
});
test('a failed journal write blocks dispatch and a known busy deferral may resume',async()=>{
  const h=fixture(),save=h.io.save;h.io.save=async state=>{if(state.status==='reload-issued')throw Error('Storage unavailable.');return save(state);};
  await assert.rejects(h.engine.check(),/Storage unavailable/);assert.equal(h.reloads(),0);
  const deferred=fixture();deferred.io.reload=async()=>'deferred';await deferred.engine.check();assert.equal(deferred.stored()?.issuedFrom,undefined);
  deferred.io.reload=async()=>true;await deferred.engine.idleChanged();assert.equal(deferred.stored()?.status,'reload-issued');
});
test('changed input cannot reuse an ID or immutable release version',async()=>{
  const h=fixture();h.idle(false);await h.engine.check();h.raw(JSON.stringify({...h.request,runtimeSha256:{...h.request.runtimeSha256,'main.js':'d'.repeat(64)}}));await assert.rejects(h.engine.check(),/immutable/);
  h.raw(JSON.stringify({...h.request,releaseVersion:'0.0.422'}));await assert.rejects(h.engine.check(),/ID cannot change/);
});
test('JSON key ordering is irrelevant and malformed requests cannot name arbitrary files',()=>{
  const h=fixture();assert.deepEqual(readPendingReload(JSON.stringify({...h.request,runtimeSha256:Object.fromEntries(Object.entries(h.request.runtimeSha256).reverse())})),h.request);
  for(const value of [{...h.request,clientId:'../other'},{...h.request,releaseVersion:'0.0.0421'},{...h.request,runtimeSha256:{...h.request.runtimeSha256,'data.json':'a'.repeat(64)}}])assert.throws(()=>readPendingReload(JSON.stringify(value)));
});
test('binary runtime hashing preserves exact bytes on all platforms',()=>{
  const bytes=new Uint8Array([0,0xff,0xef,0xbb,0xbf,13,10]);assert.equal(clientRuntimeHash(bytes.buffer),createHash('sha256').update(bytes).digest('hex'));
});
