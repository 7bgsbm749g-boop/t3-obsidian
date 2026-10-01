import {redact,validEvent,type DiagnosticEvent} from './diagnostics';
export const EVENT_LOG_FOLDER='T3 Code Logs';
export function isLogPath(path:string){return path===EVENT_LOG_FOLDER||path.startsWith(EVENT_LOG_FOLDER+'/');}
interface Files {exists(path:string):Promise<boolean>;mkdir(path:string):Promise<void>;read(path:string):Promise<string>;write(path:string,data:string):Promise<void>;remove(path:string):Promise<void>}
/** One writer per device/session. Ordinary Markdown participates in Sync without
 * enabling “all other file types”; local IndexedDB remains the offline buffer. */
export class SyncedEventLogs {
  private written=new Map<string,string>();
  constructor(private files:Files,private deviceId:string,private paths:()=>string[],private now=()=>Date.now()){}
  private component(value:string){return encodeURIComponent(value).replace(/\./g,'%2E');}
  async publish(events:DiagnosticEvent[]){
    const groups=new Map<string,DiagnosticEvent[]>();
    for(const event of events){if(event.deviceId!==this.deviceId)continue;const path=`${EVENT_LOG_FOLDER}/${this.component(this.deviceId)}/${this.component(event.sessionId)}.md`;const group=groups.get(path)??[];group.push(event);groups.set(path,group);}
    if(!groups.size)return;
    for(const folder of [EVENT_LOG_FOLDER,`${EVENT_LOG_FOLDER}/${this.component(this.deviceId)}`])if(!await this.files.exists(folder)){try{await this.files.mkdir(folder);}catch(error){if(!await this.files.exists(folder))throw error;}}
    for(const [path,group] of groups){
      const data=`# T3 Code plugin event log\n\nMetadata only. Device: ${this.component(this.deviceId)}. Session: ${this.component(group[0].sessionId)}.\n\n\`\`\`json\n${JSON.stringify({schema:1,events:group},null,2)}\n\`\`\`\n`;
      if(this.written.get(path)===data&&await this.files.exists(path))continue;
      if(!await this.files.exists(path)||await this.files.read(path)!==data)await this.files.write(path,data);
      this.written.set(path,data);
    }
    // Each device expires only its own sessions. Never prune another device's logs.
    const prefix=`${EVENT_LOG_FOLDER}/${this.component(this.deviceId)}/`,cutoff=this.now()-7*24*60*60_000;
    for(const path of this.paths().filter(path=>path.startsWith(prefix)&&path.endsWith('.md')&&!groups.has(path))){
      const old=this.parse(await this.files.read(path));if(old.length&&old.every(event=>event.deviceId===this.deviceId&&Date.parse(event.at)<cutoff))await this.files.remove(path);
    }
  }
  private parse(text:string):DiagnosticEvent[]{
    try{const match=/```json\n([\s\S]*)\n```/.exec(text);if(!match)return [];const value=JSON.parse(match[1]);if(value.schema!==1||!Array.isArray(value.events))return [];
      return value.events.filter((event:any)=>validEvent(event)&&typeof event.deviceId==='string').map((event:DiagnosticEvent)=>({...event,fields:redact(event.fields) as Record<string,unknown>}));
    }catch{return [];}
  }
  async read(){
    const events:DiagnosticEvent[]=[],cutoff=this.now()-7*24*60*60_000;
    for(const path of this.paths().filter(path=>isLogPath(path)&&path.endsWith('.md'))){
      // A Sync deletion during export is benign; other read errors must surface.
      try{events.push(...this.parse(await this.files.read(path)).filter(event=>Date.parse(event.at)>=cutoff));}catch(error){if(await this.files.exists(path))throw error;}
      if(events.length>20_000){events.sort((a,b)=>a.at.localeCompare(b.at));events.splice(0,events.length-10_000);}
    }return events;
  }
}
