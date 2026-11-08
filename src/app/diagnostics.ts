import {isRecord} from '../shared/values';
import {jsonClone} from '../shared/values';
export type LogLevel='info'|'warning'|'error';
export interface DiagnosticEvent {at:string;sequence:number;sessionId:string;deviceId:string;event:string;level:LogLevel;fields:Record<string,unknown>}
export interface DiagnosticState {schema:1;events:DiagnosticEvent[]}
export type DiagnosticCategory='connection'|'follow'|'response';
export interface DiagnosticPreferences {connection:boolean;follow:boolean;response:boolean}
export function diagnosticPreferences(value:unknown):DiagnosticPreferences {return {connection:isRecord(value)&&value.connection===true,follow:isRecord(value)&&value.follow===true,response:isRecord(value)&&value.response===true};}
const connectionEvents=new Set(['stream.connecting','stream.connected','stream.reconnecting','stream.closed','stream.stopped','stream.recovered','stream.poll.failed','stream.poll.recovered','stream.direct.reconnecting','stream.direct.recovered','stream.direct.interruption-verification','stream.direct.completion-verification','stream.direct.reset','connection.client-state','connection.auth.renewing','connection.auth.recovered','connection.auth.failed']);
export function diagnosticCategory(event:string):DiagnosticCategory|undefined {return connectionEvents.has(event)?'connection':event==='response.follow.changed'?'follow':/^(?:response\.(?:source|recovery|lifecycle|save|render)\.|note\.save\.)/.test(event)?'response':undefined;}
export interface DiagnosticPolicy {accept?:(event:string)=>boolean;retain?:(event:string)=>boolean;maxEvents?:number;maxBytes?:number;retentionMs?:number;persistOnRecord?:boolean}
export const connectionDiagnosticPolicy={maxEvents:512,maxBytes:256_000,retentionMs:7*24*60*60_000,persistOnRecord:true};
export interface DiagnosticExport extends DiagnosticState {exportedAt:string;context:unknown;storageError:string;enabled?:DiagnosticPreferences}
export interface DiagnosticIO {load():Promise<unknown>;save(state:DiagnosticState):Promise<void>;publish?(events:DiagnosticEvent[]):Promise<void>;readSynced?():Promise<DiagnosticEvent[]>;now?:()=>number;id:()=>string;context:Record<string,unknown>}
const MAX_EVENTS=10_000,MAX_BYTES=8_000_000;
const sensitive=/^(prompt|text|content|body|before|after|selection|attachments|context|credentials?|password|secret|token|authorization|cookie|session|ticket|code|url|connection|account|key|draft)$/i;
export function redact(value:unknown,depth=0):unknown {
  if(depth>5)return '[bounded]';
  if(value instanceof Error){const result:Record<string,unknown>={name:value.name,message:clean(value.message),stack:clean(value.stack??'').slice(0,2500)};for(const key of ['status','kind','rpcMethod','connectionId','elapsedMs','idleMs','pendingCount','cause'])if(key in value)result[key]=redact(Reflect.get(value,key),depth+1);return result;}
  if(typeof value==='string')return clean(value).slice(0,1500);
  if(value===null||typeof value==='number'||typeof value==='boolean')return value;
  if(Array.isArray(value))return value.slice(0,30).map(item=>redact(item,depth+1));
  if(value&&typeof value==='object'){const out:Record<string,unknown>={};for(const [key,item] of Object.entries(value).slice(0,40))out[key]=sensitive.test(key)||/token|secret|password|credential|ticket|cookie|authorization|privatekey/i.test(key)?'[redacted]':redact(item,depth+1);return out;}
  return undefined;
}
function clean(value:string){return value.replace(/(?:https?|wss?):\/\/[^\s)"']+/g,'[address]').replace(/\b(Bearer|DPoP)\s+\S+/gi,'$1 [redacted]').replace(/["']?\b([\w-]*(?:token|secret|password|ticket|authorization|credential|cookie|privatekey)|code)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1=[redacted]');}
type DiagnosticSink=Pick<EventJournal,'record'>&Partial<Pick<EventJournal,'accepts'>>;
let active:DiagnosticSink|undefined;
export function configureDiagnostics(journal?:DiagnosticSink){active=journal;}
export function diagnosticEnabled(event:string){return !!active&&(active.accepts?.(event)??true);}
export function logEvent(event:string,fields:Record<string,unknown>={},level:LogLevel='info'){try{if(active&&(active.accepts?.(event)??true))active.record(event,{...(typeof activeDocument==='undefined'?{}:{visibility:activeDocument.visibilityState}),...(typeof navigator==='undefined'?{}:{online:navigator.onLine}),...fields},level);}catch{/* Logging must never break the observed operation. */}}
export function logFailure(event:string,error:unknown,fields:Record<string,unknown>={}){if(active)logEvent(event,{...fields,error},'error');}
export class EventJournal {
  private state:DiagnosticState={schema:1,events:[]};
  private sequence=0;private sessionId:string;private dirty=false;private work=Promise.resolve();private closed=false;private bytes=0;private publishAt=0;private publishedDay='';
  private urgent?:Promise<void>;private persistSequence=0;
  storageError='';
  constructor(private io:DiagnosticIO,private policy:DiagnosticPolicy={}){this.sessionId=io.id();}
  accepts(event:string){return !this.closed&&(this.policy.accept?.(event)??true);}
  private size(event:DiagnosticEvent){return new TextEncoder().encode(JSON.stringify(event)).byteLength;}
  private now(){return this.io.now?.()??Date.now();}
  async load(){
    try{const value=await this.io.load() as DiagnosticState|undefined;
      if(value?.schema===1&&Array.isArray(value.events)&&value.events.every(validEvent)){
        // Migrate the old timeline without restoring incidents, attempts or watchdogs.
        this.state={schema:1,events:value.events.slice(-(this.policy.maxEvents??MAX_EVENTS)).filter(event=>this.policy.retain?.(event.event)??true).map(event=>({...event,fields:redact(event.fields) as Record<string,unknown>,deviceId:event.deviceId??String(this.io.context.deviceId)}))};
        this.bytes=this.state.events.reduce((sum,event)=>sum+this.size(event),0);this.trim();this.dirty=true;
      }
    }catch(error){this.storageError=JSON.stringify(redact(error));}
  }
  record(event:string,fields:Record<string,unknown>={},level:LogLevel='info'):DiagnosticEvent {
    const entry:DiagnosticEvent={at:new Date(this.now()).toISOString(),sequence:++this.sequence,sessionId:this.sessionId,deviceId:String(this.io.context.deviceId),event,level,fields:redact({pluginVersion:this.io.context.pluginVersion,monotonicMs:typeof performance==='undefined'?undefined:performance.now(),...fields}) as Record<string,unknown>};
    if(this.accepts(event)){this.state.events.push(entry);this.bytes+=this.size(entry);this.dirty=true;this.trim();if(level==='error'||this.policy.persistOnRecord){this.persistSequence=entry.sequence;this.persistRecords();}}return entry;
  }
  private persistRecords(){
    if(this.urgent)return;
    // Coalesce transition/error bursts without a flush timer or delaying sends.
    // Include records arriving while a local write is in progress.
    const run=(async()=>{let sequence:number;do{sequence=this.persistSequence;await this.flush(true);}while(sequence!==this.persistSequence);})();
    this.urgent=run;void run.catch(()=>{}).finally(()=>{if(this.urgent===run)this.urgent=undefined;});
  }
  private trim(){
    const day=new Date(this.now()).toISOString().slice(0,10);
    const retained=this.state.events.filter(event=>this.policy.retentionMs===undefined?event.at.slice(0,10)===day:this.now()-Date.parse(event.at)<=this.policy.retentionMs);
    if(retained.length!==this.state.events.length){this.state.events=retained;this.bytes=retained.reduce((sum,event)=>sum+this.size(event),0);this.dirty=true;}
    while(this.state.events.length&&(this.state.events.length>(this.policy.maxEvents??MAX_EVENTS)||this.bytes>(this.policy.maxBytes??MAX_BYTES))){this.bytes-=this.size(this.state.events.shift()!);this.dirty=true;}
  }
  async flush(forcePublish=false){
    const run=this.work.catch(()=>{}).then(async()=>{
      this.trim();const today=new Date(this.now()).toISOString().slice(0,10);if(this.publishedDay!==today)this.publishAt=0;const snapshot=jsonClone(this.state);
      try{
        if(this.dirty){this.dirty=false;try{await this.io.save(snapshot);}catch(error){this.dirty=true;throw error;}}
        if(this.io.publish&&(forcePublish||this.now()>=this.publishAt)){await this.io.publish(snapshot.events);this.publishAt=this.now()+30_000;this.publishedDay=today;}
        this.storageError='';
      }catch(error){this.publishAt=0;this.storageError=JSON.stringify(redact(error));throw error;}
    });this.work=run;return run;
  }
  async tick(){if(!this.closed)await this.flush();}
  snapshot(since?:string):DiagnosticExport {this.trim();return {exportedAt:new Date(this.now()).toISOString(),context:redact(this.io.context),schema:1,events:this.state.events.filter(event=>!since||Date.parse(event.at)>=Date.parse(since)).map(event=>({...event,fields:redact(event.fields) as Record<string,unknown>})),storageError:this.storageError};}
  export(){return JSON.stringify(this.snapshot(),null,2);}
  async exportSynced(){
    await this.flush(true);const events=new Map<string,DiagnosticEvent>();
    for(const event of [...await this.io.readSynced?.()??[],...this.state.events])events.set(`${event.deviceId}:${event.sessionId}:${event.sequence}`,event);
    return JSON.stringify({exportedAt:new Date(this.now()).toISOString(),context:redact(this.io.context),schema:1,events:[...events.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.sequence-b.sequence).slice(-MAX_EVENTS),storageError:this.storageError},null,2);
  }
  async close(){this.closed=true;await this.flush(true);}
}
export function validEvent(event:unknown):event is DiagnosticEvent{return Boolean(isRecord(event)&&typeof event.at==='string'&&Number.isFinite(Date.parse(event.at))&&typeof event.sessionId==='string'&&Number.isInteger(event.sequence)&&typeof event.event==='string'&&typeof event.level==='string'&&['info','warning','error'].includes(event.level)&&event.fields&&typeof event.fields==='object');}
