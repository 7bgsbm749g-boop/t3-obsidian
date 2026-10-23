import {obsidianFooter} from './obsidian-prompt';
import {responseIds,containerStart,responseFrame} from './response-container';
import {EventActionSkipped,validateEventAction,type EventAction,type ActionPlan} from './event-actions';
import {jobEvents,validateJob,type JobWatch,type JobEvent,type JobObservation} from './job-lifecycle';
import {STREAM_COMMANDS,validateDisplayCommand,displayCommand,tickDisplay,renameDisplays,type ThreadDisplayCommand,type ThreadDisplay,type DisplayHost} from './thread-display';
import {applyThreadItem,type InlineThreadState} from './inline-thread';
import {sha256} from '@noble/hashes/sha256';
import {safeNotePath} from './response-model';
import {isLogPath} from './synced-event-logs';
import {markdownCodeRanges} from './reply-html';

export const EVENT_KINDS=['create','modify','property','rename','delete'] as const;
export type EventKind=typeof EVENT_KINDS[number];
export interface EventScope {path:string;kind:'note'|'folder';recursive:boolean}
export interface EventFilter {events:EventKind[];property?:string;equals?:unknown}
export interface EventTarget {threadId:string;projectId:string;environmentId:string}
export interface EventSubscription extends Partial<EventTarget> {action?:EventAction;jobStates?:string[];id:string;scope:EventScope;filter:EventFilter;enabled:boolean;revision:number;createdAt:string;job?:JobWatch;observation?:JobObservation}
export interface NoteEventSubscriptionCommand {
  version:1;id:string;kind:'subscribe'|'subscribe-job'|'subscriptions'|'update-subscription'|'pause-subscription'|'resume-subscription'|'cancel-subscription';
  subscriptionId?:string;target?:EventTarget;action?:EventAction;jobStates?:string[];scope?:EventScope;filter?:EventFilter;job?:JobWatch;
}
export type EventSubscriptionCommand=NoteEventSubscriptionCommand|ThreadDisplayCommand;
export interface EventCommandResult {display?:ThreadDisplay;displays?:ThreadDisplay[];host?:import('./event-host').EventHostIdentity;id:string;ok:boolean;subscriptionId?:string;subscriptions?:EventSubscription[];monitoring?:boolean;notifications?:Array<Pick<EventNotification,'id'|'subscriptionId'|'status'|'count'|'attempts'|'error'|'action'>>;error?:string}
export interface NoteEventSnapshot {path:string;content:string;properties:Record<string,unknown>|null}
export interface NoteEvent {kind:EventKind;path:string;oldPath?:string;at:string;beforeHash?:string;afterHash?:string;property?:string;before?:unknown;after?:unknown}
export interface EventNotification {id:string;subscriptionId:string;target?:EventTarget;action?:EventAction;events:Array<NoteEvent|JobEvent>;count:number;firstAt:number;dueAt:number;status:'pending'|'prepared'|'delivered'|'cancelled';command?:unknown;attempts:number;retryAt?:number;error?:string}
export interface ActionEffect {notificationId:string;kind:'modify'|'rename';path:string;oldPath?:string;afterHash:string;expiresAt:number}
export interface EventState {actionEffects?:ActionEffect[];version:1;subscriptions:EventSubscription[];notifications:EventNotification[];commands:Record<string,{input:string;result:EventCommandResult}>;feedback:EventTarget[];displays?:ThreadDisplay[];threads?:Record<string,{state:InlineThreadState;sequence?:number}>}
export interface EventSubscriptionHost {
  load():Promise<unknown>;save(state:EventState):Promise<void>;notes(scope:EventScope):Promise<NoteEventSnapshot[]>;
  validateTarget(target:EventTarget):Promise<void>;isBusy(target:EventTarget):Promise<boolean>;
  prepare(notification:EventNotification):Promise<unknown>;
  deliver(notification:EventNotification):Promise<'delivered'|'busy'>;
  prepareAction?(notification:EventNotification):Promise<ActionPlan>;
  deliverAction?(notification:EventNotification):Promise<void>;
  readThread?(target:EventTarget):Promise<InlineThreadState>;
  displayHost?:Omit<DisplayHost,'save'|'readThread'>;
  watchThread?(target:EventTarget,item:(value:any)=>void,sequence:()=>number|undefined,reconnecting?:()=>void):{stop():void};
  recording(active:boolean):void;now():number;id():string;
}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const identity=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value);
export function validateEventScope(value:any):EventScope {
  if(!value||!['note','folder'].includes(value.kind)||typeof value.recursive!=='boolean'||typeof value.path!=='string')throw Error('Invalid event subscription scope.');
  if(value.kind==='note'?!safeNotePath(value.path):value.path!=='/'&&!safeNotePath(value.path+'/scope.md'))throw Error('Use a vault-relative note or folder path.');
  if(value.path.startsWith('T3 Code Logs')||isLogPath(value.path))throw Error('Plugin logs cannot be watched.');
  return {path:value.path,kind:value.kind,recursive:value.recursive};
}
export function validateEventFilter(value:any):EventFilter {
  if(!value||!Array.isArray(value.events)||!value.events.length||value.events.length>5||new Set(value.events).size!==value.events.length||value.events.some((kind:unknown)=>!EVENT_KINDS.includes(kind as EventKind)))throw Error('Select create, modify, property, rename, or delete events.');
  if(value.property!==undefined&&(!identity(value.property)||value.property.length>100))throw Error('Invalid property name.');
  if(value.events.includes('property')&&!value.property)throw Error('Property events require a property name.');
  if((value.property!==undefined||Object.hasOwn(value,'equals'))&&(!value.events.includes('property')||value.events.length!==1))throw Error('Property filters require only property events.');
  if(Object.hasOwn(value,'equals')&&JSON.stringify(value.equals).length>4096)throw Error('Property value is too large.');
  return {events:[...value.events],...(value.property?{property:value.property}:{}),...(Object.hasOwn(value,'equals')?{equals:value.equals}:{})};
}
export function validateEventCommand(value:any):EventSubscriptionCommand {
  if(STREAM_COMMANDS.includes(value?.kind))return validateDisplayCommand(value);
  if(value?.version!==1||!uuid(value.id)||!['subscribe','subscribe-job','subscriptions','update-subscription','pause-subscription','resume-subscription','cancel-subscription'].includes(value.kind))throw Error('Invalid event subscription command.');
  if(value.kind==='subscribe'||value.kind==='subscribe-job'){
    if(value.action!==undefined){validateEventAction(value.action);if(value.target!==undefined)throw Error('Choose either an action or a receiving thread.');if(value.kind==='subscribe-job'&&!value.action.notePath)throw Error('Job actions require notePath.');}
    else if(!value.target||![value.target.threadId,value.target.projectId,value.target.environmentId].every(identity))throw Error('A subscription needs its originating thread, project, and machine IDs, or an action.');
    if(value.kind==='subscribe-job'){validateJob(value.job);if(value.scope!==undefined||value.filter!==undefined)throw Error('Job watches do not take note filters.');}
    else {validateEventScope(value.scope);validateEventFilter(value.filter);if(value.action&&!value.action.notePath&&value.filter.events.includes('delete'))throw Error('Delete actions require an explicit notePath.');}
  }else if(value.kind!=='subscriptions'&&!uuid(value.subscriptionId))throw Error('A subscription ID is required.');
  if(value.kind==='update-subscription'){
    if(!value.scope&&!value.filter)throw Error('Supply a scope or event filter to update.');
    if(value.scope)validateEventScope(value.scope);if(value.filter)validateEventFilter(value.filter);
  }
  if(!['subscribe','update-subscription'].includes(value.kind)&&(value.scope!==undefined||value.filter!==undefined))throw Error('This command does not accept a scope or filter.');
  if(!['subscribe','subscribe-job'].includes(value.kind)&&value.target!==undefined)throw Error('A subscription cannot change its receiving thread.');
  if(value.action!==undefined&&!['subscribe','subscribe-job'].includes(value.kind))throw Error('Action identity is immutable; create a new subscription.');
  if(value.jobStates!==undefined&&(value.kind!=='subscribe-job'||!value.action||!Array.isArray(value.jobStates)||!value.jobStates.length||value.jobStates.some((s:unknown)=>!['running','waiting-approval','waiting-input','completed','failed','interrupted','cancelled'].includes(s as string))))throw Error('Job action states must select valid job states.');
  if(value.job!==undefined&&value.kind!=='subscribe-job')throw Error('Job watches require subscribe-job.');
  return value;
}
export function eventContent(content:string):string {
  for(const id of responseIds(content)){
    if(!content.includes(containerStart(id)))continue;
    try{const frame=responseFrame(content,id);if(frame)content=content.slice(0,frame.from)+content.slice(frame.to+(content[frame.to]==='\n'?1:0));}catch{/* Ambiguous content remains observable. */}
  }
  // Stream insertions and completed replies never become note-change events.
  const code=content.includes('<!-- t3-')?markdownCodeRanges(content):[];
  return content.replace(/<!-- t3-(inline|response):start:([^\s]+) -->[\s\S]*?<!-- t3-\1:end:\2 -->(?:\r?\n)?/g,(text,_kind,_id,offset:number)=>code.some(([from,to])=>offset>=from&&offset<to)?text:'').replace(/\n+$/,'');
}
function canonical(value:unknown):string {if(value===undefined)return 'undefined';if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as any)[key])).join(',')+'}';}
function hash(text:string){return Array.from(sha256(new TextEncoder().encode(text)),byte=>byte.toString(16).padStart(2,'0')).join('');}
export function inEventScope(scope:EventScope,path:string):boolean {
  if(!safeNotePath(path)||isLogPath(path))return false;
  if(scope.kind==='note')return path===scope.path;
  const prefix=scope.path==='/'?'':scope.path+'/';if(!path.startsWith(prefix))return false;
  return scope.recursive||!path.slice(prefix.length).includes('/');
}
function eventValue(value:unknown):unknown {const text=canonical(value);return text.length<=2048?value??null:{truncated:true,hash:hash(text)};}
export function observedPropertyEquals(current:unknown,observed:unknown){return canonical(eventValue(current))===canonical(observed);}
function sameTarget(a:Partial<EventTarget>,b:Partial<EventTarget>){return a.threadId===b.threadId&&a.projectId===b.projectId&&a.environmentId===b.environmentId;}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const empty=():EventState=>({version:1,subscriptions:[],notifications:[],commands:{},feedback:[]});
/** Thread snapshots contain plain JSON data. Compare without allocating another
 * encoded copy of every message body; equal snapshots retain their references. */
function sameThreadData(a:any,b:any):boolean {
  if(a===b)return true;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>sameThreadData(value,b[index]));
  // Optional undefined fields disappear in the durable JSON representation.
  const keys=Object.keys(a).filter(key=>a[key]!==undefined);
  return keys.length===Object.keys(b).filter(key=>b[key]!==undefined).length&&keys.every(key=>Object.hasOwn(b,key)&&sameThreadData(a[key],b[key]));
}
function sameObservedThread(a:InlineThreadState,b:InlineThreadState){
  const {sequence:_a,...left}=a,{sequence:_b,...right}=b;
  return sameThreadData(left,right);
}

/** Lifecycle subscriptions need prompts, run identities and blocking controls.
 * Tool output and assistant/reasoning bodies belong to the reply renderer. */
function compactObservedThread(state:InlineThreadState):InlineThreadState {
  if(state.protocolVersion!==2)return state;
  const {inputBoundaries:_boundaries,...rest}=state;
  const lifecycle=new Set(['approval.requested','approval.resolved','user-input.requested','user-input.resolved','provider.turn.start.failed','runtime.error']);
  const controls=Object.fromEntries(Object.entries(state.v2Controls??{}).map(([id,c])=>[id,{id:c.id,type:c.type,requestId:c.requestId,runId:c.runId,status:c.status,startedAt:c.startedAt,updatedAt:c.updatedAt,completedAt:c.completedAt,responseMode:c.responseMode}]));
  const requests=Object.fromEntries(Object.entries(state.v2Requests??{}).map(([id,r])=>[id,{id:r.id,status:r.status,resolvedAt:r.resolvedAt,responseCapability:r.responseCapability?{type:r.responseCapability.type}:undefined,answers:r.answers?{}:undefined}]));
  return {...rest,messages:state.messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>m.role==='user'?{id:m.id,role:m.role,text:m.text,turnId:m.turnId,streaming:m.streaming,createdAt:m.createdAt,createdBy:m.createdBy,creationSource:m.creationSource,senderThreadId:m.senderThreadId,senderThreadTitle:m.senderThreadTitle,delegatedCompletion:m.delegatedCompletion}:{id:m.id,role:m.role,text:'',turnId:m.turnId,streaming:m.streaming,createdAt:m.createdAt}),
    activities:state.activities.filter(a=>lifecycle.has(a.kind)).map(a=>({...a,payload:a.payload?{requestId:a.payload.requestId,responseMode:a.payload.responseMode,detail:a.payload.detail,answers:a.payload.answers?{}:undefined}:undefined})),
    ...(state.v2Controls?{v2Controls:controls}:{}),...(state.v2Requests?{v2Requests:requests}:{})};
}

/** One desktop host, serialized capture, durable messages; no task definitions. */
export class EventSubscriptions {
  private canonicalUntil=new Map<string,number>();
  private state=empty();private baselines=new Map<string,Map<string,NoteEventSnapshot>>();private work=Promise.resolve();private ticking?:Promise<void>;private tickNeedsSave=false;private dirty=false;private reads?:Map<string,Promise<InlineThreadState>>;private stopped=false;private monitors=new Map<string,{stop():void}>();
  constructor(private host:EventSubscriptionHost){}
  get active(){return this.state.subscriptions.some(subscription=>subscription.enabled)||(this.state.displays??[]).some(d=>d.enabled&&!d.cancelled);}
  get snapshot(){return clone(this.state);}
  private serialize<T>(action:()=>Promise<T>,rollback=true):Promise<T>{
    const run=this.work.catch(()=>{}).then(async()=>{
      if(this.stopped)throw Error('Event subscriptions are stopped.');
      // Reducers replace thread records. Roll back their table, not megabytes of
      // unchanged history. Mutable delivery/control records still get a deep copy.
      const before=rollback?this.checkpoint():undefined,dirty=this.dirty;
      const baselines=rollback?new Map([...this.baselines].map(([key,notes])=>[key,new Map(notes)])):undefined;
      this.reads=new Map();
      try{return await action();}catch(error){if(before){this.state=before;this.baselines=baselines!;this.dirty=dirty;}throw error;}finally{this.reads=undefined;this.host.recording(this.active&&!this.stopped);this.syncMonitors();}
    });this.work=run.then(()=>{},()=>{});return run;
  }
  private checkpoint():EventState {
    const {threads,...control}=this.state;
    return {...clone(control),...(threads?{threads:{...threads}}:{})};
  }
  private pruneThreads(){
    const retained=new Set([...this.state.subscriptions.flatMap(subscription=>subscription.enabled&&subscription.job&&!subscription.observation?.terminal?[this.threadKey(subscription.job)]:[]),...(this.state.displays??[]).filter(display=>display.enabled&&!display.cancelled).map(display=>this.threadKey(display))]);
    for(const key of Object.keys(this.state.threads??{}))if(!retained.has(key)){delete this.state.threads![key];this.canonicalUntil.delete(key);}
  }
  private async save(){this.pruneThreads();this.dirty=true;await this.host.save(this.state);this.dirty=false;}
  private async saveIfDirty(){if(this.dirty)await this.save();}
  async initialize(){return this.serialize(async()=>{
    const saved=await this.host.load() as EventState|undefined;
    if(saved){
      if(saved.version!==1||!Array.isArray(saved.subscriptions)||!Array.isArray(saved.notifications)||!saved.commands||!Array.isArray(saved.feedback))throw Error('Invalid saved event subscription state.');
      for(const subscription of saved.subscriptions){validateEventCommand({version:1,id:subscription.id,kind:subscription.job?'subscribe-job':'subscribe',...(subscription.action?{action:subscription.action,jobStates:subscription.jobStates}:{target:subscription}),...(subscription.job?{job:subscription.job}:{scope:subscription.scope,filter:subscription.filter})});if(typeof subscription.enabled!=='boolean')throw Error('Invalid saved subscription.');}
      this.state=clone(saved);
      this.pruneThreads();
      for(const thread of Object.values(this.state.threads??{}))thread.state=compactObservedThread(thread.state);
      for(const display of this.state.displays??[])for(const binding of display.bindings)if(binding.request&&!binding.request.localOnly){binding.status='skipped';delete binding.request;delete binding.error;}
      // Command receipts remain idempotent but never replay old reply plans.
      for(const receipt of Object.values(this.state.commands))for(const display of [...(receipt.result.displays??[]),...(receipt.result.display?[receipt.result.display]:[])])for(const binding of display.bindings)if(binding.request&&!binding.request.localOnly){binding.status='skipped';delete binding.request;delete binding.error;}
    }
    for(const subscription of this.state.subscriptions)if(subscription.enabled)await this.seed(subscription);
  });}
  private async seed(subscription:EventSubscription){if(subscription.job)return;const notes=await this.host.notes(subscription.scope);this.baselines.set(subscription.id,new Map(notes.filter(note=>inEventScope(subscription.scope,note.path)).map(note=>[note.path,{...note,content:eventContent(note.content)}])));}
  async command(input:EventSubscriptionCommand):Promise<EventCommandResult>{return this.serialize(async()=>{
    const command=validateEventCommand(input),key=canonical(command),prior=this.state.commands[command.id];
    if(prior){if(prior.input!==key)throw Error('This request ID already belongs to different input.');return clone(prior.result);}
    if((STREAM_COMMANDS as readonly string[]).includes(command.kind)){
      const fields=await displayCommand(this.state.displays??= [],command as ThreadDisplayCommand,this.displayIO(true),this.host.now());
      const result:EventCommandResult={id:command.id,ok:true,monitoring:this.active,...clone(fields)};
      this.state.commands[command.id]={input:key,result};await this.save();return result;
    }
    const noteCommand=command as NoteEventSubscriptionCommand;
    let subscription:EventSubscription|undefined;
    if(noteCommand.kind==='subscribe'||noteCommand.kind==='subscribe-job'){
      if(this.state.subscriptions.length>=256)throw Error('Cancel unused subscriptions before adding more (limit 256).');
      if(noteCommand.action){if(!this.host.prepareAction||!this.host.deliverAction)throw Error('Direct actions are unavailable on this host.');}else await this.host.validateTarget(noteCommand.target!);if(noteCommand.job)await this.host.validateTarget(noteCommand.job);
      subscription={...(noteCommand.action?{action:validateEventAction(noteCommand.action),...(noteCommand.job?{jobStates:noteCommand.jobStates??['completed']}:{})}:noteCommand.target!),id:noteCommand.id,scope:noteCommand.job?{path:'/',kind:'folder',recursive:true}:validateEventScope(noteCommand.scope),filter:noteCommand.job?{events:['modify']}:validateEventFilter(noteCommand.filter),...(noteCommand.job?{job:validateJob(noteCommand.job),observation:{seen:[]}}:{}),enabled:true,revision:1,createdAt:new Date(this.host.now()).toISOString()};
      await this.seed(subscription);this.state.subscriptions.push(subscription);
    }else if(noteCommand.kind!=='subscriptions'){
      subscription=this.state.subscriptions.find(item=>item.id===noteCommand.subscriptionId);if(!subscription)throw Error('Event subscription not found.');
      if(noteCommand.kind==='cancel-subscription')this.state.subscriptions=this.state.subscriptions.filter(item=>item!==subscription);
      else {
        if(noteCommand.kind==='update-subscription'){if(subscription.job)throw Error('Job identity is immutable; create a new job subscription.');if(noteCommand.scope)subscription.scope=validateEventScope(noteCommand.scope);if(noteCommand.filter){if(subscription.action&&!subscription.action.notePath&&noteCommand.filter.events.includes('delete'))throw Error('Delete actions require an explicit notePath.');subscription.filter=validateEventFilter(noteCommand.filter);}}
        subscription.enabled=noteCommand.kind==='pause-subscription'?false:noteCommand.kind==='resume-subscription'?true:subscription.enabled;subscription.revision++;
      }
      this.baselines.delete(subscription.id);
      if(subscription.enabled&&noteCommand.kind!=='cancel-subscription')await this.seed(subscription);
      for(const notification of this.state.notifications)if(notification.subscriptionId===subscription.id&&['pending','prepared'].includes(notification.status)){notification.status='cancelled';if(notification.action)delete notification.command;}
    }
    const result:EventCommandResult={id:noteCommand.id,ok:true,monitoring:this.active,...(subscription?{subscriptionId:subscription.id}:{}),...(noteCommand.kind==='subscriptions'?{subscriptions:clone(this.state.subscriptions),notifications:this.state.notifications.filter(n=>n.action||n.status==='pending'||n.status==='prepared').map(({id,subscriptionId,status,count,attempts,error,action})=>({id,subscriptionId,status,count,attempts,...(action?{action}:{}),...(error?{error}:{})}))}:{})};
    this.state.commands[noteCommand.id]={input:key,result};await this.save();return result;
  });}
  interested(path:string,oldPath?:string){return !this.stopped&&Boolean(oldPath&&(this.state.displays??[]).length)||!this.stopped&&this.state.subscriptions.some(subscription=>subscription.enabled&&!subscription.job&&(inEventScope(subscription.scope,path)||Boolean(oldPath&&inEventScope(subscription.scope,oldPath))));}
  async observe(kind:Exclude<EventKind,'property'>,path:string,note?:NoteEventSnapshot,oldPath?:string){
    if(kind==='rename'&&oldPath&&(this.state.displays??[]).length)await this.serialize(async()=>{renameDisplays(this.state.displays!,oldPath,path);await this.save();});
    if(!this.interested(path,oldPath))return;
    return this.serialize(()=>this.capture(kind,path,note,oldPath));
  }
  private async capture(kind:Exclude<EventKind,'property'>,path:string,note?:NoteEventSnapshot,oldPath?:string){
      const now=this.host.now(),content=note?eventContent(note.content):undefined;
      this.expireEffects(now);
      const effect=this.state.actionEffects?.find(e=>e.kind===kind&&e.path===path&&e.oldPath===oldPath&&content!==undefined&&e.afterHash===hash(content));
      for(const subscription of this.state.subscriptions){
        if(subscription.job||!subscription.enabled||!inEventScope(subscription.scope,path)&&!(oldPath&&inEventScope(subscription.scope,oldPath)))continue;
        const baselines=this.baselines.get(subscription.id)??new Map<string,NoteEventSnapshot>(),before=baselines.get(oldPath??path);
        const feedback=this.state.feedback.some(target=>sameTarget(target,subscription));
        // Only turns initiated by this system suppress feedback. Ordinary busy
        // threads still receive queued changes from users and other threads.
        const suppressed=feedback||Boolean(effect);
        const changed=before&&note&&before.content!==content;
        const event:NoteEvent={kind,path,...(oldPath?{oldPath}:{}),at:new Date(now).toISOString(),...(before?{beforeHash:hash(before.content)}:{}),...(content!==undefined?{afterHash:hash(content)}:{})};
        const events:NoteEvent[]=[];
        if(!suppressed){
          if(subscription.filter.events.includes(kind)&&(kind!=='modify'||changed)&&(kind!=='create'||!before))events.push(event);
          if(kind==='modify'&&before?.properties&&note?.properties&&subscription.filter.events.includes('property')){
            const property=subscription.filter.property!,prev=before.properties[property],next=note.properties[property];
            if(canonical(prev)!==canonical(next)&&(!Object.hasOwn(subscription.filter,'equals')||canonical(next)===canonical(subscription.filter.equals)))events.push({...event,kind:'property',property,before:eventValue(prev),after:eventValue(next)});
          }
        }
        for(const event of events)this.enqueue(subscription,event,now);
        if(kind==='rename'&&oldPath&&subscription.scope.kind==='note'&&subscription.scope.path===oldPath){subscription.scope.path=path;subscription.revision++;this.dirty=true;}
        if(oldPath)baselines.delete(oldPath);if(note&&kind!=='delete'&&inEventScope(subscription.scope,path))baselines.set(path,{...note,content:content!});else baselines.delete(path);
        this.baselines.set(subscription.id,baselines);
      }
      if(effect){this.state.actionEffects=this.state.actionEffects!.filter(e=>e!==effect);this.dirty=true;}
      // Follow an explicitly watched note or folder through a rename.
      if(kind==='rename'&&oldPath){renameDisplays(this.state.displays??[],oldPath,path);this.dirty=true;}
      if(kind==='rename'&&oldPath)for(const subscription of this.state.subscriptions)if(subscription.scope.path===oldPath||subscription.scope.path.startsWith(oldPath+'/')){subscription.scope.path=path+subscription.scope.path.slice(oldPath.length);subscription.revision++;this.dirty=true;}
      await this.saveIfDirty();
  }
  interestedFolder(path:string,oldPath?:string){return Boolean(oldPath&&(this.state.displays??[]).length)||this.active&&[path,oldPath].some(folder=>folder&&this.state.subscriptions.some(s=>s.enabled&&!s.job&&(s.scope.path===folder||s.scope.path.startsWith(folder+'/')||s.scope.kind==='folder'&&inEventScope(s.scope,folder+'/scope.md'))));}
  async renameFolder(oldPath:string,path:string,notes:NoteEventSnapshot[]){
    if((this.state.displays??[]).length)await this.serialize(async()=>{renameDisplays(this.state.displays!,oldPath,path);await this.save();});
    if(!this.interestedFolder(path,oldPath))return;
    return this.serialize(async()=>{
      renameDisplays(this.state.displays??[],oldPath,path);
      for(const note of notes)await this.capture('rename',note.path,note,oldPath+note.path.slice(path.length));
      for(const subscription of this.state.subscriptions)if(subscription.scope.path===oldPath||subscription.scope.path.startsWith(oldPath+'/')){subscription.scope.path=path+subscription.scope.path.slice(oldPath.length);subscription.revision++;}
      for(const subscription of this.state.subscriptions)if(subscription.enabled)await this.seed(subscription);
      await this.save();
    });
  }
  async deleteFolder(path:string){
    if(!this.interestedFolder(path))return;
    return this.serialize(async()=>{const paths=new Set<string>();for(const notes of this.baselines.values())for(const note of notes.keys())if(note.startsWith(path+'/'))paths.add(note);for(const note of paths)await this.capture('delete',note);});
  }
  private enqueue(subscription:EventSubscription,event:NoteEvent|JobEvent,now:number){
    let notification=this.state.notifications.find(item=>item.subscriptionId===subscription.id&&item.status==='pending'&&item.events[0]?.path===event.path&&event.kind!=='job');
    if(notification){notification.events.push(event);notification.events=notification.events.slice(-32);notification.count++;notification.dueAt=Math.min(now+1500,notification.firstAt+30_000);}
    else {
      if(this.state.notifications.filter(item=>item.status==='pending'||item.status==='prepared').length>=1000)throw Error('Event notification queue is full. Reconnect receiving threads.');
      notification={id:this.host.id(),subscriptionId:subscription.id,...(subscription.action?{action:clone(subscription.action)}:{target:{threadId:subscription.threadId!,projectId:subscription.projectId!,environmentId:subscription.environmentId!}}),events:[event],count:1,firstAt:now,dueAt:now+1500,status:'pending',attempts:0};this.state.notifications.push(notification);
    }
    this.dirty=true;
  }
  private expireEffects(now:number,bounded=false){
    const effects=this.state.actionEffects;if(!effects)return;
    const current=effects.filter(e=>e.expiresAt>now),retained=bounded?current.slice(-1000):current;
    if(retained.length!==effects.length){this.state.actionEffects=retained;this.dirty=true;}
  }
  tick(){if(this.ticking)return this.ticking;const run=this.serialize(async()=>{
    if(this.tickNeedsSave){await this.save();this.tickNeedsSave=false;}
    if(!this.active)return;
    this.expireEffects(this.host.now(),true);
    for(const subscription of this.state.subscriptions.filter(s=>s.enabled&&s.job)){
      try{
        if(!subscription.observation){subscription.observation={seen:[]};this.dirty=true;}
        const observation=subscription.observation;if(observation.terminal)continue;
        const state=await this.readObservedThread(subscription.job!);
        const previousTurn=observation.turnId;
        for(const event of jobEvents(subscription.job!,state,observation)){
          this.dirty=true;
          if(!subscription.action||subscription.jobStates?.includes(event.state))this.enqueue(subscription,event,this.host.now());observation.seen.push(event.id);if(event.terminal)observation.terminal=event.state;
        }
        if(observation.turnId!==previousTurn||Object.hasOwn(observation,'error'))this.dirty=true;
        delete observation.error;await this.saveIfDirty();
      }catch(error){subscription.observation??={seen:[]};const message=error instanceof Error?error.message:String(error);if(subscription.observation.error!==message){subscription.observation.error=message;this.dirty=true;}await this.saveIfDirty();}
    }
    for(const display of this.state.displays??[]){
      if(!display.enabled||display.cancelled)continue;
      try{await tickDisplay(display,this.displayIO());if(Object.hasOwn(display,'error')){delete display.error;this.dirty=true;}}
      catch(error){const message=error instanceof Error?error.message:String(error);if(display.error!==message){display.error=message;this.dirty=true;}}
      await this.saveIfDirty();
    }
    // Once a notified thread becomes idle, rebaseline its scopes before clearing
    // suppression. Its edits may arrive via Sync after completion; identical
    // snapshots and response stripping also exclude repeats.
    for(const target of [...this.state.feedback]){
      try{if(await this.host.isBusy(target))continue;}catch{continue;}
      for(const subscription of this.state.subscriptions)if(subscription.enabled&&sameTarget(subscription,target))await this.seed(subscription);
      this.state.feedback=this.state.feedback.filter(item=>!sameTarget(item,target));await this.save();
    }
    for(const notification of this.state.notifications){
      if(this.stopped)return;
      if(!['pending','prepared'].includes(notification.status)||notification.dueAt>this.host.now()||(notification.retryAt??0)>this.host.now())continue;
      const subscription=this.state.subscriptions.find(item=>item.id===notification.subscriptionId);if(!subscription?.enabled)continue;
      try{
        if(notification.status==='pending'){
          if(notification.target&&await this.host.isBusy(notification.target))continue;
          notification.command=notification.action?await this.host.prepareAction!(notification):await this.host.prepare(notification);notification.status='prepared';await this.save();
        }
        notification.attempts++;
        if(notification.action){
          const plan=notification.command as ActionPlan;
          if(plan.before!==plan.after||plan.destination&&plan.destination!==plan.path){
            const effects=this.state.actionEffects??=[];
            const effect={notificationId:notification.id,kind:plan.kind==='move-note'?'rename' as const:'modify' as const,path:plan.destination??plan.path,...(plan.destination?{oldPath:plan.path}:{}),afterHash:hash(eventContent(plan.after)),expiresAt:this.host.now()+60_000};
            const index=effects.findIndex(e=>e.notificationId===notification.id);if(index<0)effects.push(effect);else effects[index]=effect;
          }
          await this.save();await this.host.deliverAction!(notification);
          notification.status='delivered';notification.command={version:1,kind:plan.kind,path:plan.path,destination:plan.destination,beforeHash:hash(plan.before),afterHash:hash(plan.after)};delete notification.error;delete notification.retryAt;
          await this.save();continue;
        }
        const target=notification.target!;
        const alreadyFeedback=this.state.feedback.some(t=>sameTarget(t,target));
        if(!alreadyFeedback)this.state.feedback.push(target);
        // Save loop suppression and exact T3 command before the first network write.
        await this.save();
        const result=await this.host.deliver(notification);
        if(result==='busy'){if(!alreadyFeedback)this.state.feedback=this.state.feedback.filter(target=>!sameTarget(target,notification.target!));await this.save();continue;}
        notification.status='delivered';delete notification.error;delete notification.retryAt;
      }catch(error){if(error instanceof EventActionSkipped){notification.status='cancelled';notification.error=error.message;await this.save();continue;}if(notification.status==='pending')notification.attempts++;notification.error=error instanceof Error?error.message:String(error);notification.retryAt=this.host.now()+Math.min(60_000,1000*2**Math.min(notification.attempts,6));}
      await this.save();
    }
    // Bounded receipts; never prune unresolved notifications.
    const terminal=this.state.notifications.filter(item=>item.status==='delivered'||item.status==='cancelled');
    if(terminal.length>200){const retained=new Set(terminal.slice(-200).map(item=>item.id));this.state.notifications=this.state.notifications.filter(item=>item.status==='pending'||item.status==='prepared'||retained.has(item.id));await this.save();}
    await this.saveIfDirty();
  },false).catch(error=>{this.tickNeedsSave=true;throw error;});this.ticking=run;void run.finally(()=>{this.ticking=undefined;}).catch(()=>{});return run;}
  private threadKey(target:EventTarget){return JSON.stringify([target.environmentId,target.projectId,target.threadId]);}
  private async readObservedThread(target:EventTarget,forceCanonical=false){
    if(!this.host.readThread)throw Error('Thread lifecycle observation is unavailable.');
    const key=this.threadKey(target),cached=this.state.threads?.[key];
    if(!forceCanonical&&this.monitors.has(key)&&cached?.state.protocolVersion===2&&cached.state.historyComplete&&this.host.now()<(this.canonicalUntil.get(key)??0))return cached.state;
    let read=this.reads?.get(key);if(!read){read=this.host.readThread(target);this.reads?.set(key,read);}
    const state=compactObservedThread(await read),prior=this.state.threads?.[key];
    this.canonicalUntil.set(key,this.host.now()+30_000);
    if(state.sequence!==undefined&&prior?.state.sequence!==undefined&&state.sequence<prior.state.sequence)return prior.state;
    const merged={...state,...(state.sequence===undefined&&prior?.state.sequence!==undefined?{sequence:prior.state.sequence}:{}),turns:{...prior?.state.turns,...state.turns,...(state.latestTurn?{[state.latestTurn.turnId]:state.latestTurn}:{})}};
    if(prior&&sameObservedThread(prior.state,merged)){
      // A canonical clock-only advance fences late deltas in memory. Unchanged
      // data remains durable at the prior cursor and can be replayed on restart.
      if(merged.sequence!==prior.state.sequence)this.state.threads![key]={...prior,state:merged};
      return this.state.threads![key].state;
    }
    (this.state.threads??={})[key]={state:merged,sequence:prior?.sequence};this.dirty=true;return merged;
  }
  private displayIO(forceCanonical=false):DisplayHost {
    if(!this.host.displayHost)throw Error('Thread streaming is unavailable.');
    return {...this.host.displayHost,readThread:target=>this.readObservedThread(target,forceCanonical),save:()=>this.save()};
  }
  private syncMonitors(){
    if(this.stopped||!this.host.watchThread)return;
    const targets=new Map<string,EventTarget>();
    for(const s of this.state.subscriptions)if(s.enabled&&s.job&&!s.observation?.terminal)targets.set(this.threadKey(s.job),s.job);
    for(const d of this.state.displays??[])if(d.enabled&&!d.cancelled)targets.set(this.threadKey(d),d);
    for(const [key,monitor] of this.monitors)if(!targets.has(key)){monitor.stop();this.monitors.delete(key);this.canonicalUntil.delete(key);}
    for(const [key,target] of targets)if(!this.monitors.has(key))this.monitors.set(key,this.host.watchThread(target,item=>{
      void this.serialize(async()=>{
        const prior=this.state.threads?.[key]??{state:{messages:[],activities:[]}};
        if(item.kind==='event'&&item.event?.sequence<= (prior.sequence??-1))return;
        const reduced=applyThreadItem(prior.state,item),applied={...reduced,state:compactObservedThread(reduced.state)};
        const sequence=item.kind==='snapshot'&&prior.sequence!==undefined?prior.sequence:applied.sequence??prior.sequence;
        if(sameObservedThread(prior.state,applied.state)&&!(item.kind==='snapshot'&&prior.sequence===undefined&&sequence!==undefined)){
          if(applied.state.sequence!==prior.state.sequence||sequence!==prior.sequence)(this.state.threads??={})[key]={state:applied.state,sequence};
          return;
        }
        (this.state.threads??={})[key]={state:applied.state,sequence};this.dirty=true;await this.save();
      }).catch(()=>{});
    },()=>this.state.threads?.[key]?.sequence,()=>{this.canonicalUntil.delete(key);}));
  }
  stop(){this.stopped=true;for(const monitor of this.monitors.values())monitor.stop();this.monitors.clear();this.baselines.clear();this.host.recording(false);}
}

export function notificationPrompt(notification:EventNotification,vault:string){
  return `Obsidian event notification\nVault: ${vault}\nSubscription: ${notification.subscriptionId}\nNotification: ${notification.id}\nObserved changes: ${notification.count}\n\n${JSON.stringify(notification.events,null,2)}${obsidianFooter(vault,notification.events.length===1&&'path' in notification.events[0]?String(notification.events[0].path):'(event notification)')}`;
}
