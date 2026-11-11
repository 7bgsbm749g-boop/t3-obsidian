import {sha256} from '@noble/hashes/sha2';
import {isRecord} from '../shared/values';
import type {App,MarkdownView} from 'obsidian';

export const clientRuntimeFiles=['main.js','manifest.json','styles.css'] as const;
export type ClientRuntimeHashes=Record<typeof clientRuntimeFiles[number],string>;
export interface PendingReloadRequest {version:1;id:string;vaultId:string;clientId:string;releaseVersion:string;runtimeSha256:ClientRuntimeHashes}
export interface PendingReloadState {request:PendingReloadRequest;issuedFrom?:string;status:string;error?:string}
export interface PendingReloadIO {
  client:{instanceId:string;loadedVersion:string};vaultId:string;clientId:string;
  request():Promise<string|undefined>;runtime():Promise<ClientRuntimeHashes>;
  load():Promise<PendingReloadState|undefined>;save(state:PendingReloadState):Promise<void>;
  result(value:Record<string,unknown>):Promise<void>;reload():Promise<boolean|'deferred'|'deferred-save'>;
  active():boolean;idle():boolean;
  editorsSaved?():Promise<boolean>;
}
/** Top-level configuration JSON follows Sync's core-plugin-data category;
 * arbitrary hidden subdirectories and custom plugin files are excluded. */
export const clientReloadPaths=(configDir:string,clientId:string)=>({request:`${configDir}/t-three-code-reload-request-v1-${clientId}.json`,result:`${configDir}/t-three-code-reload-result-v1-${clientId}.json`});
export const clientRuntimeHash=(bytes:ArrayBuffer)=>Array.from(sha256(new Uint8Array(bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
/** Automatic reloads must not discard dirty source editors. Inspect only open
 * views, bound each document, and recheck after the asynchronous disk read. */
export async function clientReloadEditorsSaved(app:Pick<App,'workspace'|'vault'>):Promise<boolean>{
  const views=app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file&&view.getMode()==='source');
  if(views.length>64)return false;
  for(const view of views){
    const file=view.file;if(!file)return false;
    const document=view.getViewData();if(document.length>8000000||file.stat.size>8000000)return false;
    let saved:string;try{saved=await app.vault.cachedRead(file);}catch{return false;}
    if(saved!==document||view.file?.path!==file.path||view.getViewData()!==document)return false;
  }
  return true;
}
const build=(version:string)=>/^0\.0\.(0|[1-9]\d*)$/.test(version)&&Number.isSafeInteger(Number(version.slice(4)))?Number(version.slice(4)):-1;
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const sameHashes=(a:ClientRuntimeHashes,b:ClientRuntimeHashes)=>clientRuntimeFiles.every(name=>a[name]===b[name]);

/** Synced configuration can request only one exact device and immutable runtime. */
export function readPendingReload(raw:string):PendingReloadRequest {
  if(raw.length>4096)throw Error('Device reload request is too large.');
  const value:unknown=JSON.parse(raw);
  if(!isRecord(value)||value.version!==1||!uuid(value.id)||!uuid(value.vaultId)||!uuid(value.clientId)||typeof value.releaseVersion!=='string'||build(value.releaseVersion)<0)throw Error('Invalid pending device reload request.');
  const hashes=value.runtimeSha256;
  if(!isRecord(hashes)||Object.keys(hashes).length!==3||clientRuntimeFiles.some(name=>typeof hashes[name]!=='string'||!/^[a-f0-9]{64}$/.test(String(hashes[name]))))throw Error('Invalid pending runtime hashes.');
  return {version:1,id:value.id,vaultId:value.vaultId,clientId:value.clientId,releaseVersion:value.releaseVersion,runtimeSha256:{'main.js':String(hashes['main.js']),'manifest.json':String(hashes['manifest.json']),'styles.css':String(hashes['styles.css'])}};
}

/** A device-owned journal survives suspension and reload. No timers or remote
 * connection are needed: startup, resume and relevant file events drive it. */
export class PendingClientReload {
  private running?:Promise<void>;
  private again=false;
  private stopped=false;
  private state?:PendingReloadState;
  private loaded=false;
  private lastResult='';
  constructor(private io:PendingReloadIO){}
  check():Promise<void>{
    if(this.stopped)return Promise.resolve();
    if(this.running){this.again=true;return this.running;}
    const work=(async()=>{do{this.again=false;await this.run();}while(this.again&&!this.stopped);})();
    this.running=work.finally(()=>{this.running=undefined;});return this.running;
  }
  /** Existing response ticks supply only the idle transition, not file polling. */
  idleChanged(){if(this.state?.status==='waiting-for-idle'&&this.io.active()&&this.io.idle())return this.check();}
  saveChanged(){if(this.state?.status==='waiting-for-save')return this.check();}
  dispose(){this.stopped=true;}
  private async publish(status:string,error?:string){
    const state=this.state;if(!state||this.stopped)return;
    if(state.status!==status||state.error!==error){state.status=status;state.error=error;await this.io.save(state);}
    const result={version:1,id:state.request.id,vaultId:this.io.vaultId,clientId:this.io.clientId,releaseVersion:state.request.releaseVersion,runtimeSha256:state.request.runtimeSha256,status,client:this.io.client,...(state.issuedFrom?{previousInstanceId:state.issuedFrom}:{}),...(error?{error}:{})};
    const serialized=JSON.stringify(result);
    if(serialized!==this.lastResult){await this.io.result(result);this.lastResult=serialized;}
  }
  private async run(){
    if(this.stopped)return;
    if(!this.loaded){this.state=await this.io.load();this.loaded=true;}
    const raw=await this.io.request();
    if(this.stopped)return;
    if(raw!==undefined){
      const next=readPendingReload(raw);
      if(next.vaultId!==this.io.vaultId||next.clientId!==this.io.clientId)return;
      const previous=this.state?.request;
      if(previous&&build(next.releaseVersion)===build(previous.releaseVersion)&&!sameHashes(next.runtimeSha256,previous.runtimeSha256))throw Error('A device reload cannot replace an immutable version with different files.');
      if(previous?.id===next.id&&JSON.stringify(previous)!==JSON.stringify(next))throw Error('A device reload request ID cannot change its input.');
      if(!previous||build(next.releaseVersion)>build(previous.releaseVersion)||build(next.releaseVersion)===build(previous.releaseVersion)&&next.id!==previous.id){
        // Preserve an issued attempt for identical bytes even if the submitting
        // agent uses a new ID. Sync must not turn lost acknowledgement into a loop.
        const issuedFrom=previous&&sameHashes(next.runtimeSha256,previous.runtimeSha256)?this.state?.issuedFrom:undefined;
        this.state={request:next,status:'pending',...(issuedFrom?{issuedFrom}:{})};await this.io.save(this.state);
      }
    }
    const state=this.state;if(!state||this.stopped)return;
    if(build(this.io.client.loadedVersion)<0)throw Error('Unknown running version; device reload was not dispatched.');
    if(build(this.io.client.loadedVersion)>build(state.request.releaseVersion)){await this.publish('superseded');return;}
    if(!this.io.active()){await this.publish('waiting-for-foreground');return;}
    let actual:ClientRuntimeHashes;
    try{actual=await this.io.runtime();}catch{await this.publish('waiting-for-sync');return;}
    if(this.stopped)return;
    if(!sameHashes(actual,state.request.runtimeSha256)){await this.publish('waiting-for-sync');return;}
    if(this.io.client.loadedVersion===state.request.releaseVersion&&(!state.issuedFrom||state.issuedFrom!==this.io.client.instanceId)){await this.publish('confirmed');return;}
    if(state.issuedFrom){await this.publish('reload-unconfirmed','The recorded reload has not returned the expected running version. No repeat was dispatched.');return;}
    if(!this.io.idle()){await this.publish('waiting-for-idle');return;}
    if(this.io.editorsSaved&&!await this.io.editorsSaved()){await this.publish('waiting-for-save');return;}
    // Re-read immediately before committing the one-shot dispatch. A newer
    // request or a Sync write observed during hashing invalidates this attempt.
    const latest=await this.io.request();
    if(latest===undefined||JSON.stringify(readPendingReload(latest))!==JSON.stringify(state.request)){
      if(latest!==undefined&&build(readPendingReload(latest).releaseVersion)>build(state.request.releaseVersion))this.again=true;
      await this.publish('waiting-for-request');return;
    }
    try{actual=await this.io.runtime();}catch{await this.publish('waiting-for-sync');return;}
    if(!sameHashes(actual,state.request.runtimeSha256)){await this.publish('waiting-for-sync');return;}
    if(this.stopped||!this.io.active()||!this.io.idle()){await this.publish('waiting-for-idle');return;}
    state.issuedFrom=this.io.client.instanceId;await this.publish('reload-issued');
    if(this.stopped)return;
    try{
      const result=await this.io.reload();
      if(result==='deferred'||result==='deferred-save'){delete state.issuedFrom;await this.publish(result==='deferred'?'waiting-for-idle':'waiting-for-save');}
      else if(!result)await this.publish('reload-unconfirmed','Obsidian refused the native reload. No repeat was dispatched.');
    }
    catch{await this.publish('reload-unconfirmed','The native reload result is uncertain. No repeat was dispatched.');}
  }
}
