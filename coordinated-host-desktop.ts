import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import type {App} from 'obsidian';
import {contentHash} from './completion';
import {GeneratedNoteCoordinator} from './generated-note-coordinator';
import {DesktopGenerationJournal} from './generation-journal-desktop';
import {nativeResponses} from './native-response-manager';
import {deviceNoteIO} from './inline-note-io';
import {planNativeMigration} from './coordinated-migration';
import {projectResponses,responseAnchor,responseRegion,savedProjection} from './native-response-projection';
import {regionBody,initialRegion} from './inline-thread';
import {hostedPaths,type HostedInlineRequest,type HostedInlineState,type HostedWriterIO} from './hosted-inline';
import {leasePaths,terminalLease,type InlineLeaseAuthority,type LeaseRecord,type LeaseIdentity,type LeaseFiles} from './inline-lease';

/** Host lock is owned by DesktopInlineHost. Mailbox mutations, migration fences
 * and checkpoints share that authority's serialization. Journal bytes live
 * outside the vault and are never transported through Markdown or Sync. */
export class CoordinatedHost {
  private records=new Map<string,LeaseRecord>();
  private stopped=false;
  private scanning?:Promise<void>;
  private constructor(private app:App,private identity:LeaseIdentity,private files:LeaseFiles,private authority:InlineLeaseAuthority,readonly journal:DesktopGenerationJournal,readonly coordinator:GeneratedNoteCoordinator){}
  static async open(app:App,identity:LeaseIdentity,files:LeaseFiles,authority:InlineLeaseAuthority,options?:{journalRoot?:string}){
    const roots=[identity.workspaceRoot];
    try{const registry=JSON.parse(await fs.readFile(join(homedir(),'.config/obsidian/obsidian.json'),'utf8'));for(const vault of Object.values(registry.vaults??{}) as any[])if(vault.path)roots.push(vault.path);}catch{}
    const journal=await DesktopGenerationJournal.open(options?.journalRoot??join(homedir(),'backups/send-to-t3-code/coordinated-journals',contentHash(identity.workspaceRoot+identity.vaultId)),roots);
    let host:CoordinatedHost;
    const coordinator=new GeneratedNoteCoordinator(journal,{
      read:async path=>{const file=app.vault.getFileByPath(path);return file?app.vault.read(file):undefined;},
      compareAndSet:async(path,before,after)=>host.checkedSave(path,before,after),
    });
    host=new CoordinatedHost(app,identity,files,authority,journal,coordinator);return host;
  }
  private async checkedSave(path:string,before:string,after:string){
    const file=this.app.vault.getFileByPath(path);if(!file||this.stopped)return false;
    const manager=nativeResponses(this.app);
    const same=()=>manager.savedViews(path).every(view=>view.saved()===before);
    if(!same()||await this.app.vault.read(file)!==before)return false;
    const ids=[...this.records.values()].filter(record=>(record.state?.notePath??record.request.notePath)===path&&responseRegion(before,record.request.id)&&!responseRegion(after,record.request.id)).map(record=>record.request.id);
    manager.prepare(path,before,after,ids);
    try{
      await this.app.vault.process(file,current=>{
        if(this.stopped||file.path!==path||this.app.vault.getFileByPath(path)!==file||current!==before||!same())throw Error('A note view or saved version changed before commit.');
        return after;
      });
      const disk=await this.app.vault.read(file);
      if(disk!==after)return false;
      manager.committed(path,disk,ids);return true;
    }finally{manager.cancel(path);}
  }
  scan(){const work=this.scanning??=this.scanRecords();void work.finally(()=>{if(this.scanning===work)this.scanning=undefined;}).catch(()=>{});return work;}
  private async scanRecords(){
    for(const path of await this.files.list(`${this.identity.directory}/leases`)){
      if(this.stopped)return;
      const raw=await this.files.read(path);if(!raw)continue;
      let record:LeaseRecord=JSON.parse(raw),id=record.request.id,notePath=record.state?.notePath??record.request.notePath;
      this.records.set(id,record);
      if(terminalLease(record)||record.state?.finalSaved){
        if(record.coordinated){
          await nativeResponses(this.app).receive(record);
          const journal=await this.journal.read(id);
          if(journal){if(journal.notePath!==notePath)await this.coordinator.renamed(id,journal.notePath,notePath);await this.coordinator.observe(id);
            for(const actor of record.state?.delivery?.observedBy??[])await this.coordinator.acknowledge(id,actor,record.state!.delivery!.commitId,journal.verified!.document).catch(()=>{});
          }
        }
        continue;
      }
      if(!record.coordinated||record.migrating){
        const file=this.app.vault.getFileByPath(notePath);if(!file)continue;
        const saved=await this.app.vault.read(file),region=responseRegion(saved,id);
        if(!region)continue;
        const already=saved.slice(region.from,region.to)===responseAnchor(id);
        const plan=already?undefined:planNativeMigration(record,saved);
        if(!already&&plan?.kind!=='planned')continue;
        // No raw move: disagreeing or dirty native views delay migration.
        if(!nativeResponses(this.app).savedViews(notePath).every(view=>view.saved()===saved))continue;
        record=(await this.authority.fence(id))!;this.records.set(id,record);
        // Existing clients may still hold a cached, previously granted TTL.
        // Reject renewals now and wait out that grant before stripping bytes.
        if((record.legacyFenceUntil??0)>Date.now())continue;
        const anchored=already?saved:(plan as Extract<ReturnType<typeof planNativeMigration>,{kind:'planned'}>).after;
        // Persist the original migration bytes before stripping. Exclusive
        // create makes a crash/retry preserve the first competing version.
        const evidence=join(this.journal.root,id);await fs.mkdir(evidence,{recursive:true,mode:0o700});
        await fs.writeFile(join(evidence,'migration-original.md'),saved,{flag:'wx',mode:0o600}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});
        const old=await this.journal.read(id);if(!old)await this.coordinator.accept(record.request,anchored);
        if(anchored!==saved&&!await this.checkedSave(notePath,saved,anchored))continue;
        record=await this.authority.migrated(id);this.records.set(id,record);
      }
      const journal=await this.journal.read(id);
      if(journal&&journal.notePath!==notePath)await this.coordinator.renamed(id,journal.notePath,notePath);
      await nativeResponses(this.app).receive(record);
    }
  }
  io(base:HostedWriterIO):HostedWriterIO {
    return {...base,
      requests:async()=>[...this.records.values()].filter(record=>record.coordinated&&!record.migrating).map(record=>hostedPaths(this.identity.directory,record.request.id).request),
      accepts:request=>!!this.records.get(request.id)?.coordinated&&!this.records.get(request.id)?.migrating&&!this.stopped,
      canResume:()=>true,
      locateNote:(id,path)=>deviceNoteIO(this.app).locateNote(id,path),
      read:async path=>{
        const id=/\/([^/]+)\.json$/.exec(path)?.[1],record=id?this.records.get(id):undefined;
        if(record&&path===hostedPaths(this.identity.directory,id!).state)return record.state?JSON.stringify(record.state):undefined;
        if(record&&path===hostedPaths(this.identity.directory,id!).stop)return record.stopRequestedAt?'{}':undefined;
        return base.read(path);
      },
      write:async(path,value)=>{
        const id=/\/([^/]+)\.json$/.exec(path)?.[1];if(!id||path!==hostedPaths(this.identity.directory,id).state)return base.write(path,value);
        const state:HostedInlineState=JSON.parse(value),record=await this.authority.checkpoint(id,state);this.records.set(id,record);
        await this.coordinator.checkpoint(id,record.revision,record.state!);await nativeResponses(this.app).receive(record);
      },
      updateNote:async(path,change)=>{
        const saved=await deviceNoteIO(this.app).readNote(path);if(saved===undefined)return;
        const responses=[...this.records.values()].filter(record=>record.coordinated&&!record.migrating&&!record.state?.cleanupComplete&&(record.state?.notePath??record.request.notePath)===path).map(record=>({id:record.request.id,body:record.state?.body??regionBody(initialRegion(record.request.id,record.request.initialInput,record.request.threadTitle,record.request.intermediateMode,{startedAt:record.request.createdAt}).text,record.request.id)!.body}));
        const projection=projectResponses(saved,responses),next=change(projection.display);
        // Ordinary selection consumption follows the normal checked save path;
        // generated response body changes are only local/journaled.
        const ordinary=savedProjection(next,projection);
        if(ordinary!==saved){await deviceNoteIO(this.app).updateNote(path,()=>ordinary,()=>!this.stopped);}
        return next;
      },
      commitFinal:async(request,state,body)=>{
        const journal=await this.journal.read(request.id);if(!journal)throw Error('Missing durable generation original.');
        if(journal.staged===undefined)await this.coordinator.result(request.id,journal.stagedDraft??journal.original,body);
        const result=await this.coordinator.commit(request.id);
        if(result.status==='conflict'){state.detail=result.conflicts.at(-1)?.reason;return false;}
        if(result.status!=='verified'||!result.verified)return false;
        state.finalDocumentHash=result.verified.hash;
        state.delivery={commitId:result.verified.commitId,hash:result.verified.hash,verifiedOnHost:true,observedBy:[]};
        state.responseAnchor=result.verified.responseAnchor;return true;
      },
    };
  }
  async command(kind:string,id:string,hash?:string){
    if(kind==='resume-response'){
      const raw=await this.files.read(leasePaths(this.identity.directory,id).record);if(!raw)throw Error('Unknown response binding.');
      const lease:LeaseRecord=JSON.parse(raw),notePath=lease.state?.notePath??lease.request.notePath;
      const saved=await deviceNoteIO(this.app).readNote(notePath);
      if(saved===undefined||!responseRegion(saved,id))throw Error('Response boundaries or native views disagree. Restore the exact boundaries and save first.');
      const resumed=await this.authority.resume(id);this.records.set(id,resumed);await this.scan();return {resumed:true,bindingId:id};
    }
    const record=await this.journal.read(id);if(!record)throw Error('Unknown coordinated response.');
    if(kind==='response-status')return {generation:record,stagingPath:join(this.journal.root,id,'staged.md')};
    if(kind==='stage-note-edit'){
      const path=join(this.journal.root,id,'staged.md');await fs.writeFile(path,record.original,{flag:'wx',mode:0o600}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});return {stagingPath:path,originalHash:record.originalHash};
    }
    if(kind==='submit-note-edit'){
      const path=join(this.journal.root,id,'staged.md'),stat=await fs.lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid staged file.');
      await this.coordinator.stage(id,await fs.readFile(path,'utf8'),hash!);return {staged:true};
    }
    if(kind==='repair-response'){const repaired=await this.coordinator.restore(id,hash!);return {generation:repaired};}
    if(kind==='remove-response'){await this.coordinator.remove(id);return {removed:true};}
    throw Error('Unsupported response command.');
  }
  async renamed(before:string,after:string){await this.authority.renameNative(before,after);await this.scan();}
  stop(){this.stopped=true;}
}
