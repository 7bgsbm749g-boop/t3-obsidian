// Desktop-only host storage. Hidden configuration files are reached directly
// through T3's authenticated file API, not transported by Obsidian Sync.
import {promises as fs} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import lockfile from 'proper-lockfile';
import {desktopInterval} from './desktop-timers';
import type {App} from 'obsidian';
import {logEvent,logFailure} from './diagnostics';
import {InlineLeaseAuthority,type LeaseFiles} from './inline-lease';
import {importReplyAsset} from './reply-import';
import {deviceNoteIO} from './inline-note-io';
export {importReplyAsset} from './reply-import';
import {HostedInlineWriter,type HostedInlineRequest,type InlineFiles} from './hosted-inline';
import type {ThreadAccess} from './thread-stream';

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
  private authority:InlineLeaseAuthority;
  private stopAuthorityTimer:()=>void;
  private work=new Set<Promise<void>>();
  private opening=new Map<string,Promise<ThreadAccess>>();
  private stopped=false;
  private accesses=new Map<string,{access:ThreadAccess;expires:number}>();
  private constructor(private release:()=>Promise<void>,app:App,identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},files:ReturnType<typeof localInlineFiles>,access:(environmentId:string)=>Promise<ThreadAccess>){
    this.authority=new InlineLeaseAuthority(identity,files);
    this.stopAuthorityTimer=desktopInterval(()=>void this.authority.tick().catch(()=>{}),100);
    this.writer=new HostedInlineWriter(identity,{
      ...files,
      locateNote:deviceNoteIO(app).locateNote,
      access:async environmentId=>{
        const cached=this.accesses.get(environmentId);
        if(cached&&cached.expires>Date.now())return cached.access;
        const pending=this.opening.get(environmentId);if(pending)return pending;
        const work=(async()=>{
          this.accesses.delete(environmentId);await cached?.access.close?.();
          const fresh=await access(environmentId);this.accesses.set(environmentId,{access:fresh,expires:Date.now()+180_000});return fresh;
        })();
        this.opening.set(environmentId,work);
        try{return await work;}finally{this.opening.delete(environmentId);}
      },
      importReplyAsset:(reference,request,threadAccess)=>importReplyAsset(app,reference,request,threadAccess),
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
    });
  }
  static async open(app:App,identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},access:(environmentId:string)=>Promise<ThreadAccess>){
    logEvent('ownership.coordinator.opening',identity);
    try{
    const base=join(identity.workspaceRoot,identity.directory);await fs.mkdir(base,{recursive:true});
    let host:DesktopInlineHost|undefined;
    const release=await lockfile.lock(base,{realpath:true,stale:30_000,update:5000,onCompromised:error=>{logFailure('ownership.coordinator.lock-lost',error,identity);host?.dispose();}});
    host=new DesktopInlineHost(release,app,identity,localInlineFiles(identity.workspaceRoot,identity.directory),access);logEvent('ownership.coordinator.opened',identity);return host;
    }catch(error){logFailure('ownership.coordinator.open.failed',error,identity);throw error;}
  }
  tick(){if(this.stopped)return Promise.resolve();const work=this.writer.tick();this.work.add(work);void work.finally(()=>this.work.delete(work)).catch(()=>{});return work;}
  renamed(before:string,after:string){this.writer.renamed(before,after);}
  dispose(){if(this.stopped)return;this.stopped=true;this.stopAuthorityTimer();this.authority.stop();this.writer.stop();void (async()=>{try{await Promise.allSettled([...this.work,this.authority.tick()]);}catch{}finally{for(const {access} of this.accesses.values())await access.close?.();this.accesses.clear();await this.release();}})().catch(()=>{});}
}
