import {isRecord} from '../shared/values';
import type {SmartCapture} from '../notes/smart-send';
import type {ResolvedJobOptions} from '../conversations/job-options';
import type {NoteCommand} from '../notes/note-command';
import {logEvent,logFailure} from './diagnostics';
import {readDirect,sendDirect,type PairedSession,type DirectPlan,type DirectReadOptions} from '../connection/direct';
import {abortableRead,requestAborted} from '../connection/t3-api';
import type { ImageAttachment, ImageContext } from '../notes/images';
import type { NoteCompletion } from '../responses/completion';
import type { NoteThread } from '../notes/note-threads';
import type {FolderLink} from '../projects/folder-link';
import type {ResponseRequest} from '../responses/response-model';
import type {ThreadAccess} from '../conversations/thread-stream';
import type {SteeringInput} from '../conversations/inline-steering';
export interface Project { id: string; title: string; workspaceRoot: string; connectionId?:string; connectionName?:string }
export function projectKey(project:Project){return project.connectionId?`${project.connectionId}:${project.id}`:project.id;}
export function projectLabel(project:Project){return project.title+(project.connectionName?` · ${project.connectionName}`:'');}
export interface Connection { executable: string; host: string; scriptPath?: string; transport?: 'desktop'|'https'|'direct'; url?: string; native?:boolean; baseDir?:string; stateDir?:string;connectionId?:string;environmentId?:string }
export interface Request {hideObsidianThread?:boolean;smartSend?:SmartCapture;acceptedThreadId?:string;jobOptions?:ResolvedJobOptions;agentCommand?:NoteCommand; id: string; project: Project; title: string; prompt: string; connection: Connection; threadId?:string; folderLinkIntent?:FolderLink; attachments?: ImageAttachment[]; context?: ImageContext; completion?: NoteCompletion; noteThread?:Omit<NoteThread,'threadId'|'selectedAt'>;/** Legacy saved request field; only read when resuming old requests. */noteLink?:Omit<NoteThread,'threadId'|'selectedAt'>;directPlan?:DirectPlan;inlineHost?:ResponseRequest;inlineBindings?:ResponseRequest[];inlineSteering?:{jobId:string;host?:ResponseRequest['host'];input:SteeringInput;targets?:Array<{jobId:string;host?:ResponseRequest['host'];notePath:string}>};inlineFollow?:{jobId:string;host?:ResponseRequest['host'];notePath?:string;previousMessageId:string;messageId:string} }
/** A receipt/started plan proves acceptance even if a later local save fails. */
export function acceptedRequestThread(request?:Request):string|undefined{return request?.acceptedThreadId??(request?.directPlan?.phase==='started'?request.directPlan.turn.threadId:undefined);}
export class RequestDeliveryError extends Error {
  constructor(message:string,readonly requestSaved:boolean,readonly terminal=false){super(message);}
}
export function parseProjects(value: unknown): Project[] {
  if (!isRecord(value)||!Array.isArray(value.projects)) throw new Error('T3 returned an invalid project list.');
  const ids = new Set<string>();
  return value.projects.map((p: unknown) => {
    if (!isRecord(p) || typeof p.id !== 'string' || !p.id || typeof p.title !== 'string' || !p.title || typeof p.workspaceRoot !== 'string' || ids.has(p.id)) throw new Error('T3 returned an invalid or duplicate project.');
    ids.add(p.id); return {id:p.id,title:p.title,workspaceRoot:p.workspaceRoot};
  });
}
interface Runtime {mobile:boolean;access?:(environmentId:string)=>Promise<ThreadAccess>;pairedSession?:(id:string)=>PairedSession|undefined|Promise<PairedSession|undefined>;saveRequest?:(request:Request)=>Promise<void>}
let runtime:Runtime|undefined;
export function configureBridge(value:Runtime) {runtime=value;}
// The retired value remains readable only to reject old persisted work safely.
export function retiredConnection(c:Connection){return c.transport!=='direct';}
export const RETIRED_MESSAGE='The old companion mode was removed. Check this request in T3 before sending again through Direct T3 pairing; it may already have started. The note is kept.';
export async function runBridge(connection:Connection,args:string[],input='',options:DirectReadOptions={}):Promise<unknown> {
  const operation=args[0],started=Date.now();logEvent('transport.operation.started',{operation,control:options.control,transport:connection.transport??'desktop',environmentId:connection.environmentId});
  try{
  requestAborted(options.signal);let result:unknown;
  if(connection.transport==='direct'){
    const access=connection.environmentId&&runtime?.access?await abortableRead(runtime.access(connection.environmentId),options.signal):undefined;
    try{result=await readDirect(connection,args,access?undefined:await abortableRead(Promise.resolve(runtime?.pairedSession?.(connection.connectionId??'')),options.signal),undefined,{...options,access});}finally{await access?.close?.();}
  }
  else throw Error('Reconnect this saved request through T3 Connect. Check its existing thread before sending again.');
  logEvent('transport.operation.completed',{operation,control:options.control,elapsedMs:Date.now()-started,transport:connection.transport??'desktop',environmentId:connection.environmentId});return result;
  }catch(error){logFailure('transport.operation.failed',error,{operation,control:options.control,cancelled:options.signal?.aborted,elapsedMs:Date.now()-started,transport:connection.transport??'desktop',environmentId:connection.environmentId});throw error;}
}
export async function sendRequest(request: Request) {
  if(request.connection.transport==='direct'){
    if(!runtime?.saveRequest)throw Error('Direct request storage is unavailable.');
    const access=request.connection.environmentId&&runtime.access?await runtime.access(request.connection.environmentId):undefined;
    try{return await sendDirect(request,access?undefined:await runtime.pairedSession?.(request.connection.connectionId??''),()=>runtime!.saveRequest!(request),undefined,access);}finally{await access?.close?.();}
  }
  throw Error('Reconnect this request through T3 Connect before sending.');
}
