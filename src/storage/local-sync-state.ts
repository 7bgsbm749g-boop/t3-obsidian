const notifications=new WeakMap<object,{complete:boolean}>();
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const affects=(candidate:string,path:string)=>candidate===path||path.startsWith(candidate+'/');

/** Notifications decode on a separate promise queue from file transfers.
 * Observe its existing tail without enqueueing work or touching Sync's state.
 * A newly queued notification immediately invalidates the previous observation. */
function notificationsReady(promise:unknown){
  if(!object(promise)||typeof promise.then!=='function')return false;
  let state=notifications.get(promise);
  if(!state){state={complete:false};notifications.set(promise,state);const observed=state;promise.then(()=>{observed.complete=true;},()=>{});}
  return state.complete;
}

/** Private Obsidian 1.14 Sync metadata. Unsupported shapes retain the original
 * whole-vault gate. A known shape must prove this note's last synced baseline
 * matches the applied server version, with no pending change for its path or
 * parents. Local unsynced typing is retained by the existing checked note IO;
 * equality of a cached current-file hash alone is never a readiness proof. */
function noteReady(app:any,sync:any,path:string):boolean|undefined {
  if(!object(sync.localFiles)||!object(sync.serverFiles)||!Array.isArray(sync.newServerFiles)||!object(sync.fileRetry)
    ||!object(sync.server)||typeof sync.server.isConnected!=='function'||typeof sync.server.lastMessageTs!=='number'||!object(sync.server.notifyQueue)
    ||!object(sync.server.notifyQueue.promise)||typeof sync.server.notifyQueue.promise.then!=='function'
    ||typeof sync.initialized!=='boolean'||typeof sync.initial!=='boolean'||typeof sync.ready!=='boolean'
    ||typeof sync.pause!=='boolean'||typeof sync.syncing!=='boolean'||typeof app.vault?.getFileByPath!=='function')return;
  if(!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'))return false;
  // The native connection receives heartbeat replies about every 20 seconds.
  // An OPEN but silent socket is not fresh metadata evidence.
  const silence=Date.now()-sync.server.lastMessageTs;
  if(!sync.initialized||sync.initial||!sync.ready||sync.pause||sync.server.isConnected()!==true||!Number.isFinite(silence)||silence< -1000||silence>45_000
    ||!notificationsReady(sync.server.notifyQueue.promise))return false;
  if(sync.syncing&&typeof sync.syncingPath==='string'&&affects(sync.syncingPath,path))return false;
  for(const pending of sync.newServerFiles){
    if(!object(pending)||typeof pending.path!=='string'||!pending.path||affects(pending.path,path))return false;
  }
  if(Object.keys(sync.fileRetry).some(candidate=>affects(candidate,path)))return false;
  const local=Object.hasOwn(sync.localFiles,path)?sync.localFiles[path]:undefined;
  const remote=Object.hasOwn(sync.serverFiles,path)?sync.serverFiles[path]:undefined;
  const file=app.vault.getFileByPath(path);
  if(!file||file.path!==path||!file.stat)return false;
  // New/excluded notes and an initial equal-content acceptance may have no
  // recorded baseline yet. They can use the old fully-synced gate, but cannot
  // take the shortcut while unrelated transfers are running.
  if(!object(local)||!object(remote)||!hash(local.synchash)||!hash(remote.hash)||!(local.synctime>0)||local.synchash!==remote.hash)return;
  return local.path===path&&remote.path===path&&local.folder===false&&remote.folder===false&&remote.deleted===false
    &&local.previouspath===''&&Number.isSafeInteger(remote.uid)&&remote.uid>0
    &&local.synchash===remote.hash
    &&typeof local.synctime==='number'&&Number.isFinite(local.synctime)&&local.synctime>0
    &&Number.isFinite(file.stat.mtime)&&Number.isFinite(file.stat.size)
    &&local.mtime===Math.ceil(file.stat.mtime)&&local.size===file.stat.size;
}

/** No common freshness API exists for other file-sync transports. Configured
 * core Sync can finish a current note while unrelated files keep transferring. */
export function localSyncReady(app:unknown,path?:string):boolean {
  try{
    const plugins=(app as any).internalPlugins;
    const sync=typeof plugins?.getEnabledPluginById==='function'?plugins.getEnabledPluginById('sync'):plugins?.plugins?.sync?.enabled?plugins.plugins.sync.instance:undefined;
    if(!sync?.vaultId)return true;
    const status=typeof sync.getStatus==='function'?sync.getStatus():undefined;
    if(status!=='synced'&&status!=='syncing')return false;
    return path===undefined?status==='synced':noteReady(app,sync,path)??status==='synced';
  }catch{return false;}
}
