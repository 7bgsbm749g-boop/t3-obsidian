import {validateDestinationSection} from './destination-section';
import {commandId} from './direct';
import {safeNotePath,type ResponseRequest} from './response-model';
import {turnForMessage,type InlineMessage,type InlineThreadState} from './inline-thread';
import type {EventTarget} from './event-subscriptions';
import {isRunInput} from './run-input';

export const STREAM_COMMANDS=['stream-thread','thread-streams','pause-thread-stream','resume-thread-stream','cancel-thread-stream','remove-stream-destination'] as const;
export interface ThreadDisplayCommand {version:1;id:string;kind:typeof STREAM_COMMANDS[number];source?:EventTarget;destinationSection?:string;destinations?:string[];subscriptionId?:string;destination?:string;scope?:'thread';start?:'future'|'history'|'after';afterMessageId?:string}
export interface DisplayDestination {id:string;path:string;section?:string;removed?:boolean}
export interface DisplayBinding {messageId:string;turnId?:string;destinationId:string;request?:ResponseRequest;bindingId?:string;status:'planned'|'attached'|'skipped';error?:string}
export interface ThreadDisplay extends EventTarget {id:string;scope:'thread';enabled:boolean;cancelled?:boolean;createdAt:string;boundary:string[];destinations:DisplayDestination[];bindings:DisplayBinding[];error?:string}
export interface DisplayHost {
  readThread(target:EventTarget):Promise<InlineThreadState>;
  validateDestination(path:string):Promise<void>;
  /** Existing bindings include completed records, steering and continuations. */
  responseBindings(target:EventTarget):Promise<Array<{id:string;path:string;messageIds:string[];turnIds:string[]}>>;
  prepareDisplay(display:ThreadDisplay,destination:DisplayDestination,message:InlineMessage):Promise<ResponseRequest>;
  attachDisplay(request:ResponseRequest,path:string):Promise<void>;
  save():Promise<void>;
}
export function validateDisplayCommand(value:any):ThreadDisplayCommand {
  if(!STREAM_COMMANDS.includes(value?.kind)||value.version!==1||!/^[0-9a-f-]{36}$/i.test(value.id??''))throw Error('Invalid thread streaming command.');
  validateDestinationSection(value.destinationSection);
  if(value.kind==='stream-thread'){
    if(value.scope!=='thread'||!value.source||![value.source.threadId,value.source.projectId,value.source.environmentId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200))throw Error('Thread streaming requires an explicit thread scope and source thread, project, and environment.');
    if(!Array.isArray(value.destinations)||!value.destinations.length||value.destinations.length>32||value.destinations.some((p:unknown)=>!safeNotePath(p))||new Set(value.destinations).size!==value.destinations.length)throw Error('Choose 1–32 unique destination notes.');
    if(value.start!==undefined&&!['future','history','after'].includes(value.start))throw Error('Choose a future, history, or selected-prompt start boundary.');
    if(value.start==='after'&&(typeof value.afterMessageId!=='string'||!value.afterMessageId||value.afterMessageId.length>200))throw Error('Choose the prompt after which streaming starts.');
    if(value.start!=='after'&&value.afterMessageId!==undefined)throw Error('A selected prompt requires an after start boundary.');
  }else if(value.kind!=='thread-streams'&&!/^[0-9a-f-]{36}$/i.test(value.subscriptionId??''))throw Error('A thread streaming subscription ID is required.');
  if(value.kind==='remove-stream-destination'&&!safeNotePath(value.destination))throw Error('Choose the destination to remove.');
  if(value.kind!=='stream-thread'&&(value.source!==undefined||value.destinations!==undefined||value.scope!==undefined||value.start!==undefined||value.afterMessageId!==undefined))throw Error('Management cannot change a streaming source or boundary.');
  return value;
}
export async function displayCommand(displays:ThreadDisplay[],command:ThreadDisplayCommand,host:DisplayHost,now:number){
  if(command.kind==='thread-streams')return {displays};
  if(command.kind==='stream-thread'){
    if(displays.length>=256)throw Error('Thread streaming registration limit reached.');
    for(const path of command.destinations!)await host.validateDestination(path);
    const state=await host.readThread(command.source!);
    if(!state.historyComplete)throw Error('A complete canonical history is required to establish the streaming boundary.');
    const prompts=state.messages.filter(isRunInput),selected=prompts.findIndex(m=>m.id===command.afterMessageId);
    if(command.start==='after'&&selected<0)throw Error('The selected prompt is no longer in the T3 history.');
    const boundary=command.start==='history'?[]:(command.start==='after'?prompts.slice(0,selected+1):prompts).map(m=>m.id);
    const display:ThreadDisplay={...command.source!,id:command.id,scope:'thread',enabled:true,createdAt:new Date(now).toISOString(),boundary,destinations:command.destinations!.map(path=>({id:commandId(command.id,`destination:${path}`),path,...(command.destinationSection?{section:command.destinationSection}:{})})),bindings:[]};
    displays.push(display);return {subscriptionId:display.id,display};
  }
  const display=displays.find(d=>d.id===command.subscriptionId);if(!display)throw Error('Thread streaming registration not found.');
  if(display.cancelled)throw Error('Thread streaming registration was cancelled.');
  if(command.kind==='pause-thread-stream')display.enabled=false;
  if(command.kind==='cancel-thread-stream'){display.enabled=false;display.cancelled=true;}
  if(command.kind==='resume-thread-stream'){
    const state=await host.readThread(display);if(!state.historyComplete)throw Error('A complete canonical history is required to resume.');
    // Paused runs are skipped. Active child bindings continue independently.
    display.boundary=[...new Set([...display.boundary,...state.messages.filter(isRunInput).map(m=>m.id)])];display.enabled=true;
  }
  if(command.kind==='remove-stream-destination'){
    const destination=display.destinations.find(d=>d.path===command.destination&&!d.removed);if(!destination)throw Error('Streaming destination not found.');destination.removed=true;
  }
  return {subscriptionId:display.id,display};
}
export async function tickDisplay(display:ThreadDisplay,host:DisplayHost){
  if(!display.enabled||display.cancelled)return;
  const state=await host.readThread(display);
  if(!state.historyComplete)throw Error('Waiting for canonical thread history.');
  // Completed attachments and future-start boundaries need no private lease
  // discovery. Read fresh bindings only when an eligible destination needs
  // attachment or retry, and share that read within this pass.
  let existing:Awaited<ReturnType<DisplayHost['responseBindings']>>|undefined;
  const roots=new Map<string,string>();
  // First prompt owns a provider turn; subsequent same-turn prompts are steering.
  for(const message of state.messages.filter(isRunInput)){
    const turnId=turnForMessage(state,message.id);if(turnId&&!roots.has(turnId))roots.set(turnId,message.id);
  }
  for(const message of state.messages.filter(m=>isRunInput(m)&&!display.boundary.includes(m.id))){
    const turnId=turnForMessage(state,message.id);
    if(!turnId)continue; // Fast replies catch up; never guess the latest turn.
    for(const destination of display.destinations.filter(d=>!d.removed)){
      let binding=display.bindings.find(b=>b.messageId===message.id&&b.destinationId===destination.id);
      if(binding&&binding.status!=='planned')continue;
      if(binding){
        // A deleted destination cannot accept this retained plan. Check its
        // availability before walking every historical lease again. Keep the
        // same request ready for when the note returns; other destinations
        // still progress independently.
        try{await host.validateDestination(destination.path);}
        catch(error){const detail=error instanceof Error?error.message:String(error);if(binding.error!==detail){binding.error=detail;await host.save();}continue;}
      }
      existing??=await host.responseBindings(display);
      const attached=existing.find(b=>b.path===destination.path&&(b.messageIds.includes(message.id)||b.turnIds.includes(turnId)));
      const sibling=display.bindings.find(b=>b.destinationId===destination.id&&b.turnId===turnId&&b.messageId!==message.id);
      if(attached||roots.get(turnId)!==message.id||sibling){
        if(!binding){binding={messageId:message.id,turnId,destinationId:destination.id,status:'skipped',...(attached?{bindingId:attached.id}:{})};display.bindings.push(binding);}else if(attached){binding.status=attached.id===binding.request?.id?'attached':'skipped';binding.bindingId=attached.id;delete binding.error;}await host.save();
        continue;
      }
      if(!binding){binding={messageId:message.id,turnId,destinationId:destination.id,status:'planned',request:await host.prepareDisplay(display,destination,message)};display.bindings.push(binding);await host.save();}
      try{await host.attachDisplay(binding.request!,destination.path);binding.bindingId=binding.request!.id;binding.status='attached';delete binding.error;await host.save();}
      catch(error){const detail=error instanceof Error?error.message:String(error);if(binding.error!==detail){binding.error=detail;await host.save();}}
    }
  }
}
export function renameDisplays(displays:ThreadDisplay[],before:string,after:string){
  for(const display of displays)for(const destination of display.destinations)if(destination.path===before||destination.path.startsWith(before+'/'))destination.path=after+destination.path.slice(before.length);
  // Prepared requests stay immutable. The writer's existing locator follows
  // active bindings; unattached plans need their original ID at the new path.
}
