import {sha256} from '@noble/hashes/sha256';
import type {Project} from './bridge';

export interface ProjectSource {
  /** Includes the exact connection, environment and endpoint (or local config). */
  key:string;
  enabled:boolean;
  read:()=>Promise<Project[]>;
}
export interface ProjectSnapshot {key:string;projects:Project[];fingerprint:string}
export type ProjectAvailability='checking'|'available'|'offline'|'unverified';
interface SourceState {source:ProjectSource;failures:number;nextAttempt:number;availability:ProjectAvailability;error?:string}
export function projectFingerprint(projects:Project[]):string {
  // This suppresses unchanged writes/notifications, not network reads.
  return Array.from(sha256(JSON.stringify([...projects].sort((a,b)=>a.id.localeCompare(b.id)).map(p=>[p.id,p.title,p.workspaceRoot,p.connectionId??'',p.connectionName??''])))).map(v=>v.toString(16).padStart(2,'0')).join('');
}

/** Device-local catalog and bounded, coalesced discovery. No sending or routing. */
export class ProjectDiscovery {
  private snapshots=new Map<string,ProjectSnapshot>();
  private sources=new Map<string,SourceState>();
  private running?:Promise<void>;
  private generation=0;
  private stopped=false;
  private saving=Promise.resolve();
  constructor(private persist:(snapshots:ProjectSnapshot[])=>Promise<void>,private changed:()=>void,private now=()=>Date.now(),private concurrency=3){}
  restore(saved:ProjectSnapshot[]){
    for(const snapshot of saved)if(snapshot&&typeof snapshot.key==='string'&&Array.isArray(snapshot.projects)){
      const projects=snapshot.projects.filter(p=>p&&typeof p.id==='string'&&typeof p.title==='string'&&typeof p.workspaceRoot==='string');
      this.snapshots.set(snapshot.key,{key:snapshot.key,projects,fingerprint:projectFingerprint(projects)});
    }
  }
  setSources(sources:ProjectSource[]){
    const keys=new Set(sources.map(s=>s.key));let changed=false;
    for(const [key] of this.sources)if(!keys.has(key)){this.sources.delete(key);}
    for(const [key] of this.snapshots)if(!keys.has(key)){this.snapshots.delete(key);changed=true;}
    for(const source of sources){
      const old=this.sources.get(source.key);
      if(old&&old.source.enabled===source.enabled)old.source=source;
      else this.sources.set(source.key,{source,failures:0,nextAttempt:0,availability:'unverified'});
    }
    if(changed){this.changed();void this.save().catch(()=>{});}
  }
  all(){return [...this.snapshots.values()].flatMap(s=>s.projects);}
  status(key:string){return this.sources.get(key)?.availability??'unverified';}
  error(key:string){return this.sources.get(key)?.error;}
  replace(key:string,projects:Project[]){
    const fingerprint=projectFingerprint(projects);
    if(this.snapshots.get(key)?.fingerprint===fingerprint)return false;
    this.snapshots.set(key,{key,projects:projects.map(p=>({...p})),fingerprint});this.changed();return true;
  }
  save(){
    const snapshot=[...this.snapshots.values()].map(s=>({...s,projects:s.projects.map(p=>({...p}))}));
    this.saving=this.saving.catch(()=>{}).then(()=>this.persist(snapshot));return this.saving;
  }
  due(){return [...this.sources.values()].some(s=>s.source.enabled&&s.nextAttempt<=this.now());}
  refresh(force=false):Promise<void>{
    if(this.stopped)return Promise.resolve();
    if(this.running)return this.running;
    const generation=this.generation;
    const queue=[...this.sources.values()].filter(s=>s.source.enabled&&(force||s.nextAttempt<=this.now()));
    const valid=(state:SourceState)=>!this.stopped&&generation===this.generation&&this.sources.get(state.source.key)===state;
    const worker=async()=>{for(;;){const state=queue.shift();if(!state)return;if(!valid(state))continue;
      const previous=state.availability;state.availability='checking';
      let received=false;
      try{
        const projects=await state.source.read();if(!valid(state))continue;
        received=true;state.failures=0;state.nextAttempt=this.now()+300_000;state.availability='available';state.error=undefined;const changed=this.replace(state.source.key,projects);
        if(changed)await this.save();else if(previous!=='available')this.changed();
      }catch(error){if(!valid(state))continue;
        if(received){state.error='Cannot save the local project cache.';this.changed();continue;}
        state.failures++;state.nextAttempt=this.now()+Math.min(300_000,15_000*2**Math.min(state.failures-1,5));state.availability='offline';state.error=error instanceof Error?error.message:String(error);if(previous!=='offline')this.changed();
      }
    }};
    const work=Promise.all(Array.from({length:Math.min(this.concurrency,queue.length)},worker)).then(()=>{});
    this.running=work;return work.finally(()=>{if(this.running===work)this.running=undefined;});
  }
  invalidate(){this.generation++;this.running=undefined;for(const state of this.sources.values()){state.nextAttempt=0;state.availability='unverified';}}
  dispose(){this.invalidate();this.stopped=true;}
}
