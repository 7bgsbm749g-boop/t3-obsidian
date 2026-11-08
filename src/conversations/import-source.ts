import {isRecord} from '../shared/values';
import {readThreadList,readRawSnapshot} from '../connection/wire-readers';
import {normalizeV2Snapshot,responseRun} from '../connection/orchestration-v2';
import {readThreadSnapshot,type WireRun,type WireSnapshot} from '../connection/wire-types';
import {abortableRead,requestAborted} from '../connection/t3-api';
import {applyThreadItem} from './inline-thread';
import type {ThreadAccess} from './thread-stream';
import {readInlineSnapshot} from './thread-stream';
import type {InlineThreadState} from './inline-thread';
import type {ImportRun} from './run-import';
import {availableImportRun,importRuns,importRunPreview} from './run-import';
import {visibleInlineInput} from '../responses/input-presentation';
import type {ThreadChoice} from './thread-target';
import {projectThreads} from './thread-target';

const unsupported=(error:unknown)=>isRecord(error)&&error.status===404;
const legacyStates=new WeakMap<ImportRun,InlineThreadState>();
async function legacySnapshot(access:ThreadAccess,threadId:string,projectId:string,signal?:AbortSignal,preview=false,runId?:string){
  requestAborted(signal);
  const api=Object.assign((path:string,payload?:unknown)=>access.api(path,payload,{signal}),access.api);
  return abortableRead(readInlineSnapshot({...access,api},threadId,projectId,undefined,true,preview,runId),signal);
}

/** Catalog reads never require tool output or the answers of unrelated runs. */
export async function readImportThreads(access:ThreadAccess,projectId:string,signal?:AbortSignal):Promise<ThreadChoice[]>{
  requestAborted(signal);
  try{
    const value=await abortableRead(access.api(`/api/orchestration/import/projects/${encodeURIComponent(projectId)}/threads`,undefined,{signal}),signal);
    return readThreadList(value).filter(thread=>thread.projectId===projectId&&!thread.deletedAt&&!thread.archivedAt).map(thread=>({id:thread.id,projectId,title:thread.title??'T3 thread',updatedAt:thread.updatedAt??'',status:thread.status==='Active'?'Active':'Idle'}));
  }catch(error){
    if(!unsupported(error))throw error;requestAborted(signal);
    return projectThreads({threads:readThreadList(await abortableRead(access.api('/api/orchestration/shell',undefined,{signal}),signal))},projectId);
  }
}

export async function readImportRuns(access:ThreadAccess,threadId:string,projectId:string,signal?:AbortSignal):Promise<ImportRun[]>{
  const runs:ImportRun[]=[],seen=new Set<number>();let before:number|undefined;
  do{
    requestAborted(signal);
    let value:unknown;
    try{value=await abortableRead(access.api(`/api/orchestration/threads/${encodeURIComponent(threadId)}/import-runs${before===undefined?'':'?beforeOrdinal='+before}`,undefined,{signal}),signal);}
    catch(error){
      if(before!==undefined||!unsupported(error))throw error;
      const snapshot=await legacySnapshot(access,threadId,projectId,signal,true);
      const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
      return importRuns(state).filter(availableImportRun).map(run=>{legacyStates.set(run,state);return run;});
    }
    if(!isRecord(value)||!isRecord(value.thread)||value.thread.id!==threadId||value.thread.projectId!==projectId||!Array.isArray(value.runs))throw Error('T3 returned an invalid import run index.');
    for(const row of value.runs as unknown[]){
      if(!isRecord(row)||typeof row.id!=='string'||typeof row.status!=='string'||typeof row.prompt!=='string'||!Number.isSafeInteger(row.ordinal)||typeof row.requestedAt!=='string')throw Error('T3 returned an invalid import run identity.');
      if(typeof row.userMessageId!=='string')continue;
      const run=row as unknown as WireRun,turn=responseRun(run);
      const status:ImportRun['status']=row.status==='completed'?'Completed':row.status==='failed'?'Failed':['interrupted','cancelled','rolled_back','expired'].includes(row.status)?'Interrupted':'Running';
      const unavailable=row.status==='queued'?'This response has not started.':!Number.isFinite(Date.parse(row.requestedAt))?'T3 has no valid start time for this response.':undefined;
      runs.push({messageId:row.userMessageId,turnId:row.id,turn,prompt:visibleInlineInput(row.prompt),createdAt:row.requestedAt,status,...(unavailable?{unavailable}:{})});
    }
    if(value.nextOrdinal===null)break;
    if(!Number.isSafeInteger(value.nextOrdinal)||Number(value.nextOrdinal)<0||seen.has(Number(value.nextOrdinal))||before!==undefined&&Number(value.nextOrdinal)>=before)throw Error('T3 returned an invalid import page cursor.');
    before=Number(value.nextOrdinal);seen.add(before);
  }while(before!==undefined);
  return runs.filter(availableImportRun);
}

export async function readImportRun(access:ThreadAccess,threadId:string,projectId:string,runId:string,options:{preview?:boolean;signal?:AbortSignal;firstPageOnly?:boolean}={}){
  const {preview=false,signal,firstPageOnly=false}=options;
  let result:WireSnapshot|undefined,after:number|undefined;
  do{
    requestAborted(signal);
    const query=new URLSearchParams();if(preview)query.set('preview','1');if(firstPageOnly&&!preview)query.set('view','answer');if(after!==undefined)query.set('afterOrdinal',String(after));
    const suffix=query.toString();
    let value:unknown;
    try{value=await abortableRead(access.api(`/api/orchestration/threads/${encodeURIComponent(threadId)}/import-runs/${encodeURIComponent(runId)}${suffix?'?'+suffix:''}`,undefined,{signal}),signal);}
    catch(error){
      if(result||!unsupported(error))throw error;
      const snapshot=await legacySnapshot(access,threadId,projectId,signal,preview||firstPageOnly,preview||firstPageOnly?undefined:runId);
      return {snapshot,state:applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state};
    }
    if(!isRecord(value)||!Number.isSafeInteger(value.snapshotSequence))throw Error('T3 returned an invalid import snapshot.');
    const raw=readRawSnapshot({snapshotSequence:value.snapshotSequence,hasMoreHistory:value.hasMoreHistory===true||firstPageOnly&&value.nextOrdinal!==null,projection:value});
    if(!('projection' in raw)||raw.projection.thread.id!==threadId||raw.projection.thread.projectId!==projectId||raw.projection.runs.length!==1||raw.projection.runs[0].id!==runId)throw Error('T3 returned another response for this import.');
    if(!result)result=raw;
    else result={...result,projection:{...result.projection,messages:[...result.projection.messages,...raw.projection.messages],turnItems:[...result.projection.turnItems??[],...raw.projection.turnItems??[]]}};
    if(value.nextOrdinal===null)break;
    if(!Number.isSafeInteger(value.nextOrdinal)||Number(value.nextOrdinal)<0||after!==undefined&&Number(value.nextOrdinal)<=after)throw Error('T3 returned an invalid response page cursor.');
    if(firstPageOnly)break;
    after=Number(value.nextOrdinal);
  }while(after!==undefined);
  const snapshot=readThreadSnapshot(normalizeV2Snapshot(result));
  return {snapshot,state:applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state};
}

export async function readImportPreview(access:ThreadAccess,threadId:string,projectId:string,run:ImportRun,environmentId:string,signal?:AbortSignal){
  requestAborted(signal);
  const state=legacyStates.get(run)??(await readImportRun(access,threadId,projectId,run.turnId!,{preview:true,signal})).state;
  requestAborted(signal);
  return importRunPreview(state,run,environmentId,threadId);
}

/** The catalog contains every root. Page one contains the selected run's
 * complete conversation; remaining pages contain its tool history. */
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
