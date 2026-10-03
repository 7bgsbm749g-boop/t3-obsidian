import {validateDestinationSection} from './destination-section';
import {intermediateMode,completionTime,type IntermediateMode,type FinalAnswerFormat,finalAnswerFormat} from './response-presentation';
import {questionTargets} from './questions';
import {followInlineQuestions,inlineQuestionPhase,questionConversationInputs,type InlineQuestionFollow} from './inline-questions';
import {logEvent,logFailure} from './diagnostics';
import {contentHash} from './completion';
import {commandId} from './direct';
import {applyThreadItem,inlineBindingCheckpoint,restoreInlineBindings,rememberInlineTurns,completionProof,hasCompletionProof,hasResponseMarkers,removeCompletionProof,endMarker,finalizeRegion,regionBody,inlineTurnMessages,renderInlineTurn,replaceRegion,startMarker,turnForMessage,turnPhase} from './inline-thread';
import {needsInlineHistory,readInlineSnapshot,type ThreadAccess} from './thread-stream';
import {sameWorkspacePath} from './folder-link';
import {rewriteReplyReferences,type ReplyReference} from './reply-assets';
import {observeIncoming,mergeProse,selectionRange,type InlineSteering} from './inline-steering';
import type {InitialInlineInput,InlineMessage,InlineTurn,InlineBindingCheckpoint} from './inline-thread';
import {interruptStoppedResponse,stoppedResponseBody} from './response-stop';
class StopStreamRequested extends Error {}

export interface InlineHostTarget {environmentId:string;workspaceRoot:string;directory:string;connectionId?:string}
export interface HostedInlineRequest {
  keepIntermediate?:boolean;intermediateMode?:IntermediateMode;finalAnswerFormat?:FinalAnswerFormat;
  initialInput?:InitialInlineInput;
  independent?:boolean;
  nativeProjection?:boolean;
  destinationSection?:string;
  threadTitle?:string;
  version:1|2|3;initialOwner?:string;id:string;vaultId:string;host:InlineHostTarget;notePath:string;
  threadId:string;messageId:string;projectId:string;threadEnvironmentId:string;initialHash:string;createdAt:string;
}
export interface HostedInlineState {
  delivery?:{commitId:string;hash:string;verifiedOnHost:boolean;observedBy:string[]};
  requestHash:string;accepted:boolean;notePath:string;turnId?:string;messageId?:string;pendingMessageId?:string;
  status:'waiting'|'running'|'complete'|'interrupted'|'error'|'conflict'|'paused';
  hashes:string[];body?:string;detail?:string;updatedAt:string;
  bindingCheckpoint?:InlineBindingCheckpoint;
  finishedAt?:string;presentationTurns?:Record<string,InlineTurn>;
  finalDocumentHash?:string;
  /** Positional provenance outside the note; never a retained Markdown marker. */
  responseAnchor?:{length:number;hash:string};
  finalBody?:string;
  /** The proof was verified on disk before its temporary boundaries were removed. */
  finalSaved?:boolean;
  finalPhase?:'complete'|'interrupted';
  cleanupComplete?:boolean;
  userStopped?:boolean;
  prose?:InlineMessage[];turnIds?:string[];steering?:InlineSteering[];incoming?:InlineSteering[];questionFollows?:InlineQuestionFollow[];
}
export interface InlineFiles {
  read(path:string):Promise<string|undefined>;
  write(path:string,contents:string):Promise<void>;
}
export const hostedPaths=(directory:string,id:string)=>({request:`${directory}/requests/${id}.json`,state:`${directory}/states/${id}.json`,stop:`${directory}/stops/${id}.json`});
export const legacyQuestionReply=(state:HostedInlineState|undefined)=>state?.status==='complete'&&state.questionFollows===undefined&&!!state.body?.includes('> **T3 · Question pending**')&&questionTargets(state.body).length>0;
export const pendingCompletionCleanup=(request:HostedInlineRequest,state:HostedInlineState|undefined)=>!!request.independent&&state?.finalBody!==undefined&&!state.cleanupComplete&&!legacyQuestionReply(state)&&(state.finalSaved===true||['complete','interrupted'].includes(state.status));
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function safeNotePath(path:unknown):path is string {
  return typeof path==='string'&&path.endsWith('.md')&&!path.includes('\\')&&!/[\x00-\x1f:]/.test(path)&&path.split('/').every(p=>!!p&&p!=='.'&&p!=='..'&&!p.startsWith('.'));
}
export function validateHostedRequest(value:any):HostedInlineRequest {
  if(value?.nativeProjection!==undefined&&typeof value.nativeProjection!=='boolean')throw Error('Invalid native projection preference.');
  validateDestinationSection(value?.destinationSection);
  if(value?.initialInput!==undefined&&(!uuid.test(value.initialInput?.messageId??'')||value.initialInput.messageId!==value.messageId||typeof value.initialInput.text!=='string'||!value.initialInput.text.trim()||value.initialInput.text.length>120_000||value.initialInput.label!==undefined&&(typeof value.initialInput.label!=='string'||value.initialInput.label.length>200)))throw Error('Invalid initial response input.');
  if(value?.threadTitle!==undefined&&(typeof value.threadTitle!=='string'||value.threadTitle.length>200))throw Error('Invalid thread title.');
  if(value?.independent!==undefined&&typeof value.independent!=='boolean')throw Error('Invalid binding preference.');
  if(value?.finalAnswerFormat!==undefined&&!['formatted','raw-markdown'].includes(value.finalAnswerFormat))throw Error('Invalid final answer format.');
  if(value?.finalAnswerFormat==='raw-markdown'&&value.version!==3)throw Error('Raw Markdown requires an updated response writer.');
  if(value?.intermediateMode!==undefined&&!['remove','keep','collapse'].includes(value.intermediateMode))throw Error('Invalid hosted response preference.');
  if(value?.keepIntermediate!==undefined&&typeof value.keepIntermediate!=='boolean')throw Error('Invalid hosted response preference.');
  if(![1,2,3].includes(value?.version)||(value.version!==1&&!uuid.test(value.initialOwner??''))||!uuid.test(value.id??'')||!(typeof value.messageId==='string'&&(uuid.test(value.messageId)||/^async-answer:[^\s\x00-\x1f]{1,200}$/.test(value.messageId)))||!safeNotePath(value.notePath)||
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
  commitFinal?(request:HostedInlineRequest,state:HostedInlineState,body:string):Promise<boolean>;
  access(environmentId:string):Promise<ThreadAccess>;
  // undefined means the file is missing or has unsaved editor changes. The
  // callback must execute against the latest content in an atomic vault edit.
  updateNote(path:string,change:(current:string)=>string):Promise<string|undefined>;
  locateNote?(id:string,path:string):Promise<string|undefined>;
  threadState?(request:HostedInlineRequest,access:ThreadAccess,refresh?:boolean):Promise<import('./inline-thread').InlineThreadState|undefined>;
  monotonic?():number;
  accepts?(request:HostedInlineRequest):boolean;
  /** Keep missing-boundary jobs recoverable while their editor is open. */
  canResume?(path:string):boolean;
  importReplyAsset?(reference:ReplyReference,request:HostedInlineRequest,access:ThreadAccess):Promise<string|undefined>;
}

/** Each request has its own serial worker. Requests and write-ahead hashes are durable;
 * no sender socket, editor tab, or synced credentials participate in writing. */
export class HostedInlineWriter {
  private stopped=false;
  private stopIntents=new Set<string>();
  private networkCancels=new Map<string,(error?:Error)=>void>();
  private networkStarted=new Map<string,number>();
  private networkRetryAt=new Map<string,number>();
  private monotonic(){return this.io.monotonic?.()??performance.now();}
  private interrupts=new Set<string>();
  private work=new Map<string,Promise<void>>();
  private renameOffsets=new Map<string,number>();
  private renames:Array<{before:string;after:string}>=[];
  private history=new Map<string,{key:string;expires:number;state:import('./inline-thread').InlineThreadState}>();
  constructor(private identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},private io:HostedWriterIO){}
  stop(){this.stopped=true;for(const cancel of this.networkCancels.values())cancel();}
  requestStop(id:string){this.stopIntents.add(id);this.networkCancels.get(hostedPaths(this.identity.directory,id).request)?.();}
  private async network<T>(path:string,work:()=>Promise<T>):Promise<T>{
    const id=path.slice(path.lastIndexOf('/')+1,-5);
    if(this.stopped||this.stopIntents.has(id))throw new StopStreamRequested();
    let cancel!:(error?:Error)=>void;
    const interrupted=new Promise<never>((_,reject)=>{cancel=(error)=>reject(error??new StopStreamRequested());this.networkCancels.set(path,cancel);this.networkStarted.set(path,this.monotonic());});
    try{return await Promise.race([work(),interrupted]);}
    finally{if(this.networkCancels.get(path)===cancel){this.networkCancels.delete(path);this.networkStarted.delete(path);}}
  }
  renamed(before:string,after:string){this.renames.push({before,after});}
  async tick(){
    // Native desktop coordination bounds every network operation, including
    // the writer's historical reads and asset imports. Renderer timers are
    // not needed to free a wedged serial worker; Promise.race fences late work.
    for(const [path,started] of this.networkStarted)if(this.monotonic()-started>=30_000){
      this.networkRetryAt.set(path,this.monotonic()+5000);
      this.networkCancels.get(path)?.(Error('T3 response writer network operation timed out.'));
    }
    const paths=await this.io.requests();
    const results=await Promise.allSettled(paths.map(async path=>{
      if(this.stopped)return;
      if(this.work.has(path)){
        const id=path.slice(path.lastIndexOf('/')+1,-5);
        if(await this.io.read(hostedPaths(this.identity.directory,id).stop)!==undefined)this.requestStop(id);
        return;
      }
      if(!this.stopIntents.has(path.slice(path.lastIndexOf('/')+1,-5))&&this.monotonic()<(this.networkRetryAt.get(path)??0))return;
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
      const legacyProof=pendingCompletionCleanup(request,state)&&['complete','interrupted'].includes(state.status);
      if(['complete','interrupted','conflict'].includes(state.status)&&!legacyQuestionReply(state)&&!legacyProof)return;
      const save=async()=>{state.updatedAt=new Date().toISOString();await this.io.write(paths.state,JSON.stringify(state));this.renameOffsets.set(path,renameEnd);};
      try{
        const previousPath=state.notePath;
        for(const move of renames)if(state.notePath===move.before||state.notePath.startsWith(move.before+'/'))state.notePath=move.after+state.notePath.slice(move.before.length);
        if(this.io.locateNote){
          const located=await this.io.locateNote(request.id,state.notePath);
          if(located===undefined){state.detail='Waiting for moved note to reach this device.';await save();return;}
          state.notePath=located;
        }
        if(state.notePath!==previousPath)await save();
        if(legacyProof){state.finalPhase=state.status as 'complete'|'interrupted';state.finalSaved=true;state.status='running';await save();}
        if(state.finalSaved){await this.cleanup(request,state,save);return;}
        if(state.userStopped||this.stopIntents.has(request.id)||await this.io.read(paths.stop)!==undefined){await this.finishStopped(request,state,save);return;}
        if(legacyQuestionReply(state)){
          // Older releases sealed pending questions. Reopen only byte-identical
          // final output; never reconstruct over an edited or moved response.
          let reopened=false;
          await this.io.updateNote(state.notePath,document=>{
            if(regionBody(document,request.id)){reopened=true;return document;}
            if(contentHash(document)!==state.finalDocumentHash)return document;
            const body=state.body!.replace(/\n+$/,''),from=document.indexOf(body);
            if(from<0||document.indexOf(body,from+body.length)>=0)return document;
            reopened=true;
            return document.slice(0,from)+startMarker(request.id)+'\n'+state.body+'\n'+endMarker(request.id)+document.slice(from+body.length);
          });
          if(!reopened)return;
          state.questionFollows=questionTargets(state.body!).map(target=>({requestId:target.requestId,turnId:state.turnId??null,completed:true}));
          state.status='waiting';delete state.finalDocumentHash;await save();
        }
        let restored=false;
        if(state.status==='paused'){
          await this.io.updateNote(state.notePath,document=>{
            const region=regionBody(document,request.id);
            restored=!!region;
            return document;
          });
          if(!restored)return;
        }
        const access=await this.network(path,()=>this.io.access(request.threadEnvironmentId));
        if(this.stopped)return;
        if(!state.accepted){
          let found=false;
          await this.io.updateNote(state.notePath,current=>{
            found=!!regionBody(current,request.id);
            return current;
          });
          if(!found){state.detail='Waiting for the response marker to reach the vault project machine.';await save();return;}
          state.accepted=true;delete state.detail;await save();
        }
        // Upgrade old paused bindings from canonical history before replacing
        // their intact response block, even when Sync changed its contents.
        let current=restored?undefined:await this.network(path,()=>Promise.resolve(this.io.threadState?.(request,access)));
        if(!current){
          const snapshot=await this.network(path,()=>readInlineSnapshot(access,request.threadId,request.projectId));
          if(this.stopped)return;
          if(snapshot?.thread?.id!==request.threadId||snapshot.thread.projectId!==request.projectId)throw Error('Waiting for the requested T3 thread.');
          current=applyThreadItem({...state.bindingCheckpoint,messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
        }
        current=restoreInlineBindings(current,state.bindingCheckpoint);
        // A continuation is explicitly bound to a user message. Until T3
        // projects that message and its turn, retain the failed block intact.
        const messageId=state.pendingMessageId??state.messageId??request.messageId;
        const targets={messageIds:[messageId,...(state.steering??[]).filter(input=>!input.confirmed).map(input=>input.messageId)],turnIds:[...new Set([...(state.turnIds??(state.turnId?[state.turnId]:[])),...([messageId,...(state.steering??[]).map(input=>input.messageId)].map(id=>turnForMessage(current!,id)).filter((id):id is string=>!!id))])]};
        if(needsInlineHistory(current,targets)){
          const key=JSON.stringify(targets),cached=this.history.get(path);
          if(cached?.key===key&&cached.expires>Date.now()&&(cached.state.sequence??-1)>=(current.sequence??-1))current=restoreInlineBindings(cached.state,inlineBindingCheckpoint(current));
          else{
            const snapshot=await this.network(path,()=>readInlineSnapshot(access,request.threadId,request.projectId,undefined,true));
            if(this.stopped)return;
            current=applyThreadItem(current,{kind:'snapshot',snapshot}).state;
            this.history.set(path,{key,expires:Date.now()+3000,state:current});
          }
        }
        const previousBinding=state.bindingCheckpoint?.bindings?.[messageId];
        const checkpoint=inlineBindingCheckpoint(current);
        if(JSON.stringify(checkpoint)!==JSON.stringify(state.bindingCheckpoint)){state.bindingCheckpoint=checkpoint;await save();}
        if(!current.messages.length)return;
        if(request.finalAnswerFormat==='raw-markdown')current={...current,turns:{...state.presentationTurns,...current.turns}};
        if((!state.turnId||state.pendingMessageId)&&!current.messages.some(m=>m.id===messageId&&m.role==='user'))return;
        if(state.pendingMessageId){
          const nextTurn=turnForMessage(current,messageId);
          if(!nextTurn||nextTurn===state.turnId)return;
          state.messageId=messageId;state.turnId=nextTurn;delete state.pendingMessageId;
        }
        const bound=turnForMessage(current,messageId);
        if(bound&&(!state.turnId||previousBinding?.kind==='steer'&&previousBinding.turnId!==bound))state.turnId=bound;
        if(!state.turnId)return;
        state.turnIds??=[state.turnId];
        // Follow changes turnId independently of steering. Repair old checkpoints
        // too, before filtering incoming prose by the explicitly adopted turns.
        if(!state.turnIds.includes(state.turnId))state.turnIds.push(state.turnId);
        for(const input of state.steering??[]){
          if(!current.messages.some(m=>m.role==='user'&&m.id===input.messageId))continue;
          if(!input.confirmed)logEvent('steering.confirmed',{jobId:request.id,messageId:input.messageId,threadId:request.threadId,turnId:turnForMessage(current,input.messageId)});
          input.confirmed=true;
          state.messageId=input.messageId;
          const nextTurn=turnForMessage(current,input.messageId);
          if(nextTurn){state.turnId=nextTurn;if(!state.turnIds.includes(nextTurn))state.turnIds.push(nextTurn);}
        }
        let questions=followInlineQuestions(current,state.turnIds,state.questionFollows,state.prose);
        state.questionFollows=questions.follows;state.turnIds=questions.turnIds;state.turnId=questions.turnId!;
        state.incoming=observeIncoming(current,state.turnIds,state.incoming,state.steering,[request.messageId,request.initialInput?.messageId??'',...Object.values(current.turns??{}).filter(turn=>state.turnIds!.includes(turn.turnId)).map(turn=>turn.messageId??''),...state.questionFollows.flatMap(follow=>follow.input?[follow.input.messageId]:[])]);
        state.prose=mergeProse(state.prose??[],current.messages,state.turnIds);
        let phase=inlineQuestionPhase(current,state.turnId,state.questionFollows);
        const checkCompletion=phase==='complete';
        if(state.steering?.some(input=>!input.confirmed||!turnForMessage(current!,input.messageId)))phase='running';
        // Session-ready events can precede the final message in the stream.
        // Resolve completion from a fresh canonical snapshot before sealing it.
        if(checkCompletion&&this.io.threadState){
          const refreshed=await this.network(path,()=>this.io.threadState!(request,access,true));
          if(refreshed)current=restoreInlineBindings(refreshed,inlineBindingCheckpoint(current));
          questions=followInlineQuestions(current,state.turnIds,state.questionFollows,state.prose);
          state.questionFollows=questions.follows;state.turnIds=questions.turnIds;state.turnId=questions.turnId!;
          state.incoming=observeIncoming(current,state.turnIds,state.incoming,state.steering,[request.messageId,request.initialInput?.messageId??'',...Object.values(current.turns??{}).filter(turn=>state.turnIds!.includes(turn.turnId)).map(turn=>turn.messageId??''),...state.questionFollows.flatMap(follow=>follow.input?[follow.input.messageId]:[])]);
          state.prose=mergeProse(state.prose,current.messages,state.turnIds);
          phase=inlineQuestionPhase(current,state.turnId,state.questionFollows);
          if(state.steering?.some(input=>!input.confirmed||!turnForMessage(current!,input.messageId)))phase='running';
        }
        if(state.status==='error'&&phase==='running'&&current.latestTurn?.turnId!==state.turnId&&current.session?.activeTurnId!==state.turnId)return;
        if(state.status==='error'&&!state.pendingMessageId&&phase==='error')return;
        if(this.stopIntents.has(request.id)||await this.io.read(paths.stop)!==undefined){await this.finishStopped(request,state,save);return;}
        if(request.finalAnswerFormat==='raw-markdown'){
          state.presentationTurns=rememberInlineTurns({...current,messages:state.prose},state.turnIds,state.presentationTurns);
          current={...current,turns:{...state.presentationTurns,...current.turns}};
        }
        state.bindingCheckpoint=inlineBindingCheckpoint(current);
        const inputs=questionConversationInputs(current,state.incoming??[],state.questionFollows,state.prose);
        const conversation=state.turnIds.length>1||inputs.length?{messages:state.prose,steering:inputs,preserveHistory:questions.continued}:undefined;
        if(phase==='complete'&&this.io.importReplyAsset&&!conversation){
          for(const message of inlineTurnMessages(current,state.turnId,intermediateMode(request.intermediateMode,request.keepIntermediate)!=='remove')){
            message.text=await this.network(path,()=>rewriteReplyReferences(message.text,reference=>this.io.importReplyAsset!(reference,request,access)));
          }
        }
        if(phase==='complete'||phase==='interrupted')state.finishedAt??=completionTime(current,state.turnId);else delete state.finishedAt;
        let next=renderInlineTurn(current,state.turnId,request.threadId,phase,intermediateMode(request.intermediateMode,request.keepIntermediate),request.threadEnvironmentId,conversation,request.initialInput,request.threadTitle,{startedAt:request.createdAt,finishedAt:state.finishedAt},finalAnswerFormat(request.finalAnswerFormat));
        if(phase==='complete'&&conversation&&this.io.importReplyAsset)next=await this.network(path,()=>rewriteReplyReferences(next,reference=>this.io.importReplyAsset!(reference,request,access)));
        const terminal=phase==='complete'&&!questions.waiting||phase==='interrupted';
        // Persist the intended version before writing it, so a crash after the
        // vault edit cannot turn our own output into an apparent user edit.
        const nextHash=contentHash(next);
        if(!state.hashes.includes(nextHash))state.hashes.push(nextHash);
        state.body=next;state.status='running';delete state.detail;await save();
        if(this.stopped)return;
        if(terminal&&this.io.commitFinal){
          if(await this.io.commitFinal(request,state,next)){
            state.finalBody=next;state.finalPhase=phase as 'complete'|'interrupted';state.finalSaved=true;state.cleanupComplete=true;state.status=phase;delete state.detail;
          }else state.detail='Waiting for a checked coordinated save or conflict resolution.';
          await save();return;
        }
        let conflict=false,applied=false;
        const selectionsApplied:InlineSteering[]=[];
        let finalBefore:string|undefined,finalAfter:string|undefined;
        await this.io.updateNote(state.notePath,document=>{
          const originalDocument=document;
          let region=regionBody(document,request.id);
          if(terminal&&!region&&(state.finalDocumentHash===contentHash(document)||state.finalBody!==undefined&&hasCompletionProof(document,request.id,state.finalBody))){applied=true;return document;}
          // Active response contents belong to T3. Only missing or ambiguous
          // boundaries prevent replacement; surrounding text stays untouched.
          if(!region){conflict=true;return document;}
          for(const input of state.steering??[]){
            if(!input.confirmed||!input.selection)continue;
            const range=selectionRange(document,input.selection,{from:region.from-startMarker(request.id).length-1,to:region.to+endMarker(request.id).length+1});
            // A changed selection is preserved; never remove matching text elsewhere.
            if(range&&(range.to<=region.from-startMarker(request.id).length-1||range.from>=region.to+endMarker(request.id).length+1)){
              document=document.slice(0,range.from)+document.slice(range.to);
              region=regionBody(document,request.id)!;
            }
            selectionsApplied.push(input);
          }
          if(terminal){
            const change=finalizeRegion(document,request.id,contentHash(region.body),request.independent?completionProof(request.id,next):next);
            if(!change){conflict=true;return document;}
            if(request.independent)state.responseAnchor={length:change.from+1,hash:contentHash(document.slice(0,change.from)+'\n')};
            finalBefore=originalDocument;finalAfter=document.slice(0,change.from)+change.text+document.slice(change.to);
            return originalDocument;
          }
          applied=true;
          const change=replaceRegion(document,request.id,contentHash(region.body),next)!;
          return document.slice(0,change.from)+change.text+document.slice(change.to);
        });
        if(finalBefore!==undefined&&finalAfter!==undefined){
          state.finalDocumentHash=contentHash(finalAfter);if(request.independent)state.finalBody=next;await save();
          if(this.stopped)return;
          await this.io.updateNote(state.notePath,document=>{
            if(document!==finalBefore)return document;
            applied=true;return finalAfter!;
          });
        }
        if(conflict){if(!['paused','conflict'].includes(state.status))logFailure('note.write.conflict',new Error('Response markers were removed or malformed.'),{jobId:request.id,notePath:state.notePath,knownHashes:state.hashes.slice(-5)});state.status=this.io.canResume?.(state.notePath)?'paused':'conflict';state.detail='Response markers removed or malformed. Restore the response boundaries to resume streaming.';}
        else if(applied)state.status=phase==='complete'&&questions.waiting?'waiting':phase;
        else state.detail='Waiting for the note to become available and saved on the host.';
        if(applied)for(const input of selectionsApplied)input.selectionApplied=true;
        if(applied&&terminal&&request.independent){
          state.finalPhase=phase as 'complete'|'interrupted';state.finalSaved=true;state.status='running';
          await save();
          await this.cleanup(request,state,save);
        }else await save();
      }catch(error){
        if(error instanceof StopStreamRequested)return;
        logFailure('response.writer.retry',error,{jobId:request.id,notePath:state.notePath,threadId:request.threadId});
        if(state.finalSaved)state.status='running';
        state.detail=error instanceof Error?error.message:'The streaming host will retry.';
        // A failed proof-save acknowledgement must not persist finalSaved via
        // this retry checkpoint: the device adapter verifies that transition.
        await save();
      }
  }
  private async finishStopped(request:HostedInlineRequest,state:HostedInlineState,save:()=>Promise<void>){
    state.userStopped=true;state.status='running';await save();
    // Remote interruption never participates in the note transaction.
    if(!this.interrupts.has(request.id)){
      this.interrupts.add(request.id);
      void interruptStoppedResponse(()=>this.io.access(request.threadEnvironmentId),request.id,request.threadId,state.turnId,10_000,state.messageId??request.messageId,request.projectId,request.createdAt)
        .catch(error=>logFailure('response.stop.interrupt.failed',error,{jobId:request.id,threadId:request.threadId}));
    }
    if(this.io.commitFinal){
      const body=stoppedResponseBody(state.body??'');
      if(await this.io.commitFinal(request,state,body)){state.body=body;state.finalBody=body;state.finalPhase='interrupted';state.finalSaved=true;state.cleanupComplete=true;state.status='interrupted';delete state.detail;}
      await save();return;
    }
    let before:string|undefined,after:string|undefined;
    await this.io.updateNote(state.notePath,document=>{
      const region=regionBody(document,request.id);
      if(region){
        const body=stoppedResponseBody(region.body);
        const change=finalizeRegion(document,request.id,contentHash(region.body),request.independent?completionProof(request.id,body):body);
        if(!change)throw Error('Stopped response boundaries are ambiguous. Your text is preserved.');
        state.body=body;state.finalBody=body;
        before=document;after=document.slice(0,change.from)+change.text+document.slice(change.to);
      }else{
        // The sending editor may already have cleaned this block while offline.
        const cleaned=removeCompletionProof(document,request.id);
        if(cleaned===null&&hasResponseMarkers(document,request.id))throw Error('Stopped response boundaries are incomplete. Your text is preserved.');
        state.finalBody??=stoppedResponseBody(state.body??'');
        before=document;after=cleaned??document;
      }
      return document;
    });
    if(before===undefined||after===undefined)return;
    state.finalDocumentHash=contentHash(after);state.finalPhase='interrupted';await save();
    let applied=false;
    await this.io.updateNote(state.notePath,document=>{if(document!==before)return document;applied=true;return after!;});
    if(!applied)return;
    if(request.independent){state.finalSaved=true;await save();await this.cleanup(request,state,save);}
    else{state.status='interrupted';delete state.detail;await save();}
  }
  private async cleanup(request:HostedInlineRequest,state:HostedInlineState,save:()=>Promise<void>){
    let cleaned=false;
    await this.io.updateNote(state.notePath,document=>{
      const next=removeCompletionProof(document,request.id);
      if(next===null&&hasResponseMarkers(document,request.id))throw Error('Completed response boundaries are incomplete or nested. Your text is preserved.');
      // No boundaries means a previous cleanup already landed, including a
      // crash before its checkpoint. Never reconstruct or overwrite the body.
      cleaned=true;state.finalDocumentHash=contentHash(next??document);
      return next??document;
    });
    if(!cleaned)return;
    state.cleanupComplete=true;state.status=state.finalPhase!;delete state.detail;
    await save();
  }
}
