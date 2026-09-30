import {contentHash} from './completion';
import {commandId} from './direct';
import {applyThreadItem,finalizeRegion,regionBody,inlineTurnMessages,renderInlineTurn,replaceRegion,turnForMessage,turnPhase} from './inline-thread';
import type {ThreadAccess} from './thread-stream';
import {sameWorkspacePath} from './folder-link';
import {rewriteReplyReferences,type ReplyReference} from './reply-assets';

export interface InlineHostTarget {environmentId:string;workspaceRoot:string;directory:string;connectionId?:string}
export interface HostedInlineRequest {
  keepIntermediate?:boolean;
  version:1|2;initialOwner?:string;id:string;vaultId:string;host:InlineHostTarget;notePath:string;
  threadId:string;messageId:string;projectId:string;threadEnvironmentId:string;initialHash:string;createdAt:string;
}
export interface HostedInlineState {
  requestHash:string;accepted:boolean;notePath:string;turnId?:string;messageId?:string;pendingMessageId?:string;
  status:'waiting'|'running'|'complete'|'interrupted'|'error'|'conflict'|'paused';
  hashes:string[];body?:string;detail?:string;updatedAt:string;
  finalDocumentHash?:string;
}
export interface InlineFiles {
  read(path:string):Promise<string|undefined>;
  write(path:string,contents:string):Promise<void>;
}
export const hostedPaths=(directory:string,id:string)=>({request:`${directory}/requests/${id}.json`,state:`${directory}/states/${id}.json`,stop:`${directory}/stops/${id}.json`});
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function safeNotePath(path:unknown):path is string {
  return typeof path==='string'&&path.endsWith('.md')&&!path.includes('\\')&&!/[\x00-\x1f:]/.test(path)&&path.split('/').every(p=>!!p&&p!=='.'&&p!=='..'&&!p.startsWith('.'));
}
export function validateHostedRequest(value:any):HostedInlineRequest {
  if(value?.keepIntermediate!==undefined&&typeof value.keepIntermediate!=='boolean')throw Error('Invalid hosted response preference.');
  if(![1,2].includes(value?.version)||(value.version===2&&!uuid.test(value.initialOwner??''))||![value.id,value.messageId].every(x=>typeof x==='string'&&uuid.test(x))||!safeNotePath(value.notePath)||
    ![value.threadId,value.vaultId,value.projectId,value.threadEnvironmentId,value.createdAt,value.host?.environmentId,value.host?.workspaceRoot,value.host?.directory].every(x=>typeof x==='string'&&x.length>0)||
    !/^[0-9a-f]{64}$/.test(value.initialHash))throw Error('Invalid hosted response job.');
  return value;
}
export function hostedRequestHash(request:HostedInlineRequest){return contentHash(JSON.stringify(request));}

/** Persist before dispatch. Acknowledgement means the host has both the anchor
 * and its own T3 access; the sending device is no longer needed after dispatch. */
export async function handoffInline(files:InlineFiles,request:HostedInlineRequest,active:()=>boolean=()=>true,pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))){
  validateHostedRequest(request);
  const paths=hostedPaths(request.host.directory,request.id),bytes=JSON.stringify(request),existing=await files.read(paths.request);
  if(existing!==undefined&&existing!==bytes)throw Error('This response ID already belongs to a different hosted job.');
  if(existing===undefined)await files.write(paths.request,bytes);
  for(let attempt=0;attempt<25;attempt++){
    if(!active())throw Error('Response handoff was interrupted. Retry the saved request.');
    const raw=await files.read(paths.state);
    if(raw){
      const state:HostedInlineState=JSON.parse(raw);
      if(state.requestHash!==hostedRequestHash(request))throw Error('The streaming host returned a different response job.');
      if(state.status==='conflict')throw Error(state.detail||'The response block changed before the host accepted it.');
      if(state.accepted)return;
    }
    if(attempt<24)await pause(1000);
  }
  throw Error('The vault project machine has not accepted this response yet. Keep Obsidian with the updated plugin open there and let this note finish syncing, then retry the saved request.');
}

export interface HostedWriterIO extends InlineFiles {
  requests():Promise<string[]>;
  access(environmentId:string):Promise<ThreadAccess>;
  // undefined means the file is missing or has unsaved editor changes. The
  // callback must execute against the latest content in an atomic vault edit.
  updateNote(path:string,change:(current:string)=>string):Promise<string|undefined>;
  threadState?(request:HostedInlineRequest,access:ThreadAccess):Promise<import('./inline-thread').InlineThreadState|undefined>;
  accepts?(request:HostedInlineRequest):boolean;
  /** Only the still-open editor that paused this response may resume it. */
  canResume?(path:string):boolean;
  importReplyAsset?(reference:ReplyReference,request:HostedInlineRequest,access:ThreadAccess):Promise<string|undefined>;
}

/** Each request has its own serial worker. Requests and write-ahead hashes are durable;
 * no sender socket, editor tab, or synced credentials participate in writing. */
export class HostedInlineWriter {
  private stopped=false;
  private work=new Map<string,Promise<void>>();
  private renameOffsets=new Map<string,number>();
  private renames:Array<{before:string;after:string}>=[];
  constructor(private identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},private io:HostedWriterIO){}
  stop(){this.stopped=true;}
  renamed(before:string,after:string){this.renames.push({before,after});}
  async tick(){
    const paths=await this.io.requests();
    const results=await Promise.allSettled(paths.map(path=>{
      if(this.stopped||this.work.has(path))return;
      const work=this.process(path);this.work.set(path,work);
      return work.finally(()=>{if(this.work.get(path)===work)this.work.delete(path);});
    }));
    const failed=results.find(result=>result.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason;
  }
  private async process(path:string){
      const renameEnd=this.renames.length,renames=this.renames.slice(this.renameOffsets.get(path)??0,renameEnd);
      if(this.stopped)return;
      let request:HostedInlineRequest;
      try{request=validateHostedRequest(JSON.parse((await this.io.read(path))??''));}catch{return;}
      if(this.io.accepts?!this.io.accepts(request):request.version!==1)return;
      const identity=this.identity;
      if(request.vaultId!==identity.vaultId||request.host.environmentId!==identity.environmentId||!sameWorkspacePath(request.host.workspaceRoot,identity.workspaceRoot)||request.host.directory!==identity.directory||path!==hostedPaths(identity.directory,request.id).request)return;
      const paths=hostedPaths(identity.directory,request.id),hash=hostedRequestHash(request);
      let state:HostedInlineState;
      try{state=JSON.parse((await this.io.read(paths.state))??'null')??{requestHash:hash,accepted:false,notePath:request.notePath,status:'waiting',hashes:[request.initialHash],updatedAt:new Date().toISOString()};}catch{return;}
      if(state.requestHash!==hash||!Array.isArray(state.hashes)||!safeNotePath(state.notePath))return;
      if(['complete','interrupted','conflict'].includes(state.status))return;
      const save=async()=>{state.updatedAt=new Date().toISOString();await this.io.write(paths.state,JSON.stringify(state));this.renameOffsets.set(path,renameEnd);};
      try{
        for(const move of renames)if(state.notePath===move.before||state.notePath.startsWith(move.before+'/'))state.notePath=move.after+state.notePath.slice(move.before.length);
        let restored=false;
        if(state.status==='paused'){
          if(!this.io.canResume?.(state.notePath))return;
          await this.io.updateNote(state.notePath,document=>{
            const region=regionBody(document,request.id);
            restored=!!region&&state.hashes.includes(contentHash(region.body));
            return document;
          });
          if(!restored)return;
        }
        const access=await this.io.access(request.threadEnvironmentId);
        if(this.stopped)return;
        if(!state.accepted){
          let found=false,conflict=false;
          await this.io.updateNote(state.notePath,current=>{
            const region=regionBody(current,request.id);found=!!region;
            conflict=!!region&&contentHash(region.body)!==request.initialHash;
            return current;
          });
          if(conflict){state.status=this.io.canResume?.(state.notePath)?'paused':'conflict';state.detail='The response block changed before the host accepted it.';await save();return;}
          if(!found){state.detail='Waiting for the response marker to reach the vault project machine.';await save();return;}
          state.accepted=true;delete state.detail;await save();
        }
        // An undo may restore an older body while T3 has moved on. Reconcile
        // from the canonical thread before replacing that restored body.
        let current=restored?undefined:await this.io.threadState?.(request,access);
        if(!current){
          const snapshot=await access.api(`/api/orchestration/threads/${encodeURIComponent(request.threadId)}?turnLimit=20`);
          if(this.stopped)return;
          if(snapshot?.thread?.id!==request.threadId||snapshot.thread.projectId!==request.projectId)throw Error('Waiting for the requested T3 thread.');
          current=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
        }
        // T3 may recover the same turn after a server restart. A different
        // later turn is never adopted without an explicit follow command.
        if(state.status==='error'&&!state.pendingMessageId&&current.latestTurn?.turnId!==state.turnId&&current.session?.activeTurnId!==state.turnId)return;
        // A continuation is explicitly bound to a user message. Until T3
        // projects that message and its turn, retain the failed block intact.
        const messageId=state.pendingMessageId??state.messageId??request.messageId;
        if(!current.messages.some(m=>m.id===messageId&&m.role==='user'))return;
        if(state.pendingMessageId){
          const nextTurn=turnForMessage(current,messageId);
          if(!nextTurn||nextTurn===state.turnId)return;
          state.messageId=messageId;state.turnId=nextTurn;delete state.pendingMessageId;
        }
        state.turnId??=turnForMessage(current,messageId);
        if(!state.turnId)return;
        let phase=turnPhase(current,state.turnId);
        if(state.status==='error'&&!state.pendingMessageId&&phase==='error')return;
        if(await this.io.read(paths.stop)!==undefined&&phase==='running'){
          await access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:commandId(request.id,'interrupt'),threadId:request.threadId,turnId:state.turnId,createdAt:request.createdAt});
          phase='interrupted';
        }
        if(phase==='complete'&&this.io.importReplyAsset){
          for(const message of inlineTurnMessages(current,state.turnId,request.keepIntermediate===true)){
            message.text=await rewriteReplyReferences(message.text,reference=>this.io.importReplyAsset!(reference,request,access));
          }
        }
        const next=renderInlineTurn(current,state.turnId,request.threadId,phase,request.keepIntermediate===true,request.threadEnvironmentId);
        const terminal=phase==='complete'||phase==='interrupted';
        // Persist the intended version before writing it, so a crash after the
        // vault edit cannot turn our own output into an apparent user edit.
        const nextHash=contentHash(next);
        if(!state.hashes.includes(nextHash))state.hashes.push(nextHash);
        state.body=next;state.status='running';delete state.detail;await save();
        if(this.stopped)return;
        let conflict=false,applied=false;
        let finalBefore:string|undefined,finalAfter:string|undefined;
        await this.io.updateNote(state.notePath,document=>{
          const region=regionBody(document,request.id);
          if(terminal&&!region&&state.finalDocumentHash===contentHash(document)){applied=true;return document;}
          if(!region||!state.hashes.includes(contentHash(region.body))){conflict=true;return document;}
          if(terminal){
            const change=finalizeRegion(document,request.id,contentHash(region.body),next);
            if(!change){conflict=true;return document;}
            finalBefore=document;finalAfter=document.slice(0,change.from)+change.text+document.slice(change.to);
            return document;
          }
          applied=true;
          const change=replaceRegion(document,request.id,contentHash(region.body),next)!;
          return document.slice(0,change.from)+change.text+document.slice(change.to);
        });
        if(finalBefore!==undefined&&finalAfter!==undefined){
          state.finalDocumentHash=contentHash(finalAfter);await save();
          if(this.stopped)return;
          await this.io.updateNote(state.notePath,document=>{
            if(document!==finalBefore)return document;
            applied=true;return finalAfter!;
          });
        }
        if(conflict){state.status=this.io.canResume?.(state.notePath)?'paused':'conflict';state.detail='Response edited or removed. Undo until the original response block is intact to resume streaming.';}
        else if(applied)state.status=phase;
        else state.detail='Waiting for the note to become available and saved on the host.';
        await save();
      }catch(error){
        state.detail=error instanceof Error?error.message:'The streaming host will retry.';
        await save();
      }
  }
}
