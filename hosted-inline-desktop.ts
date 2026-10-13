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
import {DesktopInlineReadCache,inlineFileVersion} from './inline-file-cache-desktop';
import {markdownCodeCacheStatus} from './reply-html';
import {ensurePrivateStorage,existingPrivateStorage} from './private-storage-desktop';
import {sameWorkspacePath} from './folder-link';
import {InlineResponseFeeds} from './inline-response-feed';
import {nativeResponses} from './native-response-manager';

export {localInlineFiles} from './inline-host-storage-desktop';
import {localInlineFiles,inlineHostReadCache as inlineReadCache} from './inline-host-storage-desktop';

export class DesktopInlineHost {
  private writer:HostedInlineWriter;
  private coordinated!:CoordinatedHost;
  private nativeWriter!:HostedInlineWriter;
  private writerIO!:import('./hosted-inline').HostedWriterIO;
  private authority:InlineLeaseAuthority;
  private stopAuthorityReads:()=>void;
  private authorityStorage:ReturnType<typeof interruptibleAuthorityFiles>;
  status(){return {active:this.active,authority:this.authority.status(),storage:this.authorityStorage.status(),readCache:inlineReadCache.status(),codeRangeCache:markdownCodeCacheStatus(),projectionCache:this.coordinated?.projectionStatus(),leaseCache:this.coordinated?.leaseCacheStatus(),nativeResponseCache:nativeResponses(this.app).retentionStatus(),journal:this.coordinated?.journalStatus()};}
  private stopAuthorityTimer:()=>void;
  private stopMaintenanceTimer:()=>void=()=>{};
  private work=new Set<Promise<void>>();
  private stopped=false;
  private closing?:Promise<void>;
  get active(){return !this.stopped;}
  private accessCache:ThreadAccessCache;
  private responseFeeds:InlineResponseFeeds;
  private closeStorage:()=>Promise<void>;
  private constructor(private release:()=>Promise<void>,private app:App,private identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},files:ReturnType<typeof localInlineFiles>,access:(environmentId:string,reason?:ThreadAccessCloseReason)=>Promise<ThreadAccess>){
    this.accessCache=new ThreadAccessCache(access);
    this.responseFeeds=new InlineResponseFeeds(environmentId=>this.accessCache.get(environmentId));
    this.closeStorage=()=>files.close?.()??Promise.resolve();
    const storage=this.authorityStorage=interruptibleAuthorityFiles(files);
    this.stopAuthorityReads=()=>storage.stop();
    this.authority=new InlineLeaseAuthority(identity,storage.files);
    this.stopAuthorityTimer=desktopInterval(()=>void this.authority.tick().catch(()=>{}),100);
    this.writerIO={
      ...files,
      requests:async()=>{
        const paths=await files.requests();
        return this.coordinated?this.coordinated.legacyRequests(paths):paths;
      },
      locateNote:deviceNoteIO(app).locateNote,
      replayBindings:(request,access,signal,afterSequence)=>readInlineEvents(access,request.threadId,afterSequence,signal),
      access:environmentId=>this.accessCache.get(environmentId),
      threadState:(request,access,refresh,failure)=>this.responseFeeds.state(request,access,refresh,failure),
      readFailure:request=>this.responseFeeds.failure(request),
      adoptFinalResponse:(request,state,turnId,key)=>this.responseFeeds.adopt(request,state,turnId,key),
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
  async responseCommand(kind:string,id:string,hash?:string,notePath?:string,importPage?:import('./response-command').ImportRecordsCommand){return this.coordinated.command(kind,id,hash,notePath,importPage);}
  dispatch(command:import('./inline-lease').LeaseCommand){return this.authority.dispatch(command);}
  eventContent(path:string,content:string){return this.coordinated.eventContent(path,content);}
  responseBindings(target:import('./event-subscriptions').EventTarget){return this.coordinated.responseBindings(target);}
  matchesTarget(target:import('./hosted-inline').InlineHostTarget){return this.identity.environmentId===target.environmentId&&this.identity.directory===target.directory&&sameWorkspacePath(this.identity.workspaceRoot,target.workspaceRoot);}
  static async open(app:App,identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},access:(environmentId:string,reason?:ThreadAccessCloseReason)=>Promise<ThreadAccess>){
    logEvent('ownership.coordinator.opening',identity);
    try{
    const configDir=identity.directory.slice(0,identity.directory.indexOf('/t3-code/'));
    const route=await ensurePrivateStorage(identity.workspaceRoot,configDir);
    const base=join(route.storageRoot,identity.directory);await fs.mkdir(base,{recursive:true});
    let host:DesktopInlineHost|undefined;
    const release=await lockfile.lock(base,{realpath:true,stale:30_000,update:5000,onCompromised:error=>{logFailure('ownership.coordinator.lock-lost',error,identity);host?.dispose();}});
    host=new DesktopInlineHost(release,app,identity,localInlineFiles(identity.workspaceRoot,identity.directory),access);
    try{host.coordinated=await CoordinatedHost.open(app,identity,localInlineFiles(identity.workspaceRoot,identity.directory),host.authority);host.nativeWriter=new HostedInlineWriter(identity,host.coordinated.io(host.writerIO));await localInlineFiles(identity.workspaceRoot,identity.directory).write(`${identity.directory}/coordinated-capabilities.json`,JSON.stringify({version:1,nativeProjection:true,responseContainers:1,deviceCompletion:1,stopReceipts:1}));host.stopMaintenanceTimer=desktopInterval(()=>{if(host&&!host.stopped){const work=Promise.all([host.coordinated.maintain(),host.authority.cleanupReplies()]).then(()=>{});host.work.add(work);void work.finally(()=>host!.work.delete(work)).catch(error=>logFailure('storage.maintenance.failed',error));}},500);}catch(error){host.dispose();throw error;}
    logEvent('ownership.coordinator.opened',identity);return host;
    }catch(error){logFailure('ownership.coordinator.open.failed',error,identity);throw error;}
  }
  tick(){
    if(this.stopped)return Promise.resolve();
    this.responseFeeds.prune();
    // Discovery and each response already coalesce their own work. Holding
    // the entire scan here would prevent later ticks from serving healthy
    // responses or expiring network requests while one note is stalled.
    const work=this.coordinated.scan(true).then(()=>Promise.all([this.writer.tick(),this.nativeWriter.tick()])).then(()=>{});
    this.work.add(work);void work.finally(()=>this.work.delete(work)).catch(()=>{});return work;
  }
  renamed(before:string,after:string){this.writer.renamed(before,after);this.nativeWriter?.renamed(before,after);this.authority.renamed(before,after);if(this.coordinated){const work=this.coordinated.renamed(before,after);this.work.add(work);void work.finally(()=>this.work.delete(work)).catch(()=>{});}}
  deleted(path:string){this.authority.deleted(path);}
  dispose(){
    if(this.closing)return this.closing;
    this.stopped=true;this.responseFeeds.stop();this.stopAuthorityTimer();this.stopMaintenanceTimer();const journals=this.coordinated?.stop();this.authority.stop();this.stopAuthorityReads();this.writer.stop();this.nativeWriter?.stop();
    this.closing=(async()=>{
      try{
        await Promise.allSettled([...this.work,journals,this.authority.tick(),this.authority.cleanupReplies()]);
        await this.accessCache.dispose();
        await this.closeStorage();
      }finally{await this.release();}
    })();
    void this.closing.catch(()=>{});return this.closing;
  }
}
