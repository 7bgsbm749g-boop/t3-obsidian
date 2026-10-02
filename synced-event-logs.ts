import {redact,validEvent,type DiagnosticEvent} from './diagnostics';
/** Root configuration JSON is included in Sync's core-plugin-data category. */
export const EVENT_LOG_PATH='.obsidian/t3-code-log.json';
export const EVENT_LOG_FOLDER='T3 Code Logs'; // Retired location, migration only.
export function isLogPath(path:string){return path===EVENT_LOG_PATH||path===EVENT_LOG_FOLDER||path.startsWith(EVENT_LOG_FOLDER+'/');}
export function logDay(now:number){return new Date(now).toISOString().slice(0,10);}
export function currentDayEvents(events:DiagnosticEvent[],now:number){const day=logDay(now);return events.filter(event=>event.at.slice(0,10)===day);}
interface Files {exists(path:string):Promise<boolean>;mkdir(path:string):Promise<void>;read(path:string):Promise<string>;write(path:string,data:string):Promise<void>;remove(path:string):Promise<void>;list?(path:string):Promise<{files:string[];folders:string[]}>;rmdir?(path:string,recursive:boolean):Promise<void>}
/** Every device contributes its current-day buffer to the shared Sync file.
 * Republishing restores local entries after a concurrent Sync replacement. */
export class SyncedEventLogs {
  private work=Promise.resolve();
  readonly path:string;
  constructor(private files:Files,private deviceId:string,private paths:()=>string[],private now=()=>Date.now(),configDir='.obsidian'){this.path=`${configDir}/t3-code-log.json`;}
  private parse(text:string,legacy=false):DiagnosticEvent[]{
    try{const raw=legacy?/^# T3 Code plugin event log\n[\s\S]*```json\n([\s\S]*)\n```\n?$/.exec(text)?.[1]:text;if(!raw)return [];
      const value=JSON.parse(raw);if(value.schema!==1||!Array.isArray(value.events))throw Error('Invalid plugin event log');
      if(!value.events.every((event:any)=>validEvent(event)&&typeof event.deviceId==='string'))throw Error('Invalid plugin event log entries');
      return value.events.map((event:DiagnosticEvent)=>({...event,fields:redact(event.fields) as Record<string,unknown>}));
    }catch(error){if(legacy)return [];throw error;}
  }
  async read(){return await this.files.exists(this.path)?currentDayEvents(this.parse(await this.files.read(this.path)),this.now()):[];}
  publish(events:DiagnosticEvent[]){
    const run=this.work.catch(()=>{}).then(()=>this.publishNow(events));this.work=run;return run;
  }
  private async publishNow(events:DiagnosticEvent[]){
    const now=this.now(),existing=await this.files.exists(this.path)?await this.files.read(this.path):undefined;
    const merged=new Map<string,DiagnosticEvent>();
    const add=(entries:DiagnosticEvent[])=>{for(const event of currentDayEvents(entries,now))merged.set(`${event.deviceId}:${event.sessionId}:${event.sequence}`,event);};
    if(existing!==undefined)add(this.parse(existing));
    const retired:string[]=[];
    for(const path of this.paths().filter(path=>path.startsWith(EVENT_LOG_FOLDER+'/')&&path.endsWith('.md'))){
      if(!await this.files.exists(path))continue;const raw=await this.files.read(path);
      if(!raw.startsWith('# T3 Code plugin event log\n'))continue;
      const entries=this.parse(raw,true);if(!entries.length)continue;add(entries);retired.push(path);
    }
    add(events.filter(event=>event.deviceId===this.deviceId));
    const selected=[...merged.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.deviceId.localeCompare(b.deviceId)||a.sessionId.localeCompare(b.sessionId)||a.sequence-b.sequence).slice(-10_000);
    let bytes=selected.reduce((sum,event)=>sum+JSON.stringify(event).length,0);
    while(selected.length&&bytes>8_000_000)bytes-=JSON.stringify(selected.shift()).length;
    const data=JSON.stringify({schema:1,day:logDay(now),events:selected},null,2)+'\n';
    const folder=this.path.slice(0,this.path.lastIndexOf('/'));if(!await this.files.exists(folder)){try{await this.files.mkdir(folder);}catch(error){if(!await this.files.exists(folder))throw error;}}
    if(existing!==data)await this.files.write(this.path,data);
    // Retire generated Markdown only after the replacement is durably written.
    for(const path of retired)if(await this.files.exists(path))await this.files.remove(path);
    if(this.files.list&&this.files.rmdir&&await this.files.exists(EVENT_LOG_FOLDER))await this.removeEmptyLogFolders(EVENT_LOG_FOLDER);
  }
  private async removeEmptyLogFolders(path:string){
    const entries=await this.files.list!(path);
    for(const folder of entries.folders)await this.removeEmptyLogFolders(folder);
    const remaining=await this.files.list!(path);
    if(!remaining.files.length&&!remaining.folders.length)await this.files.rmdir!(path,true);
  }
}
