import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localSyncReady} from '../local-sync-state';

const path='Notes/Test.md',baseline='a'.repeat(64),newer='b'.repeat(64);
function fixture(){
  let connected=true,status='syncing';
  const file={path,stat:{mtime:1000.25,size:200}};
  const local={path,previouspath:'',folder:false,hash:'',synchash:baseline,synctime:500,mtime:1001,size:200};
  const remote={path,folder:false,deleted:false,hash:baseline,uid:10};
  const sync={vaultId:'remote',initialized:true,initial:false,ready:true,pause:false,syncing:true,syncingPath:'.obsidian/plugins/example/main.js',
    getStatus:()=>status,server:{isConnected:()=>connected,lastMessageTs:Date.now(),notifyQueue:{promise:Promise.resolve()}},localFiles:{[path]:local},serverFiles:{[path]:remote},
    newServerFiles:[] as any[],fileRetry:{} as Record<string,unknown>};
  const app={internalPlugins:{getEnabledPluginById:()=>sync},vault:{getFileByPath:(candidate:string)=>candidate===path?file:undefined}};
  return {app,sync,file,local,remote,connected:(value:boolean)=>connected=value,status:(value:string)=>status=value,
    ready:()=>localSyncReady(app,path),drain:async()=>{localSyncReady(app,path);await Promise.resolve();}};
}

test('a current note can finish while unrelated plugin downloads remain queued and active',async()=>{
  const h=fixture();h.sync.newServerFiles.push({path:'.obsidian/plugins/example/main.js'},{path:'Other note.md'});
  assert.equal(h.ready(),false,'The notification tail must first settle');await h.drain();
  assert.equal(h.ready(),true);assert.equal(localSyncReady(h.app),false,'The old whole-vault gate is still busy');
  assert.equal(h.local.hash,'','Unsynced local typing need not match the server bytes');
});
test('a newer notification invalidates readiness before its decoded note metadata arrives',async()=>{
  const h=fixture();await h.drain();assert.equal(h.ready(),true);
  let release!:()=>void;
  h.sync.server.notifyQueue.promise=new Promise<void>(resolve=>{release=resolve;});
  assert.equal(h.ready(),false);await Promise.resolve();assert.equal(h.ready(),false);
  h.sync.newServerFiles.push({...h.remote,hash:newer,uid:11});release();await Promise.resolve();
  assert.equal(h.ready(),false,'A settled notification is not an applied note update');
  h.sync.newServerFiles.length=0;h.remote.hash=newer;assert.equal(h.ready(),false);
  h.local.synchash=newer;assert.equal(h.ready(),true);
});
test('a rejected notification tail cannot certify a current note',async()=>{
  const h=fixture();h.sync.server.notifyQueue.promise=Promise.reject(Error('Decode failed'));
  await h.drain();assert.equal(h.ready(),false);
});
test('pending changes to the note or its parents block final saving even with matching hashes',async()=>{
  for(const pending of [{path},{path:'Notes',folder:true,deleted:true},{path,deleted:true},{path,hash:baseline,uid:11}]){
    const h=fixture();await h.drain();h.sync.newServerFiles.push(pending);assert.equal(h.ready(),false,JSON.stringify(pending));
  }
});
test('a note transfer in progress waits while an unrelated transfer does not',async()=>{
  const h=fixture();await h.drain();h.sync.syncingPath=path;assert.equal(h.ready(),false);
  h.sync.syncingPath='Notes';assert.equal(h.ready(),false);
  h.sync.syncingPath='Notes/Test.md.backup';assert.equal(h.ready(),true);
});
test('per-note retry errors block their path and descendants',async()=>{
  const h=fixture();await h.drain();h.sync.fileRetry['Other.md']={};assert.equal(h.ready(),true);
  h.sync.fileRetry.Notes={};assert.equal(h.ready(),false);delete h.sync.fileRetry.Notes;
  h.sync.fileRetry[path]={};assert.equal(h.ready(),false);
});
test('uninitialized, incomplete, paused, and disconnected metadata cannot prove freshness',async()=>{
  const changes:Array<(h:ReturnType<typeof fixture>)=>void>=[h=>{h.sync.initialized=false;},h=>{h.sync.initial=true;},h=>{h.sync.ready=false;},h=>{h.sync.pause=true;},h=>h.connected(false)];
  for(const change of changes){
    const h=fixture();await h.drain();change(h);assert.equal(h.ready(),false);
  }
  for(const status of ['error','paused','disconnected','uninitialized']){const h=fixture();await h.drain();h.status(status);assert.equal(h.ready(),false,status);}
});
test('matching current-file hashes without a synced baseline never certify readiness',async()=>{
  const h=fixture();await h.drain();h.local.hash=baseline;h.local.synchash='';assert.equal(h.ready(),false);
  h.local.synchash=newer;assert.equal(h.ready(),false);h.local.synchash=baseline;h.local.synctime=0;assert.equal(h.ready(),false);
});
test('an OPEN but silent Sync socket cannot certify current metadata',async()=>{
  const h=fixture();await h.drain();h.sync.server.lastMessageTs=Date.now()-60_000;assert.equal(h.ready(),false);
  h.sync.server.lastMessageTs=NaN;assert.equal(h.ready(),false);
  h.sync.server.lastMessageTs=Date.now()+60_000;assert.equal(h.ready(),false);
  h.sync.server.lastMessageTs=Date.now();assert.equal(h.ready(),true);
});
test('changed file identity, disk stats, removed server files, and unacknowledged renames defer saving',async()=>{
  const changes:Array<(h:ReturnType<typeof fixture>)=>void>=[
    h=>{h.local.previouspath='Old.md';},h=>{h.file.path='Renamed.md';},h=>{h.file.stat.size++;},h=>{h.file.stat.mtime++;},
    h=>{h.remote.deleted=true;},h=>{h.remote.folder=true;},h=>{h.remote.uid=0;},h=>{delete (h.sync.serverFiles as any)[path];},
  ];
  for(const change of changes){const h=fixture();await h.drain();change(h);assert.equal(h.ready(),false);}
});
test('unknown pending records and invalid paths cannot silently skip the note checks',async()=>{
  for(const pending of [null,{},[],{path:''}]){const h=fixture();await h.drain();h.sync.newServerFiles.push(pending);assert.equal(h.ready(),false);}
  const h=fixture();await h.drain();for(const invalid of ['', '/Notes/Test.md','Notes/../Test.md','Notes//Test.md','Notes\\Test.md'])assert.equal(localSyncReady(h.app,invalid),false);
});
test('unsupported internals use the previous whole-vault gate instead of guessing',()=>{
  const h=fixture();delete (h.sync as any).localFiles;
  assert.equal(h.ready(),false);h.status('synced');assert.equal(h.ready(),true);
  h.sync.getStatus=()=>{throw Error('Unavailable');};assert.equal(h.ready(),false);
});
test('notes without a retained baseline still finish after the whole vault is synced',async()=>{
  const h=fixture();await h.drain();h.local.synchash='';assert.equal(h.ready(),false);
  h.status('synced');h.sync.syncing=false;assert.equal(h.ready(),true);
  h.local.synchash=newer;assert.equal(h.ready(),true,'A full Sync pass also covers equal-content acceptances without a new baseline');
  delete (h.sync.serverFiles as any)[path];assert.equal(h.ready(),true);
});
test('even a synced status cannot bypass known pending note changes',async()=>{
  const h=fixture();h.status('synced');h.sync.syncing=false;await h.drain();h.sync.newServerFiles.push({path});assert.equal(h.ready(),false);
});
test('disabled core Sync and other transports keep the checked local save path',()=>{
  assert.equal(localSyncReady({},path),true);
  assert.equal(localSyncReady({internalPlugins:{getEnabledPluginById:()=>({})}},path),true);
});
