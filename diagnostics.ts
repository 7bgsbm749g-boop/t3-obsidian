export type LogLevel='info'|'warning'|'error';
export interface DiagnosticEvent {at:string;sequence:number;sessionId:string;deviceId:string;event:string;level:LogLevel;fields:Record<string,unknown>}
export interface DiagnosticState {schema:1;events:DiagnosticEvent[]}
export interface DiagnosticIO {load():Promise<unknown>;save(state:DiagnosticState):Promise<void>;publish?(events:DiagnosticEvent[]):Promise<void>;readSynced?():Promise<DiagnosticEvent[]>;now?:()=>number;id:()=>string;context:Record<string,unknown>}
const MAX_EVENTS=10_000,MAX_BYTES=8_000_000;
const sensitive=/^(prompt|text|content|body|before|after|selection|attachments|context|credentials?|password|secret|token|authorization|cookie|session|ticket|code|url|connection|account|key|draft)$/i;
export function redact(value:unknown,depth=0):unknown {
  if(depth>5)return '[bounded]';
  if(value instanceof Error)return {name:value.name,message:clean(value.message),stack:clean(value.stack??'').slice(0,2500)};
  if(typeof value==='string')return clean(value).slice(0,1500);
  if(value===null||typeof value==='number'||typeof value==='boolean')return value;
  if(Array.isArray(value))return value.slice(0,30).map(item=>redact(item,depth+1));
  if(value&&typeof value==='object'){const out:Record<string,unknown>={};for(const [key,item] of Object.entries(value).slice(0,40))out[key]=sensitive.test(key)||/token|secret|password|credential|ticket|cookie|authorization|privatekey/i.test(key)?'[redacted]':redact(item,depth+1);return out;}
  return undefined;
}
function clean(value:string){return value.replace(/(?:https?|wss?):\/\/[^\s)"']+/g,'[address]').replace(/\bBearer\s+\S+/gi,'Bearer [redacted]').replace(/\b(token|secret|password|ticket|code|authorization)\s*[=:]\s*[^\s,;]+/gi,'$1=[redacted]');}
let active:EventJournal|undefined;
export function configureDiagnostics(journal?:EventJournal){active=journal;}
export function logEvent(event:string,fields:Record<string,unknown>={},level:LogLevel='info'){try{active?.record(event,fields,level);}catch{/* Logging must never break the observed operation. */}}
export function logFailure(event:string,error:unknown,fields:Record<string,unknown>={}){logEvent(event,{...fields,error},'error');}
export class EventJournal {
  private state:DiagnosticState={schema:1,events:[]};
  private sequence=0;private sessionId:string;private dirty=false;private work=Promise.resolve();private closed=false;private bytes=0;private publishAt=0;private publishedDay='';
  private urgent?:Promise<void>;private errorSequence=0;
  storageError='';
  constructor(private io:DiagnosticIO){this.sessionId=io.id();}
  private now(){return this.io.now?.()??Date.now();}
  async load(){
    try{const value=await this.io.load() as DiagnosticState|undefined;
      if(value?.schema===1&&Array.isArray(value.events)&&value.events.every(validEvent)){
        // Migrate the old timeline without restoring incidents, attempts or watchdogs.
        this.state={schema:1,events:value.events.slice(-MAX_EVENTS).map(event=>({...event,deviceId:event.deviceId??String(this.io.context.deviceId)}))};
        this.bytes=this.state.events.reduce((sum,event)=>sum+JSON.stringify(event).length,0);this.trim();this.dirty=true;
      }
    }catch(error){this.storageError=JSON.stringify(redact(error));}
  }
  record(event:string,fields:Record<string,unknown>={},level:LogLevel='info'):DiagnosticEvent {
    const entry:DiagnosticEvent={at:new Date(this.now()).toISOString(),sequence:++this.sequence,sessionId:this.sessionId,deviceId:String(this.io.context.deviceId),event,level,fields:redact(fields) as Record<string,unknown>};
    if(!this.closed){this.state.events.push(entry);this.bytes+=JSON.stringify(entry).length;this.dirty=true;this.trim();if(level==='error'){this.errorSequence=entry.sequence;this.persistErrors();}}return entry;
  }
  private persistErrors(){
    if(this.urgent)return;
    // Save locally before publishing, without delaying or changing the send.
    // Coalesce an error burst, but include errors arriving during a write.
    const run=(async()=>{let sequence:number;do{sequence=this.errorSequence;await this.flush(true);}while(sequence!==this.errorSequence);})();
    this.urgent=run;void run.catch(()=>{}).finally(()=>{if(this.urgent===run)this.urgent=undefined;});
  }
  private trim(){
    const day=new Date(this.now()).toISOString().slice(0,10);
    const retained=this.state.events.filter(event=>event.at.slice(0,10)===day);
    if(retained.length!==this.state.events.length){this.state.events=retained;this.bytes=retained.reduce((sum,event)=>sum+JSON.stringify(event).length,0);this.dirty=true;}
    while(this.state.events.length&&(this.state.events.length>MAX_EVENTS||this.bytes>MAX_BYTES)){this.bytes-=JSON.stringify(this.state.events.shift()).length;this.dirty=true;}
  }
  async flush(forcePublish=false){
    const run=this.work.catch(()=>{}).then(async()=>{
      this.trim();const today=new Date(this.now()).toISOString().slice(0,10);if(this.publishedDay!==today)this.publishAt=0;const snapshot=JSON.parse(JSON.stringify(this.state));
      try{
        if(this.dirty){this.dirty=false;try{await this.io.save(snapshot);}catch(error){this.dirty=true;throw error;}}
        if(this.io.publish&&(forcePublish||this.now()>=this.publishAt)){await this.io.publish(snapshot.events);this.publishAt=this.now()+30_000;this.publishedDay=today;}
        this.storageError='';
      }catch(error){this.publishAt=0;this.storageError=JSON.stringify(redact(error));throw error;}
    });this.work=run;return run;
  }
  async tick(){if(!this.closed)await this.flush();}
  export(){this.trim();return JSON.stringify({exportedAt:new Date(this.now()).toISOString(),context:redact(this.io.context),...this.state,storageError:this.storageError},null,2);}
  async exportSynced(){
    await this.flush(true);const events=new Map<string,DiagnosticEvent>();
    for(const event of [...await this.io.readSynced?.()??[],...this.state.events])events.set(`${event.deviceId}:${event.sessionId}:${event.sequence}`,event);
    return JSON.stringify({exportedAt:new Date(this.now()).toISOString(),context:redact(this.io.context),schema:1,events:[...events.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.sequence-b.sequence).slice(-MAX_EVENTS),storageError:this.storageError},null,2);
  }
  async close(){this.closed=true;await this.flush(true);}
}
export function validEvent(event:any):event is DiagnosticEvent{return Boolean(event&&typeof event.at==='string'&&Number.isFinite(Date.parse(event.at))&&typeof event.sessionId==='string'&&Number.isInteger(event.sequence)&&typeof event.event==='string'&&['info','warning','error'].includes(event.level)&&event.fields&&typeof event.fields==='object');}
