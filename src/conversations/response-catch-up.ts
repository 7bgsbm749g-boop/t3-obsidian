import type {ResponseBindingData} from '../responses/response-binding-data';
import type {ImportSource} from '../responses/response-command';
import {runImportReceipts} from './run-import-receipt';
import type {ImportRun} from './run-import';

export interface CatchUpThread extends ImportSource {
  title:string;
  messageIds:string[];
  turnIds:string[];
}
export const catchUpThreadKey=(source:ImportSource)=>JSON.stringify([source.environmentId,source.projectId,source.threadId]);

/** A previous send without a response binding is not evidence of a stream.
 * Finished bindings remain in synced settings after their note markers go. */
export function noteCatchUpThreads(notePath:string,vaultId:string,bindings:ResponseBindingData,document='',liveTurns?:(bindingId:string)=>readonly string[]):CatchUpThread[]{
  const threads=new Map<string,CatchUpThread>();
  const add=(source:ImportSource,messageIds:string[],turnIds:string[],title?:string)=>{
    const key=catchUpThreadKey(source);
    let thread=threads.get(key);
    if(!thread){thread={...source,title:title??`T3 thread · ${source.threadId.slice(0,8)}`,messageIds:[],turnIds:[]};threads.set(key,thread);}
    if(title)thread.title=title;
    for(const id of messageIds)if(!thread.messageIds.includes(id))thread.messageIds.push(id);
    for(const id of turnIds)if(!thread.turnIds.includes(id))thread.turnIds.push(id);
  };
  for(const {request,completion} of Object.values(bindings)){
    if(request.vaultId!==vaultId||request.notePath!==notePath||!request.localOnly)continue;
    add({environmentId:request.threadEnvironmentId,projectId:request.projectId,threadId:request.threadId},
      [request.messageId,...(request.localMessageId?[request.localMessageId]:[]),...request.localSteering?.map(input=>input.messageId)??[]],
      [...[completion?.turnId,request.importTurn?.turnId].filter((id):id is string=>!!id),...liveTurns?.(request.id)??[]],request.threadTitle);
  }
  for(const {receipt} of runImportReceipts(document))add({environmentId:receipt.environmentId,projectId:receipt.projectId,threadId:receipt.threadId},[receipt.messageId],[receipt.runId]);
  return [...threads.values()];
}

/** The catalog is newest first. Use exact source identities, never local save
 * times or note order: imports and Sync can deliver older runs later. */
export function catchUpRuns(thread:CatchUpThread,catalog:ImportRun[]):ImportRun[]{
  const messages=new Set(thread.messageIds),turns=new Set(thread.turnIds);
  const boundary=catalog.findIndex(run=>messages.has(run.messageId)||!!run.turnId&&turns.has(run.turnId));
  if(boundary<0)throw Error('The last streamed response is missing from the T3 run history. No responses were imported.');
  return catalog.slice(0,boundary).reverse();
}
