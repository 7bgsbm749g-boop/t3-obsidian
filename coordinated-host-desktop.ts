import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import type {App} from 'obsidian';
import {contentHash} from './completion';
import {generatedEventContent} from './generated-event-content';
import {GeneratedNoteCoordinator,validateFinalResponseBody,type NoteGeneration} from './generated-note-coordinator';
import {nativeCommitPath} from './native-response-commit';
import {DesktopGenerationJournal} from './generation-journal-desktop';
import {nativeResponses} from './native-response-manager';
import {deviceNoteIO} from './inline-note-io';
import {planNativeMigration} from './coordinated-migration';
import {restoreResponseAnchor} from './response-anchor-recovery';
import {projectResponses,responseAnchor,responseRegion,savedProjection} from './native-response-projection';
import {regionBody,initialRegion,startMarker,endMarker} from './inline-thread';
import {logFailure} from './diagnostics';
import {streamBlock,removeStreamBlock} from './stream-block';
import {hostedPaths,needsHostedProcessing,type HostedInlineRequest,type HostedInlineState,type HostedWriterIO} from './hosted-inline';
import {leasePaths,terminalLease,type InlineLeaseAuthority,type LeaseRecord,type LeaseIdentity,type LeaseFiles} from './inline-lease';

/** Host lock is owned by DesktopInlineHost. Mailbox mutations, migration fences
 * and checkpoints share that authority's serialization. Journal bytes live
 * outside the vault and are never transported through Markdown or Sync. */
export class CoordinatedHost {
  private records=new Map<string,LeaseRecord>();
  private stopped=false;
  private failures=new Map<string,string>();
  private scanning?:Promise<LeaseRecord[]>;
  private work=new Map<string,Promise<void>>();
  private terminalCursor=0;
  private nextTerminalScan=0;
  private backgroundChecks=new Map<string,{epoch:number;revision:number;until:number}>();
  private terminalRevisions=new Map<string,{epoch:number;revision:number}>();
  private terminalDiscoveryComplete=false;
  private async materialization(result:NoteGeneration){
    const proof=this.coordinator.materialization(result),bytes=JSON.stringify(proof);
    const path=nativeCommitPath(this.identity.directory,proof.bindingId,proof.commitId);
    const previous=await this.files.read(path);
    if(previous!==undefined&&previous!==bytes)throw Error('An immutable native commit proof changed.');
    if(previous===undefined)await this.files.write(path,bytes);
    return {bytes,hash:contentHash(bytes)};
  }
  private async publishHistoryRemoval(record:LeaseRecord,result:NoteGeneration){
    if(result.historyRemoval?.status!=='verified'||!record.state?.delivery)return record;
    const proof=result.historyRemoval.proof;
    if(record.state.delivery.commitId===proof.commitId)return record;
    const published=await this.materialization(result);
    const finalBody=removeStreamBlock(result.finalBody!,result.historyRemoval.key,result.historyRemoval.blockHash).text;
    const state={...record.state,body:finalBody,finalBody,finalDocumentHash:proof.hash,delivery:{commitId:proof.commitId,hash:proof.hash,proofHash:published.hash,verifiedOnHost:true,observedBy:[]}};
    const updated=await this.authority.checkpoint(record.request.id,state,{epoch:record.epoch,revision:record.revision});
    this.records.set(record.request.id,updated);await nativeResponses(this.app).receive(updated,published.bytes);return updated;
  }
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
    const ids=[...this.records.values()].filter(record=>record.coordinated&&!record.migrating&&!record.state?.cleanupComplete&&(record.state?.notePath??record.request.notePath)===path&&responseRegion(before,record.request.id)&&!responseRegion(after,record.request.id)).map(record=>record.request.id);
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
  async eventContent(path:string,content:string){
    const leases=[...this.records.values()].filter(record=>(record.state?.notePath??record.request.notePath)===path);
    const records=await Promise.all(leases.map(record=>this.journal.read(record.request.id)));
    return generatedEventContent(content,records.filter((record):record is NonNullable<typeof record>=>!!record),leases.filter(record=>!record.coordinated&&record.state).map(record=>record.state!));
  }
  async scan(background=false){
    // Coalesce discovery, not the lifetime of every response. A native save
    // or journal operation stuck on one note must not gate later arrivals.
    const loading=this.scanning??=this.scanRecords(background);
    void loading.finally(()=>{if(this.scanning===loading)this.scanning=undefined;}).catch(()=>{});
    const records=await loading;
    await Promise.all(records.map(record=>{
      if(this.stopped||this.work.has(record.request.id))return;
      const prior=this.backgroundChecks.get(record.request.id),now=Date.now();
      // The writer still polls active replies every tick. A repeated lease
      // revision does not require another full private-journal audit; changed
      // revisions and explicit recovery commands bypass this maintenance pace.
      if(background&&prior?.epoch===record.epoch&&prior.revision===record.revision&&now<prior.until)return;
      if(background)this.backgroundChecks.set(record.request.id,{epoch:record.epoch,revision:record.revision,until:now+30_000});
      const work=this.scanRecord(record);this.work.set(record.request.id,work);
      return work.finally(()=>{if(this.work.get(record.request.id)===work)this.work.delete(record.request.id);});
    }));
  }
  private async scanRecords(background=false){
    const active:LeaseRecord[]=[],terminal:LeaseRecord[]=[],changedTerminal:LeaseRecord[]=[];
    for(const path of await this.files.list(`${this.identity.directory}/leases`)){
      try{const raw=await this.files.read(path);if(!raw)continue;const record:LeaseRecord=JSON.parse(raw);if(!this.work.has(record.request.id))this.records.set(record.request.id,record);
        if(terminalLease(record)||record.state?.finalSaved){
          const previous=this.terminalRevisions.get(record.request.id);
          if(background&&this.terminalDiscoveryComplete&&(!previous||previous.epoch!==record.epoch||previous.revision!==record.revision))changedTerminal.push(record);
          if(background||!this.terminalDiscoveryComplete)this.terminalRevisions.set(record.request.id,{epoch:record.epoch,revision:record.revision});terminal.push(record);
        }else active.push(record);
      }catch{/* A malformed historical record cannot gate a healthy response. */}
    }
    this.terminalDiscoveryComplete=true;
    // Serve active responses every pass. Completed-history observation is
    // rotating maintenance, so a cold journal audit cannot delay a new run.
    if(this.terminalCursor>=terminal.length)this.terminalCursor=0;
    const now=Date.now();
    const historical=!background||now>=this.nextTerminalScan?terminal.slice(this.terminalCursor,this.terminalCursor+(background?1:4)):[];
    // Unchanged completed history is maintenance, not live reply work. Keep
    // full journal verification but pace it like unchanged active audits.
    // Changed leases above and explicit recovery scans still run immediately.
    if(historical.length){this.terminalCursor+=historical.length;this.nextTerminalScan=now+30_000;}
    const urgent=new Set(changedTerminal.map(record=>record.request.id));
    return active.concat(changedTerminal,historical.filter(record=>!urgent.has(record.request.id)));
  }
  private async scanRecord(record:LeaseRecord){
      if(this.stopped)return;
      const identity=record.request.id;this.failures.delete(identity);
      try{
      const id=record.request.id,notePath=record.state?.notePath??record.request.notePath;
      if(record.relocations?.length){
        const original=await this.journal.read(id);
        for(const move of record.relocations){
          deviceNoteIO(this.app).noteRelocated(id,move.before,move.after,original?.originalHash);
          if(!original||move.before===notePath)continue;
          // A rename intent alone does not prove Sync has delivered the new
          // anchor. Keep the sole surviving registration until it has arrived.
          const destination=this.app.vault.getFileByPath(notePath);
          if(!destination)continue;
          const destinationSaved=await this.app.vault.read(destination);
          const destinationRegion=responseRegion(destinationSaved,id);
          if(!destinationRegion||destinationSaved.slice(destinationRegion.from,destinationRegion.to)!==responseAnchor(id))continue;
          const file=this.app.vault.getFileByPath(move.before);if(!file)continue;
          const saved=await this.app.vault.read(file);
          // A known rename plus the exact former saved snapshot proves this
          // stale registration. Changed text remains an explicit conflict.
          if(saved!==original.original)continue;
          const part=responseRegion(saved,id);if(!part)continue;
          const directory=join(this.journal.root,id,'stale-rename-preimages');await fs.mkdir(directory,{recursive:true,mode:0o700});
          await fs.writeFile(join(directory,contentHash(move.before)+'.md'),saved,{flag:'wx',mode:0o600}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});
          await this.recoverySave(move.before,saved,saved.slice(0,part.from)+saved.slice(part.to),id,true);
          deviceNoteIO(this.app).noteChanged(move.before);
        }
      }
      this.records.set(id,record);
      // A native file notification can fail AFTER vault.process wrote the
      // exact durable intent. Recover by disk readback before marker location,
      // projection, or network work; those anchors have legitimately gone.
      if(record.coordinated&&!record.migrating&&!record.state?.cleanupComplete){
        const pending=await this.journal.read(id);
        if(pending?.attempt&&['commit-pending','verified'].includes(pending.status)){
          const file=this.app.vault.getFileByPath(notePath);
          if(file&&!this.stopped&&await this.app.vault.read(file)===pending.attempt.expected){
            const verified=await this.coordinator.commit(id);
            const phase=record.state?.finalPhase??(record.state?.bindingCheckpoint?.turns?.[record.state.turnId??'']?.state==='completed'?'complete':undefined);
            if(verified.status==='verified'&&verified.verified&&phase&&record.state&&!this.stopped){
              const proof=await this.materialization(verified);
              const state={...record.state,body:verified.finalBody,finalBody:verified.finalBody,finalPhase:phase,finalSaved:true,cleanupComplete:true,status:phase,
                finalDocumentHash:verified.verified.hash,responseAnchor:verified.verified.responseAnchor,
                delivery:{commitId:verified.verified.commitId,hash:verified.verified.hash,verifiedOnHost:true,proofHash:proof.hash,observedBy:record.state.delivery?.commitId===verified.verified.commitId?record.state.delivery.observedBy:[]}};
              delete state.detail;
              record=await this.authority.checkpoint(id,state,{epoch:record.epoch,revision:record.revision});this.records.set(id,record);
            }
          }
        }
      }
      if(terminalLease(record)||record.state?.finalSaved){
        if(record.coordinated){
          let journal=await this.journal.read(id);
          // A proven completed rename can still carry the original empty
          // anchor. Settle its checked recovery before auditing shortened
          // history; otherwise that known preimage becomes a false conflict.
          if(journal?.historyRemoval&&journal.notePath===notePath&&!journal.pendingRename){
            journal=await this.coordinator.observe(id);
            record=await this.publishHistoryRemoval(record,journal);
          }
          if(journal?.status==='verified'&&record.state?.delivery&&!record.state.delivery.proofHash){
            const proof=await this.materialization(journal);
            record=await this.authority.checkpoint(id,{...record.state,delivery:{...record.state.delivery,proofHash:proof.hash}},{epoch:record.epoch,revision:record.revision});this.records.set(id,record);
          }
          await nativeResponses(this.app).receive(record);
          if(journal){
            let current=journal;
            if(current.notePath!==notePath)current=await this.coordinator.renamed(id,current.notePath,notePath);
            if(current.pendingRename&&current.verified&&record.relocations?.some(move=>move.after===notePath)){
              const file=this.app.vault.getFileByPath(notePath),saved=file?await this.app.vault.read(file):undefined;
              // Sync can rename the pre-commit empty anchor after this device
              // already observed the final reply under its original name.
              // The durable native rename plus the exact recorded preimage
              // proves this single repair. Changed text remains a conflict.
              if(saved===undefined)return;
              if(saved===current.original){
                const evidence=join(this.journal.root,id,'completed-rename-preimages');await fs.mkdir(evidence,{recursive:true,mode:0o700});
                await fs.writeFile(join(evidence,contentHash(notePath)+'.md'),saved,{flag:'wx',mode:0o600}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});
                const committed=current.historyRemoval?.status==='verified'?current.historyRemoval.proof.document:current.verified.document;
                await this.recoverySave(notePath,saved,committed,id,true);
              }
              await this.coordinator.settleRename(id);
            }
            const observed=await this.coordinator.observe(id);
            record=await this.publishHistoryRemoval(record,observed);
            for(const actor of record.state?.delivery?.observedBy??[])await this.coordinator.acknowledge(id,actor,record.state!.delivery!.commitId,observed.historyRemoval?.status==='verified'?observed.historyRemoval.proof.document:observed.verified!.document).catch(()=>{});
          }
        }
        return;
      }
      if(!record.coordinated||record.migrating){
        const file=this.app.vault.getFileByPath(notePath);if(!file)return;
        const saved=await this.app.vault.read(file),region=responseRegion(saved,id);
        if(!region)return;
        const already=saved.slice(region.from,region.to)===responseAnchor(id);
        const plan=already?undefined:planNativeMigration(record,saved);
        if(!already&&plan?.kind!=='planned')return;
        // No raw move: disagreeing or dirty native views delay migration.
        if(!nativeResponses(this.app).savedViews(notePath).every(view=>view.saved()===saved))return;
        record=(await this.authority.fence(id))!;this.records.set(id,record);
        // Existing clients may still hold a cached, previously granted TTL.
        // Reject renewals now and wait out that grant before stripping bytes.
        if((record.legacyFenceUntil??0)>Date.now())return;
        const anchored=already?saved:(plan as Extract<ReturnType<typeof planNativeMigration>,{kind:'planned'}>).after;
        // Persist the original migration bytes before stripping. Exclusive
        // create makes a crash/retry preserve the first competing version.
        const evidence=join(this.journal.root,id);await fs.mkdir(evidence,{recursive:true,mode:0o700});
        await fs.writeFile(join(evidence,'migration-original.md'),saved,{flag:'wx',mode:0o600}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});
        const old=await this.journal.read(id);if(!old)await this.coordinator.accept(record.request,anchored);
        if(anchored!==saved&&!await this.checkedSave(notePath,saved,anchored))return;
        record=await this.authority.migrated(id);this.records.set(id,record);
      }
      const journal=await this.journal.read(id);
      if(journal&&journal.notePath!==notePath)await this.coordinator.renamed(id,journal.notePath,notePath);
      await nativeResponses(this.app).receive(record);
      }catch(error){const detail=error instanceof Error?error.message:String(error);this.failures.set(identity,detail);logFailure('response.coordinator.scan-conflict',error,{bindingId:identity});}
  }
  legacyRequests(paths:string[]):string[]{
    // Unknown paths retain the original discovery behavior. A freshly read
    // lease proves which known requests the version-one writer cannot accept.
    return paths.filter(path=>{
      const id=/\/([^/]+)\.json$/.exec(path)?.[1],record=id?this.records.get(id):undefined;
      return !record||path!==hostedPaths(this.identity.directory,record.request.id).request||record.request.version===1;
    });
  }
  io(base:HostedWriterIO):HostedWriterIO {
    const reads=new Map<string,{epoch:number;revision:number}>();
    return {...base,
      requests:async()=>[...this.records.values()].filter(record=>record.coordinated&&!record.migrating&&needsHostedProcessing(record.request,record.state)).map(record=>hostedPaths(this.identity.directory,record.request.id).request),
      accepts:request=>!!this.records.get(request.id)?.coordinated&&!this.records.get(request.id)?.migrating&&!this.failures.has(request.id)&&!this.stopped,
      canResume:()=>true,
      locateNote:(id,path)=>deviceNoteIO(this.app).locateNote(id,path),
      read:async path=>{
        const id=/\/([^/]+)\.json$/.exec(path)?.[1],record=id?this.records.get(id):undefined;
        if(record&&path===hostedPaths(this.identity.directory,id!).state){reads.set(id!,{epoch:record.epoch,revision:record.revision});return record.state?JSON.stringify(record.state):undefined;}
        if(record&&path===hostedPaths(this.identity.directory,id!).stop)return record.stopRequestedAt?'{}':undefined;
        return base.read(path);
      },
      write:async(path,value)=>{
        const id=/\/([^/]+)\.json$/.exec(path)?.[1];if(!id||path!==hostedPaths(this.identity.directory,id).state)return base.write(path,value);
        const state:HostedInlineState=JSON.parse(value),record=await this.authority.checkpoint(id,state,reads.get(id));reads.set(id,{epoch:record.epoch,revision:record.revision});this.records.set(id,record);
        await this.coordinator.checkpoint(id,record.revision,record.state!);await nativeResponses(this.app).receive(record);
      },
      updateNote:async(path,change)=>{
        const saved=await deviceNoteIO(this.app).readNote(path);if(saved===undefined)return;
        // Historical removed/conflicted bindings can outlive their anchors.
        // Only anchors present in this note participate in its projection;
        // malformed present boundaries still fail the normal validation.
        const responses=[...this.records.values()].filter(record=>record.coordinated&&!record.migrating&&!record.state?.cleanupComplete&&(record.state?.notePath??record.request.notePath)===path&&(saved.includes(startMarker(record.request.id))||saved.includes(endMarker(record.request.id)))).map(record=>({id:record.request.id,body:record.state?.body??regionBody(initialRegion(record.request.id,record.request.initialInput,record.request.threadTitle,record.request.intermediateMode,{startedAt:record.request.createdAt}).text,record.request.id)!.body}));
        const projection=projectResponses(saved,responses),next=change(projection.display);
        // Ordinary selection consumption follows the normal checked save path;
        // generated response body changes are only local/journaled.
        const ordinary=savedProjection(next,projection);
        if(ordinary!==saved){await deviceNoteIO(this.app).updateNote(path,()=>ordinary,()=>!this.stopped);}
        return next;
      },
      commitFinal:async(request,state,body)=>{
        validateFinalResponseBody(body);
        const journal=await this.journal.read(request.id);if(!journal)throw Error('Missing durable generation original.');
        if(journal.staged===undefined)await this.coordinator.result(request.id,journal.stagedDraft??journal.original,body);
        const result=await this.coordinator.commit(request.id);
        if(result.status==='conflict'){state.detail=result.conflicts.at(-1)?.reason;return false;}
        if(result.status!=='verified'||!result.verified)return false;
        const proof=await this.materialization(result);
        state.finalDocumentHash=result.verified.hash;
        state.delivery={commitId:result.verified.commitId,hash:result.verified.hash,verifiedOnHost:true,proofHash:proof.hash,observedBy:[]};
        state.responseAnchor=result.verified.responseAnchor;return true;
      },
    };
  }
  private async locations(id:string){
    const locations:Array<{path:string;hash:string;document:string}>=[];
    for(const file of this.app.vault.getMarkdownFiles()){
      const document=await this.app.vault.read(file);
      if(responseRegion(document,id))locations.push({path:file.path,hash:contentHash(document),document});
    }
    locations.sort((a,b)=>a.path.localeCompare(b.path));
    return {locations,locationHash:contentHash(JSON.stringify(locations.map(({path,hash})=>({path,hash}))))};
  }
  private async recoverySave(path:string,before:string,after:string,id:string,detach:boolean){
    const file=this.app.vault.getFileByPath(path);if(!file)throw Error('A reviewed note disappeared.');
    const manager=nativeResponses(this.app),same=()=>manager.savedViews(path).every(view=>view.saved()===before);
    if(!same())throw Error('Save the note before resolving its response destination.');
    if(detach)manager.prepare(path,before,after,[id]);
    try{
      await this.app.vault.process(file,current=>{
        if(this.stopped||file.path!==path||this.app.vault.getFileByPath(path)!==file||current!==before||!same())throw Error('A reviewed note changed during recovery. Review it again.');
        return after;
      });
      if(await this.app.vault.read(file)!==after)throw Error('Recovery write was not saved.');
      if(detach)manager.committed(path,after,[id]);
    }finally{if(detach)manager.cancel(path);}
  }
  async command(kind:string,id:string,hash?:string,notePath?:string){
    if(kind==='close-stream-block'){
      if(!notePath||!hash)throw Error('Choose the exact streaming block and note.');
      const matches=[...this.records.values()].filter(record=>record.coordinated&&(record.state?.notePath??record.request.notePath)===notePath&&record.state?.status==='complete'&&record.state.cleanupComplete&&record.state.finalSaved&&record.state.finalBody&&streamBlock(record.state.finalBody,id));
      // A repeated command can arrive after the lease has already adopted the
      // shortened body. The journal retains the immutable original fold.
      if(!matches.length)for(const record of this.records.values()){
        if(!record.coordinated||(record.state?.notePath??record.request.notePath)!==notePath||record.state?.status!=='complete'||!record.state.cleanupComplete)continue;
        if((await this.journal.read(record.request.id))?.historyRemoval?.key===id)matches.push(record);
      }
      if(matches.length!==1)throw Error('The completed streaming response is unavailable or ambiguous. Wait for delivery and try again.');
      const record=matches[0],result=await this.coordinator.closeHistory(record.request.id,id,hash);
      await this.publishHistoryRemoval(record,result);return {closed:true,bindingId:record.request.id};
    }
    if(kind==='resolve-response-location'){
      const review=await this.locations(id),chosen=review.locations.find(location=>location.path===notePath);
      if(review.locationHash!==hash||!chosen)throw Error('The candidate notes changed. Review the response destination again.');
      const raw=await this.files.read(leasePaths(this.identity.directory,id).record);if(!raw)throw Error('Unknown response binding.');
      const lease:LeaseRecord=JSON.parse(raw);
      if(lease.state?.finalSaved||lease.stopRequestedAt)throw Error('This response is already saved or canceled.');
      const region=responseRegion(chosen.document,id)!;
      const plan=chosen.document.slice(region.from,region.to)===responseAnchor(id)?undefined:planNativeMigration(lease,chosen.document,{reviewedLocationConflict:true});
      if(plan&&plan.kind!=='planned')throw Error(`The selected response cannot be normalized: ${plan.reason} Preserve and review it before recovery.`);
      const evidence=join(this.journal.root,id,`location-recovery-${review.locationHash}`);await fs.mkdir(evidence,{recursive:true,mode:0o700});
      for(const candidate of review.locations)await fs.writeFile(join(evidence,contentHash(candidate.path)+'.md'),candidate.document,{flag:'wx',mode:0o600}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});
      await fs.writeFile(join(evidence,'review.json'),JSON.stringify({notePath,locations:review.locations.map(({path,hash})=>({path,hash}))}),{flag:'wx',mode:0o600}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});
      // Detach only the markers in competing notes. Their ordinary text and
      // retained transcript stay intact, and every exact preimage is backed up.
      for(const candidate of review.locations)if(candidate!==chosen){
        const part=responseRegion(candidate.document,id)!;
        const next=candidate.document.slice(0,part.from)+part.body.replace(/^\n|\n$/g,'')+candidate.document.slice(part.to);
        await this.recoverySave(candidate.path,candidate.document,next,id,true);
      }
      if(plan?.kind==='planned')await this.recoverySave(chosen.path,chosen.document,plan.after,id,false);
      let relocated=await this.authority.relocate(id,lease.state?.notePath??lease.request.notePath,chosen.path);
      if(relocated.state?.locationConflict||['paused','conflict'].includes(relocated.state?.status??''))relocated=await this.authority.resume(id);
      this.records.set(id,relocated);await this.scan();return {resumed:true,bindingId:id,notePath:chosen.path,evidence};
    }
    if(kind==='resume-response'){
      const raw=await this.files.read(leasePaths(this.identity.directory,id).record);if(!raw)throw Error('Unknown response binding.');
      const lease:LeaseRecord=JSON.parse(raw),notePath=lease.state?.notePath??lease.request.notePath;
      const saved=await deviceNoteIO(this.app).readNote(notePath);
      if(saved===undefined||!responseRegion(saved,id))throw Error('Response boundaries or native views disagree. Restore the exact boundaries and save first.');
      const resumed=await this.authority.resume(id);this.records.set(id,resumed);await this.scan();return {resumed:true,bindingId:id};
    }
    const record=await this.journal.read(id);if(!record)throw Error('Unknown coordinated response.');
    if(kind==='response-status'){const review=await this.locations(id);return {generation:record,stagingPath:join(this.journal.root,id,'staged.md'),hostIssue:this.failures.get(id),locationHash:review.locationHash,locations:review.locations.map(({path,hash})=>({path,hash}))};}
    if(kind==='stage-note-edit'){
      const path=join(this.journal.root,id,'staged.md');await fs.writeFile(path,record.original,{flag:'wx',mode:0o600}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});return {stagingPath:path,originalHash:record.originalHash};
    }
    if(kind==='submit-note-edit'){
      const path=join(this.journal.root,id,'staged.md'),stat=await fs.lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid staged file.');
      await this.coordinator.stage(id,await fs.readFile(path,'utf8'),hash!);return {staged:true};
    }
    if(kind==='repair-response'){
      const repairableAnchor=(value:NoteGeneration)=>['accepted','streaming'].includes(value.status)||value.status==='conflict'&&!value.attempt&&!value.verified&&value.finalBody!==undefined;
      if(repairableAnchor(record)){
        const {path,evidence,after,finished}=await this.authority.exclusive(async()=>{
          const raw=await this.files.read(leasePaths(this.identity.directory,id).record);if(!raw)throw Error('Unknown response binding.');
          const lease:LeaseRecord=JSON.parse(raw),path=lease.state?.notePath??lease.request.notePath;
          if(!lease.coordinated||lease.stopRequestedAt||lease.state?.userStopped||lease.state?.finalSaved)throw Error('This response is saved or canceled.');
          const latest=await this.journal.read(id);
          if(!latest||!repairableAnchor(latest))throw Error('The response finished during review. Review its result before recovery.');
          const file=this.app.vault.getFileByPath(path),saved=file?await this.app.vault.read(file):undefined;
          if(saved===undefined||contentHash(saved)!==hash)throw Error('The reviewed note changed. Review it again before recovery.');
          const after=restoreResponseAnchor(id,latest.original,saved);
          const evidence=join(this.journal.root,id,`anchor-recovery-${hash}`);await fs.mkdir(evidence,{recursive:true,mode:0o700});
          for(const [name,bytes] of [['before.md',saved],['after.md',after]])await fs.writeFile(join(evidence,name),bytes,{flag:'wx',mode:0o600}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});
          if(after!==saved)await this.recoverySave(path,saved,after,id,false);
          deviceNoteIO(this.app).noteChanged(path);
          return {path,evidence,after,finished:latest.status==='conflict'};
        });
        if(finished){const generation=await this.coordinator.restore(id,contentHash(after));await this.scan();return {restored:generation.status==='verified',notePath:path,evidence,generation};}
        let restored=await this.authority.relocate(id,path,path);
        if(['paused','conflict'].includes(restored.state?.status??''))restored=await this.authority.resume(id);
        this.records.set(id,restored);await this.scan();return {restored:true,notePath:path,evidence};
      }
      // Pending readback recovery is not an explicit conflict restoration.
      // The caller's reviewed hash and the immutable expected bytes must agree.
      if(record.status==='commit-pending'&&record.attempt){
        const file=this.app.vault.getFileByPath(record.notePath),disk=file?await this.app.vault.read(file):undefined;
        if(disk===undefined||contentHash(disk)!==hash||disk!==record.attempt.expected)throw Error('The pending result is not the exact reviewed saved commit.');
        await this.scan();return {generation:await this.journal.read(id)};
      }
      const repaired=await this.coordinator.restore(id,hash!);await this.scan();return {generation:repaired};
    }
    if(kind==='remove-response'){await this.coordinator.remove(id);return {removed:true};}
    throw Error('Unsupported response command.');
  }
  async renamed(before:string,after:string){await this.authority.renameNative(before,after);await this.scan();}
  stop(){this.stopped=true;this.backgroundChecks.clear();this.terminalRevisions.clear();}
}
