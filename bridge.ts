import {readDirect,sendDirect,type PairedSession,type DirectPlan} from './direct';
import type { ImageAttachment, ImageContext } from './images';
import type { NoteCompletion } from './completion';
export interface Project { id: string; title: string; workspaceRoot: string; connectionId?:string; connectionName?:string }
export function projectKey(project:Project){return project.connectionId?`${project.connectionId}:${project.id}`:project.id;}
export function projectLabel(project:Project){return project.title+(project.connectionName?` · ${project.connectionName}`:'');}
export interface Connection { executable: string; host: string; scriptPath?: string; transport?: 'desktop'|'https'|'direct'; url?: string; native?:boolean; baseDir?:string; stateDir?:string;connectionId?:string;environmentId?:string }
export interface Request { id: string; project: Project; title: string; prompt: string; connection: Connection; attachments?: ImageAttachment[]; context?: ImageContext; completion?: NoteCompletion;directPlan?:DirectPlan }
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
  if(connection.transport==='direct')return readDirect(connection,args,await runtime?.pairedSession?.(connection.connectionId??''));
  if(retiredConnection(connection))throw new Error(RETIRED_MESSAGE);
  if(runtime?.mobile)throw new Error('This saved request uses the local T3 connection. Retry it on the desktop where it was sent. On mobile, create new sends using Direct T3 pairing.');
  return (await import('./desktop')).runDesktop(connection,args,input);
}
export async function sendRequest(request: Request) {
  if(request.connection.transport==='direct'){if(!runtime?.saveRequest)throw Error('Direct request storage is unavailable.');return sendDirect(request,await runtime.pairedSession?.(request.connection.connectionId??''),()=>runtime!.saveRequest!(request));}
  const hasImages = Boolean(request.attachments?.length);
  const result = await runBridge(request.connection, ['start','--project',request.project.id,'--title',request.title,'--request-id',request.id,hasImages ? '--payload-file' : '--prompt-file','-'], hasImages ? JSON.stringify({prompt:request.prompt,attachments:request.attachments,context:request.context}) : request.prompt);
  if (result.ok !== true || result.phase!=='started' || typeof result.threadId !== 'string' || result.projectId !== request.project.id) throw new Error('T3 did not confirm the new turn. Retry the saved request.');
  return result as {threadId:string;phase:'started'};
}
