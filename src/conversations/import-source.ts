import {readThreadList} from '../connection/wire-readers';
import {abortableRead,requestAborted} from '../connection/t3-api';
import {applyThreadItem,type InlineThreadState} from './inline-thread';
import {readInlineSnapshot,type ThreadAccess} from './thread-stream';
import type {ThreadSnapshot} from '../connection/wire-types';
import {availableImportRun,importRuns,importRunPreview,type ImportRun} from './run-import';
import {projectThreads,type ThreadChoice} from './thread-target';
import {ImportIndexCache} from './import-index-cache';
import {isRecord} from '../shared/values';
import {T3HttpError} from './thread-access-cache';
import {T3RpcError} from '../connection/t3-rpc';

const histories=new WeakMap<ImportRun,{snapshot:ThreadSnapshot;state:InlineThreadState}>();
const indexes=new ImportIndexCache();
async function readHistory(access:ThreadAccess,threadId:string,projectId:string,signal?:AbortSignal,conversation=false,runId?:string){
 requestAborted(signal);
 const api=Object.assign((path:string,payload?:unknown)=>access.api(path,payload,{signal}),access.api);
 return abortableRead(readInlineSnapshot({...access,api},threadId,projectId,undefined,true,conversation,runId),signal);
}

/** Use the same public shell, bounded snapshot and opaque history cursors as
 * a regular T3 client. No custom server endpoint is required. */
export async function readImportThreads(access:ThreadAccess,projectId:string,signal?:AbortSignal):Promise<ThreadChoice[]>{
 requestAborted(signal);
 const cached=access.api.cachedImportThreads?.(projectId);if(cached)return cached;
 const shell=await abortableRead(access.api('/api/orchestration/shell',undefined,{signal}),signal);
 return projectThreads({threads:readThreadList(shell)},projectId);
}

export async function readImportRuns(access:ThreadAccess,threadId:string,projectId:string,signal?:AbortSignal):Promise<ImportRun[]>{
 requestAborted(signal);
 let identity=access.api.importCacheIdentity;let head:unknown;
 if(identity){
  try{head=await abortableRead(access.api('/api/orchestration/import-head/'+encodeURIComponent(threadId),undefined,{signal}),signal);}
  catch(error){
   indexes.delete(identity,threadId);requestAborted(signal);
   if(error instanceof T3HttpError&&(error.status===401||error.status===403)||error instanceof T3RpcError&&error.kind==='EnvironmentAuthorizationError')throw error;
   // Older servers or an unavailable revision reader can still perform the
   // ordinary canonical read. They never receive a custom HTTP endpoint.
  }
  if(access.api.importCacheIdentity!==identity){indexes.delete(identity,threadId);identity=access.api.importCacheIdentity;}
 }
 const revision=isRecord(head)&&typeof head.revision==='string'?head.revision:undefined;
 if(identity&&revision&&isRecord(head)){
  if(head.threadId!==threadId||head.projectId!==projectId)throw Error('Waiting for the requested T3 thread.');
  const cached=indexes.read(identity,threadId,projectId,revision);if(cached){requestAborted(signal);return cached;}
 }
 const snapshot=await readHistory(access,threadId,projectId,signal,true);
 const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
 const runs=importRuns(state).filter(availableImportRun).map(run=>{histories.set(run,{snapshot,state});return run;});
 if(identity&&revision&&access.api.importCacheIdentity===identity)indexes.remember(identity,threadId,projectId,revision,runs,snapshot);
 return runs;
}

export async function readImportRun(access:ThreadAccess,threadId:string,projectId:string,runId:string,options:{preview?:boolean;signal?:AbortSignal;firstPageOnly?:boolean;selected?:ImportRun}={}){
 const {preview=false,signal,firstPageOnly=false,selected}=options;
 requestAborted(signal);
 const cached=selected&&histories.get(selected);
 // Paint the canonical answer read for this exact selection. Checked saving
 // still waits for a fresh authoritative read of the incomplete registration.
 const reusable=cached&&firstPageOnly&&selected.turnId===runId&&cached.snapshot.thread.id===threadId&&cached.snapshot.thread.projectId===projectId;
 let snapshot=reusable
  ? {...cached.snapshot,page:{hasMore:true}}
  : await readHistory(access,threadId,projectId,signal,preview||firstPageOnly,preview||firstPageOnly?undefined:runId);
 let state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
 // Older pages carry exact message/run bindings but may omit the recent-run
 // table entry. Preserve the lifecycle proved by the complete conversation;
 // the deliberately partial registration still cannot authorize a save.
 if(!state.turns?.[runId]){
  const proof=importRuns(reusable?cached.state:state).find(run=>run.turnId===runId&&availableImportRun(run));
  if(proof?.turn){state={...state,turns:{...state.turns,[runId]:proof.turn}};snapshot={...snapshot,thread:{...snapshot.thread,turns:state.turns}};}
 }
 if(!state.messages.some(message=>message.turnId===runId)&&!state.turns?.[runId])throw Error('T3 did not return the selected response.');
 return {snapshot,state};
}

export async function readImportPreview(access:ThreadAccess,threadId:string,projectId:string,run:ImportRun,environmentId:string,signal?:AbortSignal){
 requestAborted(signal);
 const state=histories.get(run)?.state??(await readImportRun(access,threadId,projectId,run.turnId!,{preview:true,signal})).state;
 requestAborted(signal);
 return importRunPreview(state,run,environmentId,threadId);
}

/** Retain exact catalog roots while selected history loads. Partial state
 * does not authorize a final checked save. */
export function importHistoryState(index:ImportRun[],selected:InlineThreadState,messageId:string){
  const turns:NonNullable<InlineThreadState['turns']>={...selected.turns};
  for(const run of index)if(run.turnId&&run.turn)turns[run.turnId]??=run.turn;
  const present=new Set(selected.messages.map(message=>message.id));
  const rootOrdinals=new Map(index.map(run=>[run.messageId,run.turn?.ordinal]));
  const messages:InlineThreadState['messages']=[...index.filter(run=>!present.has(run.messageId)).map(run=>({id:run.messageId,role:'user' as const,text:run.prompt,turnId:run.turnId??null,streaming:false,createdAt:run.createdAt})),...selected.messages];
  messages.sort((a,b)=>{
    const left=rootOrdinals.get(a.id)??(a.turnId?turns[a.turnId]?.ordinal:undefined),right=rootOrdinals.get(b.id)??(b.turnId?turns[b.turnId]?.ordinal:undefined);
    return (typeof left==='number'&&typeof right==='number'?left-right:0)||(a.createdAt??'').localeCompare(b.createdAt??'');
  });
  // Availability needs the exact root and lifecycle, not every tool detail.
  // Keep the returned state's incomplete-history flag intact for recovery.
  const run=importRuns({...selected,turns,historyComplete:true,messages:selected.messages.filter(message=>message.role!=='user'||message.id===messageId)}).find(run=>run.messageId===messageId);
  return {state:{...selected,turns,messages},run};
}
