import type {ResolvedJobOptions} from './job-options';
import type {NoteCommand} from './note-command';
import {logEvent,logFailure} from './diagnostics';
import {readDirect,sendDirect,type PairedSession,type DirectPlan} from './direct';
import type { ImageAttachment, ImageContext } from './images';
import type { NoteCompletion } from './completion';
import type { NoteThread } from './note-threads';
import type {FolderLink} from './folder-link';
import type {HostedInlineRequest} from './hosted-inline';
import type {SteeringInput} from './inline-steering';
export interface Project { id: string; title: string; workspaceRoot: string; connectionId?:string; connectionName?:string }
export function projectKey(project:Project){return project.connectionId?`${project.connectionId}:${project.id}`:project.id;}
export function projectLabel(project:Project){return project.title+(project.connectionName?` · ${project.connectionName}`:'');}
export interface Connection { executable: string; host: string; scriptPath?: string; transport?: 'desktop'|'https'|'direct'; url?: string; native?:boolean; baseDir?:string; stateDir?:string;connectionId?:string;environmentId?:string }
export interface Request {jobOptions?:ResolvedJobOptions;agentCommand?:NoteCommand; id: string; project: Project; title: string; prompt: string; connection: Connection; threadId?:string; folderLinkIntent?:FolderLink; attachments?: ImageAttachment[]; context?: ImageContext; completion?: NoteCompletion; noteThread?:Omit<NoteThread,'threadId'|'selectedAt'>;/** Legacy saved request field; only read when resuming old requests. */noteLink?:Omit<NoteThread,'threadId'|'selectedAt'>;directPlan?:DirectPlan;inlineHost?:HostedInlineRequest;inlineBindings?:HostedInlineRequest[];inlineSteering?:{jobId:string;host?:HostedInlineRequest['host'];input:SteeringInput};inlineFollow?:{jobId:string;host?:HostedInlineRequest['host'];notePath?:string;previousMessageId:string;messageId:string} }
export class RequestDeliveryError extends Error {
  constructor(message:string,readonly requestSaved:boolean){super(message);}
}
export function parseProjects(value: any): Project[] {
  if (!Array.isArray(value?.projects)) throw new Error('T3 returned an invalid project list.');
  const ids = new Set<string>();
  return value.projects.map((p: any) => {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.title !== 'string' || !p.title || typeof p.workspaceRoot !== 'string' || ids.has(p.id)) throw new Error('T3 returned an invalid or duplicate project.');
    ids.add(p.id); return {id:p.id,title:p.title,workspaceRoot:p.workspaceRoot};
  });
}
interface Runtime {mobile:boolean; pairedSession?:(id:string)=>PairedSession|undefined|Promise<PairedSession|undefined>;saveRequest?:(request:Request)=>Promise<void>}
let runtime:Runtime|undefined;
export function configureBridge(value:Runtime) {runtime=value;}
// The retired value remains readable only to reject old persisted work safely.
export function retiredConnection(c:Connection){return c.transport==='https'||(c.host!=='local'&&c.transport!=='direct');}
export const RETIRED_MESSAGE='The old companion mode was removed. Check this request in T3 before sending again through Direct T3 pairing; it may already have started. The note is kept.';
export async function withTimeout<T>(promise:Promise<T>, milliseconds:number):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Request timed out. Retry the saved request with its original ID.')),milliseconds);})]);}
  finally{clearTimeout(timer);}
}
export async function runBridge(connection:Connection,args:string[],input=''):Promise<any> {
  const operation=args[0];logEvent('transport.operation.started',{operation,transport:connection.transport??'desktop',environmentId:connection.environmentId});
  try{
  if(connection.transport==='direct')return await readDirect(connection,args,await runtime?.pairedSession?.(connection.connectionId??''));
  if(retiredConnection(connection))throw new Error(RETIRED_MESSAGE);
  if(runtime?.mobile)throw new Error('This saved request uses the local T3 connection. Retry it on the desktop where it was sent. On mobile, create new sends using Direct T3 pairing.');
  return await (await import('./desktop')).runDesktop(connection,args,input);
  }catch(error){logFailure('transport.operation.failed',error,{operation,transport:connection.transport??'desktop',environmentId:connection.environmentId});throw error;}
}
export async function sendRequest(request: Request) {
  if(request.connection.transport==='direct'){if(!runtime?.saveRequest)throw Error('Direct request storage is unavailable.');return sendDirect(request,await runtime.pairedSession?.(request.connection.connectionId??''),()=>runtime!.saveRequest!(request));}
  const hasPayload = Boolean(request.attachments?.length||request.threadId);
  const result = await runBridge(request.connection, ['start','--project',request.project.id,'--title',request.title,'--request-id',request.id,hasPayload ? '--payload-file' : '--prompt-file','-'], hasPayload ? JSON.stringify({prompt:request.prompt,attachments:request.attachments,context:request.context,threadId:request.threadId}) : request.prompt);
  if (result.ok !== true || result.phase!=='started' || typeof result.threadId !== 'string' || result.projectId !== request.project.id) throw new Error('T3 did not confirm the new turn. Retry the saved request.');
  return result as {threadId:string;phase:'started'};
}
