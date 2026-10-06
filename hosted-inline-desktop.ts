// Desktop-only host storage. Hidden configuration files are reached directly
// through T3's authenticated file API, not transported by Obsidian Sync.
import {promises as fs} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import lockfile from 'proper-lockfile';
import {CoordinatedHost} from './coordinated-host-desktop';
import {desktopInterval} from './desktop-timers';
import {interruptibleAuthorityFiles} from './authority-storage-desktop';
import type {App} from 'obsidian';
import {logEvent,logFailure} from './diagnostics';
import {InlineLeaseAuthority,type LeaseFiles} from './inline-lease';
import {projectReplyReference as resolveReplyReference} from './project-reference';
import {deviceNoteIO} from './inline-note-io';

import {HostedInlineWriter,type HostedInlineRequest,type InlineFiles} from './hosted-inline';
import {readInlineEvents,type ThreadAccess,type ThreadAccessCloseReason} from './thread-stream';
import {ThreadAccessCache} from './thread-access-cache';

export function localInlineFiles(root:string,directory:string):LeaseFiles&{requests():Promise<string[]>}{
  const base=resolve(root,directory);
  const full=(path:string)=>{
    if(!path.startsWith(directory+'/')||path.includes('\\')||path.split('/').some(p=>p==='..'||p==='.'))throw Error('Invalid hosted response storage path.');
    const result=resolve(root,path);if(!result.startsWith(base+require('node:path').sep))throw Error('Invalid hosted response storage path.');return result;
  };
  return {
    async read(path){try{return await fs.readFile(full(path),'utf8');}catch(error:any){if(error.code==='ENOENT')return undefined;throw error;}},
    async write(path,contents){const target=full(path);await fs.mkdir(dirname(target),{recursive:true});const temporary=target+'.'+require('node:crypto').randomUUID()+'.tmp';try{await fs.writeFile(temporary,contents,{mode:0o600});await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}},
    async remove(path){await fs.rm(full(path),{force:true});},
    async list(directoryPath){try{return (await fs.readdir(full(directoryPath))).filter(p=>p.endsWith('.json')).map(p=>`${directoryPath}/${p}`);}catch(error:any){if(error.code==='ENOENT')return [];throw error;}},
    async requests(){try{return (await fs.readdir(join(base,'requests'))).filter(p=>p.endsWith('.json')).map(p=>`${directory}/requests/${p}`);}catch(error:any){if(error.code==='ENOENT')return [];throw error;}},
  };
}

export class DesktopInlineHost {
  private writer:HostedInlineWriter;
  private coordinated!:CoordinatedHost;
  private nativeWriter!:HostedInlineWriter;
  private writerIO!:import('./hosted-inline').HostedWriterIO;
  private authority:InlineLeaseAuthority;
  private stopAuthorityReads:()=>void;
  private authorityStorage:ReturnType<typeof interruptibleAuthorityFiles>;
  status(){return {active:this.active,authority:this.authority.status(),storage:this.authorityStorage.status()};}
  private stopAuthorityTimer:()=>void;
  private work=new Set<Promise<void>>();
  private stopped=false;
  private closing?:Promise<void>;
  get active(){return !this.stopped;}
  private accessCache:ThreadAccessCache;
  private constructor(private release:()=>Promise<void>,app:App,identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},files:ReturnType<typeof localInlineFiles>,access:(environmentId:string,reason?:ThreadAccessCloseReason)=>Promise<ThreadAccess>){
    this.accessCache=new ThreadAccessCache(access);
    const storage=this.authorityStorage=interruptibleAuthorityFiles(files);
    this.stopAuthorityReads=()=>storage.stop();
    this.authority=new InlineLeaseAuthority(identity,storage.files);
    this.stopAuthorityTimer=desktopInterval(()=>void this.authority.tick().catch(()=>{}),100);
    this.writerIO={
      ...files,
      locateNote:deviceNoteIO(app).locateNote,
      replayBindings:(request,access,signal,afterSequence)=>readInlineEvents(access,request.threadId,afterSequence,signal),
      access:environmentId=>this.accessCache.get(environmentId),
      resolveReplyReference:(reference,request,threadAccess)=>resolveReplyReference(app,reference,request,threadAccess),
      updateNote:async(path,change)=>{
        const file=app.vault.getFileByPath(path);if(!file)return undefined;
        const current=await app.vault.read(file);
        const saved=(value:string)=>app.workspace.getLeavesOfType('markdown').every(leaf=>{const view=leaf.view as any;return view.file?.path!==path||!view.editor||view.editor.getValue()===value;});
        if(this.stopped||file.path!==path||app.vault.getFileByPath(path)!==file||!saved(current))return undefined;
        const next=change(current);
        // Probes and unchanged progress must not touch mtime or wake Sync.
        if(next===current)return current;
        return app.vault.process(file,value=>{
          if(this.stopped||file.path!==path||app.vault.getFileByPath(path)!==file||value!==current||!saved(value))throw Error('The note changed during the host update; retrying.');
          return next;
        });
      },
    };
    this.writer=new HostedInlineWriter(identity,this.writerIO);
  }
  async responseCommand(kind:string,id:string,hash?:string,notePath?:string){return this.coordinated.command(kind,id,hash,notePath);}
  eventContent(path:string,content:string){return this.coordinated.eventContent(path,content);}
  static async open(app:App,identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},access:(environmentId:string,reason?:ThreadAccessCloseReason)=>Promise<ThreadAccess>){
    logEvent('ownership.coordinator.opening',identity);
    try{
    const base=join(identity.workspaceRoot,identity.directory);await fs.mkdir(base,{recursive:true});
    let host:DesktopInlineHost|undefined;
    const release=await lockfile.lock(base,{realpath:true,stale:30_000,update:5000,onCompromised:error=>{logFailure('ownership.coordinator.lock-lost',error,identity);host?.dispose();}});
    host=new DesktopInlineHost(release,app,identity,localInlineFiles(identity.workspaceRoot,identity.directory),access);
    try{host.coordinated=await CoordinatedHost.open(app,identity,localInlineFiles(identity.workspaceRoot,identity.directory),host.authority);host.nativeWriter=new HostedInlineWriter(identity,host.coordinated.io(host.writerIO));await localInlineFiles(identity.workspaceRoot,identity.directory).write(`${identity.directory}/coordinated-capabilities.json`,JSON.stringify({version:1,nativeProjection:true}));}catch(error){host.dispose();throw error;}
    logEvent('ownership.coordinator.opened',identity);return host;
    }catch(error){logFailure('ownership.coordinator.open.failed',error,identity);throw error;}
  }
  tick(){
    if(this.stopped)return Promise.resolve();
    // Discovery and each response already coalesce their own work. Holding
    // the entire scan here would prevent later ticks from serving healthy
    // responses or expiring network requests while one note is stalled.
    const work=this.coordinated.scan().then(()=>Promise.all([this.writer.tick(),this.nativeWriter.tick()])).then(()=>{});
    this.work.add(work);void work.finally(()=>this.work.delete(work)).catch(()=>{});return work;
  }
  renamed(before:string,after:string){this.writer.renamed(before,after);this.nativeWriter?.renamed(before,after);this.authority.renamed(before,after);if(this.coordinated){const work=this.coordinated.renamed(before,after);this.work.add(work);void work.finally(()=>this.work.delete(work)).catch(()=>{});}}
  deleted(path:string){this.authority.deleted(path);}
  dispose(){
    if(this.closing)return this.closing;
    this.stopped=true;this.stopAuthorityTimer();this.coordinated?.stop();this.authority.stop();this.stopAuthorityReads();this.writer.stop();this.nativeWriter?.stop();
    this.closing=(async()=>{
      try{
        await Promise.allSettled([...this.work,this.authority.tick()]);
        await this.accessCache.dispose();
      }finally{await this.release();}
    })();
    void this.closing.catch(()=>{});return this.closing;
  }
}
