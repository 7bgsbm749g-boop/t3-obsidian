import type {ResponseRequest} from '../responses/response-model';
import type {ExplorerResponse} from '../responses/explorer-responses';
import {readInlineSnapshot,type ThreadAccess} from '../conversations/thread-stream';
import type {InboxNote} from './note-inbox';

export interface InboxThreadTarget {environmentId:string;projectId:string;threadId:string}
/** Historical bindings retain the original machine and thread, even after Stop. */
export function inboxThreadTargets(note:InboxNote,bindings:readonly ResponseRequest[],responses:readonly ExplorerResponse[]):InboxThreadTarget[]{
  const targets=new Map<string,InboxThreadTarget>();
  for(const id of note.ids){
    const binding=bindings.find(binding=>binding.id===id),completion=responses.find(response=>response.id===id)?.completion;
    const target=binding?{environmentId:binding.threadEnvironmentId,projectId:binding.projectId,threadId:binding.threadId}:completion;
    if(!target?.environmentId||!target.projectId||!target.threadId)throw Error('The T3 thread for a stream in this note is unavailable. Reattach that stream before settling the note.');
    const key=JSON.stringify([target.environmentId,target.threadId]),previous=targets.get(key);
    if(previous&&previous.projectId!==target.projectId)throw Error('The linked T3 thread has conflicting project details.');
    targets.set(key,{environmentId:target.environmentId,projectId:target.projectId,threadId:target.threadId});
  }
  if(!targets.size)throw Error('This note no longer has a T3 stream.');
  return [...targets.values()];
}
/** Check every destination first. A failed command never reports a local success.
 * T3 owns actual settlement, permissions, worktree cleanup and reopened state. */
export async function changeInboxThreads(targets:InboxThreadTarget[],settled:boolean,access:(environmentId:string)=>Promise<ThreadAccess>,check:()=>void,uuid:()=>string){
  const connections=new Map<string,ThreadAccess>(),commands:InboxThreadTarget[]=[];
  try{
    for(const target of targets){
      check();let connection=connections.get(target.environmentId);
      if(!connection){connection=await access(target.environmentId);connections.set(target.environmentId,connection);}
      const {thread}=await readInlineSnapshot(connection,target.threadId,target.projectId);
      check();
      if(thread.deletedAt||thread.archivedAt)continue;
      if(settled&&(thread.session?.activeTurnId||thread.latestTurn?.state==='running'||thread.hasPendingApprovals||thread.hasPendingUserInput||thread.backgroundLiveness))throw Error('Wait for the attached T3 threads to finish before settling this note.');
      if(!settled||thread.settledOverride!=='settled')commands.push(target);
    }
    for(const target of commands){
      check();await connections.get(target.environmentId)!.api('/api/orchestration/dispatch',{type:settled?'thread.settle':'thread.unsettle',commandId:uuid(),threadId:target.threadId,...(!settled?{reason:'user'}:{})});
    }
    check();
  }finally{await Promise.allSettled([...connections.values()].map(async connection=>{await connection.close?.();}));}
}
