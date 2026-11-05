import {isRecord,jsonClone} from '../shared/values';
import {applyThreadItem,type InlineThreadState} from './inline-thread';
import {STREAM_COMMANDS,validateDisplayCommand,validateResponseReservation,displayCommand,tickDisplay,reserveThreadResponse,reservedResponseBindings,renameDisplays,renameResponseReservations,type ThreadTarget,type ThreadDisplay,type ThreadDisplayCommand,type ThreadResponseReservation,type ThreadResponseReservationCommand,type DisplayHost} from './thread-display';

export type ThreadCommand=ThreadDisplayCommand|ThreadResponseReservationCommand;
export interface ThreadDisplayResult {id:string;ok:boolean;display?:ThreadDisplay;displays?:ThreadDisplay[];subscriptionId?:string;monitoring?:boolean;error?:string}
interface State {version:1;displays:ThreadDisplay[];responseReservations:ThreadResponseReservation[];commands:Record<string,{input:string;result:ThreadDisplayResult}>}
interface Host {
  load():Promise<unknown>;save(state:State):Promise<void>;now():number;
  displayHost:Omit<DisplayHost,'save'>;
  watchThread?(target:ThreadTarget,item:(value:unknown)=>void,sequence:()=>number|undefined,reconnecting:()=>void):{stop():void};
}
export function isThreadCommand(input:unknown):input is ThreadCommand{return isRecord(input)&&(input.kind==='reserve-thread-response'||(STREAM_COMMANDS as readonly string[]).includes(String(input.kind)));}
export function validateThreadCommand(input:unknown):ThreadCommand{return isRecord(input)&&input.kind==='reserve-thread-response'?validateResponseReservation(input):validateDisplayCommand(input);}

function compactObservedThread(state:InlineThreadState):InlineThreadState {
  if(state.protocolVersion!==2)return state;
  const {inputBoundaries:_boundaries,...rest}=state;
  const lifecycle=new Set(['approval.requested','approval.resolved','user-input.requested','user-input.resolved','provider.turn.start.failed','runtime.error']);
  const controls=Object.fromEntries(Object.entries(state.v2Controls??{}).map(([id,c])=>[id,{id:c.id,ordinal:c.ordinal,type:c.type,requestId:c.requestId,runId:c.runId,status:c.status,startedAt:c.startedAt,updatedAt:c.updatedAt,completedAt:c.completedAt,responseMode:c.responseMode}]));
  const requests=Object.fromEntries(Object.entries(state.v2Requests??{}).map(([id,r])=>[id,{id:r.id,kind:r.kind,status:r.status,resolvedAt:r.resolvedAt,responseCapability:r.responseCapability?{type:r.responseCapability.type}:undefined,answers:r.answers?{}:undefined}]));
  return {...rest,messages:state.messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>m.role==='user'?{id:m.id,role:m.role,text:m.text,turnId:m.turnId,streaming:m.streaming,createdAt:m.createdAt,createdBy:m.createdBy,creationSource:m.creationSource,senderThreadId:m.senderThreadId,senderThreadTitle:m.senderThreadTitle,delegatedCompletion:m.delegatedCompletion}:{id:m.id,role:m.role,text:'',turnId:m.turnId,streaming:m.streaming,createdAt:m.createdAt}),
    activities:state.activities.filter(a=>lifecycle.has(a.kind)).map(a=>({...a,payload:a.payload?{requestId:a.payload.requestId,responseMode:a.payload.responseMode,detail:a.payload.detail,answers:a.payload.answers?{}:undefined}:undefined})),
    ...(state.v2Controls?{v2Controls:controls}:{}),...(state.v2Requests?{v2Requests:requests}:{})};
}

/** Reply following only. No note/property/job subscriptions, notification
 * prompts, feedback suppression, filesystem host, or event-emission state. */
export class ThreadDisplays {
  private state:State={version:1,displays:[],responseReservations:[],commands:{}};
  private serial:Promise<void>=Promise.resolve();private ticking?:Promise<void>;private stopped=false;
  private threads=new Map<string,{state:InlineThreadState;sequence?:number;canonicalUntil:number}>();
  private monitors=new Map<string,{stop():void}>();
  constructor(private host:Host){}
  get active(){return this.state.displays.some(display=>display.enabled&&!display.cancelled);}
  get snapshot(){return jsonClone(this.state);}
  private key(target:ThreadTarget){return JSON.stringify([target.environmentId,target.projectId,target.threadId]);}
  private run<T>(action:()=>Promise<T>):Promise<T>{const work=this.serial.catch(()=>{}).then(async()=>{if(this.stopped)throw Error('Reply following is stopped.');try{return await action();}finally{this.syncMonitors();}});this.serial=work.then(()=>{},()=>{});return work;}
  private save(){return this.host.save(this.state);}
  async initialize(){
    const raw=await this.host.load();if(!isRecord(raw))return;
    const displays:unknown[]=Array.isArray(raw.displays)?raw.displays:[],reservations:unknown[]=Array.isArray(raw.responseReservations)?raw.responseReservations:[];
    if(displays.length>256||reservations.length>2048)throw Error('Too many retained reply registrations.');
    for(const value of displays){if(!isRecord(value)||typeof value.id!=='string'||!Array.isArray(value.destinations)||!Array.isArray(value.bindings))throw Error('Invalid retained reply registration.');validateDisplayCommand({version:1,id:value.id,kind:'stream-thread',scope:'thread',source:value,destinations:(value.destinations as unknown[]).filter(isRecord).map(destination=>destination.path)});}
    for(const value of reservations)validateResponseReservation({version:1,id:'00000000-0000-4000-8000-000000000000',kind:'reserve-thread-response',source:value,...(isRecord(value)?{messageId:value.messageId,responses:value.responses}:{})});
    // Old event notification/subscription fields are deliberately discarded.
    this.state={version:1,displays:jsonClone(displays) as ThreadDisplay[],responseReservations:jsonClone(reservations) as ThreadResponseReservation[],commands:{}};await this.save();this.syncMonitors();
  }
  async command(input:ThreadCommand):Promise<ThreadDisplayResult>{return this.run(async()=>{
    const command=validateThreadCommand(input),key=JSON.stringify(command),prior=this.state.commands[command.id];if(prior){if(prior.input!==key)throw Error('This request ID belongs to different input.');return jsonClone(prior.result);}
    const before=jsonClone(this.state);
    try{
      if(command.kind==='stream-thread'&&this.state.displays.some(display=>display.id===command.id))throw Error('This reply-following registration already exists. Inspect it before creating another.');
      let result:ThreadDisplayResult;
      if(command.kind==='reserve-thread-response'){reserveThreadResponse(this.state.responseReservations,command);this.state.responseReservations=this.state.responseReservations.slice(-2048);result={id:command.id,ok:true};}
      else result={id:command.id,ok:true,...await displayCommand(this.state.displays,command,this.displayIO(true),this.host.now()),monitoring:this.active};
      if(command.kind!=='thread-streams'){this.state.commands[command.id]={input:key,result:jsonClone(result)};const ids=Object.keys(this.state.commands);for(const id of ids.slice(0,-512))delete this.state.commands[id];await this.save();}return result;
    }catch(error){this.state=before;throw error;}
  });}
  private async read(target:ThreadTarget,fresh=false){
    const key=this.key(target),cached=this.threads.get(key);if(!fresh&&cached&&cached.canonicalUntil>this.host.now()&&cached.state.historyComplete)return cached.state;
    const state=compactObservedThread(await this.host.displayHost.readThread(target));
    if(state.sequence!==undefined&&cached?.state.sequence!==undefined&&state.sequence<cached.state.sequence)return cached.state;
    const merged={...state,...(state.sequence===undefined&&cached?.state.sequence!==undefined?{sequence:cached.state.sequence}:{}),turns:{...cached?.state.turns,...state.turns,...(state.latestTurn?{[state.latestTurn.turnId]:state.latestTurn}:{})}};
    this.threads.set(key,{state:merged,sequence:cached?.sequence,canonicalUntil:this.host.now()+30_000});return merged;
  }
  private displayIO(fresh=false):DisplayHost{return {...this.host.displayHost,readThread:target=>this.read(target,fresh),responseBindings:async target=>[...reservedResponseBindings(this.state.responseReservations,target),...await this.host.displayHost.responseBindings(target)],save:()=>this.save()};}
  tick(){if(this.ticking)return this.ticking;const work=this.run(async()=>{for(const display of this.state.displays.filter(value=>value.enabled&&!value.cancelled)){try{await tickDisplay(display,this.displayIO());if(display.error){delete display.error;await this.save();}}catch(error){const message=error instanceof Error?error.message:String(error);if(display.error!==message){display.error=message;await this.save();}}}});this.ticking=work;void work.finally(()=>{if(this.ticking===work)this.ticking=undefined;}).catch(()=>{});return work;}
  rename(before:string,after:string){return this.run(async()=>{renameDisplays(this.state.displays,before,after);renameResponseReservations(this.state.responseReservations,before,after);await this.save();});}
  private syncMonitors(){
    if(this.stopped||!this.host.watchThread)return;
    const targets=new Map(this.state.displays.filter(value=>value.enabled&&!value.cancelled).map(value=>[this.key(value),value]));
    for(const [key,monitor] of this.monitors)if(!targets.has(key)){monitor.stop();this.monitors.delete(key);this.threads.delete(key);}
    for(const [key,target] of targets)if(!this.monitors.has(key))this.monitors.set(key,this.host.watchThread(target,item=>{
      if(!isRecord(item))return;
      void this.run(async()=>{const previous:{state:InlineThreadState;canonicalUntil:number;sequence?:number}=this.threads.get(key)??{state:{messages:[],activities:[]},canonicalUntil:0};if(item.kind==='event'&&isRecord(item.event)&&typeof item.event.sequence==='number'&&item.event.sequence<=(previous.sequence??-1))return;
        const next=applyThreadItem(previous.state,item),sequence=item.kind==='snapshot'&&previous.sequence!==undefined?previous.sequence:next.sequence??previous.sequence;
        this.threads.set(key,{state:compactObservedThread(next.state),sequence,canonicalUntil:previous.canonicalUntil});}).catch(()=>{});
    },()=>this.threads.get(key)?.sequence,()=>{const cached=this.threads.get(key);if(cached)cached.canonicalUntil=0;}));
  }
  stop(){this.stopped=true;for(const monitor of this.monitors.values())monitor.stop();this.monitors.clear();this.threads.clear();}
}
