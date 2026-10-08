import {Plugin,MarkdownView} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {DeviceInlineManager} from '../leased-inline';
import {DeviceResponseCompletion,deviceCompletionStore} from '../device-response-completion';
import {deviceFinalNoteIO} from '../inline-note-io';
import {InlineLeaseAuthority,leasePaths,type LeaseFiles,type LeaseRecord} from '../inline-lease';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {responseAnchor} from '../native-response-projection';
import {contentHash} from '../completion';
import {hostedRequestHash} from '../hosted-inline';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** Synthetic real-Sync lab only: no production credentials or T3 dispatch. */
export default class DeviceCompletionSyncLab extends Plugin {
  private config:any;private manager?:DeviceInlineManager;private stopped=false;
  private write(name:string,value:any){fs.writeFileSync(path.join(this.config.evidence,this.config.role+'-'+name+'.json'),JSON.stringify(value,null,2));}
  private read(name:string){const file=path.join(this.config.evidence,name+'.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):undefined;}
  private async capture(name:string){const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.config.evidence,this.config.role+'-'+name+'.png'),image.toPNG());}
  async onload(){
    this.config=JSON.parse(fs.readFileSync(path.join((this.app.vault.adapter as any).getFullPath(''),'.obsidian/plugins/device-completion-sync-lab/config.json'),'utf8'));
    const expected='/home/ubuntu/vaults/Sync Test '+this.config.role.toUpperCase();
    if(path.resolve((this.app.vault.adapter as any).getFullPath(''))!==expected||!fs.existsSync(path.join(this.config.evidence,'SYNTHETIC-SYNC-LAB')))throw Error('A dedicated synthetic Sync vault is required.');
    this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document));
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((transaction:any)=>nativeResponses(this.app).filter(transaction)));
    this.registerEvent(this.app.workspace.on('layout-change',()=>nativeResponses(this.app).refresh()));
    this.registerEvent(this.app.vault.on('modify',file=>{void nativeResponses(this.app).changed(file.path);}));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR',{error:String(error),stack:error.stack})));
  }
  async run(){
    const c=this.config,app=this.app,native=nativeResponses(app),note=c.note,request=c.request;
    if(c.role==='a'&&!app.vault.getAbstractFileByPath(note))await app.vault.create(note,c.original);
    let file:any;
    for(let n=0;n<300&&!this.stopped;n++){file=app.vault.getAbstractFileByPath(note);if(file)break;await pause(200);}
    if(!file)throw Error('The synthetic initial note did not propagate.');
    const leaf=app.workspace.getLeaf(false);await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:note,mode:'source',source:false}});
    const view=leaf.view as MarkdownView;
    for(let n=0;n<100&&view.getViewData()!==c.original;n++)await pause(50);
    if(view.getViewData()!==c.original){this.write('initial-mismatch',{disk:await app.vault.read(file),savedProjection:view.getViewData(),editor:view.editor.getValue(),expected:c.original});throw Error('The native initial editor has not adopted the synthetic original.');}
    let initial:LeaseRecord={request,coordinated:true,migrating:false,owner:'00000000-0000-5000-8000-000000000001',epoch:1,revision:0,expiresAt:Number.MAX_SAFE_INTEGER};
    if(c.role==='b'){
      const data=new Map<string,string>(),identity={...request.host,vaultId:request.vaultId};
      data.set(identity.directory+'/coordinated-capabilities.json',JSON.stringify({deviceCompletion:1}));
      const hostFiles:LeaseFiles={read:async p=>data.get(p),write:async(p,v)=>{data.set(p,v);},remove:async p=>{data.delete(p);},list:async directory=>[...data.keys()].filter(p=>p.startsWith(directory+'/'))};
      const authority=new InlineLeaseAuthority(identity,hostFiles),storage=deviceCompletionStore(c.actor,request.vaultId);
      const files={...hostFiles,read:async(p:string)=>{if(p.includes('/replies/'))await authority.tick();return hostFiles.read(p);}};
      const completion=new DeviceResponseCompletion(c.actor,storage.store,deviceFinalNoteIO(app,()=>!this.stopped),(p,proof)=>native.deviceCommitted(p,proof));
      this.manager=new DeviceInlineManager(request.initialOwner,request.vaultId,{completionActor:c.actor,isOpen:p=>p===note,readNote:async()=>view.getViewData(),readSaved:async()=>app.vault.read(file),updateNote:async()=>{throw Error('A legacy writer must not run');},access:async()=>{throw Error('The fixture has no T3 connection');},receiveCoordinated:(r,proof)=>native.receive(r,proof),completeResponse:(r,original,staged,prepare)=>completion.complete(r,original,staged,prepare),completionFailed:error=>this.write('ERROR',{error:String(error),stack:(error as Error).stack})},async()=>({files,close:()=>{}}),()=>Date.now(),()=>performance.now(),async()=>{await authority.tick();});
      await this.manager.register(request);initial=await authority.migrated(request.id);
      fs.writeFileSync(path.join(c.evidence,'initial.json'),JSON.stringify(initial));
      await native.receive(initial);native.stream({request:initial.request,messageId:request.messageId,sequence:1,body:'> Synthetic live reply.\n',phase:'running'});
      this.write('ready',{path:note,disk:await app.vault.read(file),savedProjection:view.getViewData(),visible:native.view(view)?.currentProjection().display});await this.capture('ready');
      for(let n=0;n<900&&!this.stopped;n++){if(this.read('finish'))break;await pause(200);}
      if(this.stopped||!this.read('finish'))return;
      const current=native.view(view)!.currentProjection().display,index=current.indexOf('Ordinary tail');
      if(index<0)throw Error('Cannot locate synthetic ordinary text.');
      const start=view.editor.offsetToPos(index),end=view.editor.offsetToPos(index+'Ordinary tail'.length);view.editor.replaceRange('Local ordinary edit',start,end);
      const started=performance.now(),turnId='synthetic-turn';
      await authority.checkpoint(request.id,{requestHash:hostedRequestHash(initial.request),accepted:true,notePath:note,status:'complete',hashes:[],updatedAt:'',turnId,turnIds:[turnId],directFinalBody:c.body,finalPhase:'complete',bindingCheckpoint:{sequence:25,bindings:{[request.messageId]:{turnId,kind:'explicit'}},turns:{[turnId]:{turnId,messageId:request.messageId,state:'completed'}}}});
      await this.manager.register(request);
      let record:LeaseRecord=initial;
      for(let n=0;n<300&&!this.stopped;n++){this.manager.tick();record=JSON.parse(data.get(leasePaths(identity.directory,request.id).record)!);if(record.state?.cleanupComplete)break;await pause(50);}
      if(!record.state?.cleanupComplete)throw Error('Local completion did not finish.');
      const saved=await app.vault.read(file),proof=await storage.store.read(request.id),materialization=nativeCommit(proof);
      await completion.acknowledged(record);
      const retired=await storage.store.retired!(request.id);
      if(!retired||await storage.store.read(request.id)||retired.receipt.hash!==record.state.delivery?.hash||!retired.proof)throw Error('Acknowledged completion recovery was not retired safely.');
      fs.writeFileSync(path.join(c.evidence,'retired.json'),JSON.stringify({fullJournalAbsent:true,receipt:retired.receipt,proofHash:contentHash(JSON.stringify(retired.proof))}));
      fs.writeFileSync(path.join(c.evidence,'completed.json'),JSON.stringify({record,proof:materialization,saved}));
      this.write('completed',{elapsedMs:performance.now()-started,saved,savedProjection:view.getViewData(),visible:native.view(view)?.currentProjection().display,verifiedOnHost:record.state.delivery?.verifiedOnHost,actor:record.finalWriter?.actor,diskHash:contentHash(saved),deliveryHash:record.state.delivery?.hash});await this.capture('completed');
      for(const mode of ['reading','source'] as const){await leaf.setViewState({type:'markdown',state:{file:note,mode:mode==='reading'?'preview':'source',source:mode==='source'}});native.refresh();await pause(200);this.write(mode,{savedProjection:view.getViewData(),saved:await app.vault.read(file)});await this.capture(mode);}
      return;
    }
    for(let n=0;n<300&&!this.stopped;n++){const received=this.read('initial');if(received){initial=received;break;}await pause(200);}
    await native.receive(initial);native.stream({request:initial.request,messageId:request.messageId,sequence:1,body:'> Synthetic live reply.\n',phase:'running'});
    this.write('ready',{path:note,savedProjection:view.getViewData(),disk:await app.vault.read(file)});await this.capture('ready');
    let loaded=false;
    for(let n=0;n<900&&!this.stopped;n++){
      const completed=this.read('completed');
      if(completed&&!loaded){await native.receive(completed.record,JSON.stringify(completed.proof));loaded=true;this.write('waiting-for-sync',{disk:await app.vault.read(file),savedProjection:view.getViewData(),visible:native.view(view)?.currentProjection().display});await this.capture('waiting-for-sync');}
      if(loaded&&await app.vault.read(file)===completed.saved){await native.changed(note);await pause(250);const adopted=view.getViewData()===completed.saved&&!native.view(view)?.conflictRecord();this.write('adopted',{adopted,saved:await app.vault.read(file),savedProjection:view.getViewData(),visible:native.view(view)?.currentProjection().display,withoutReload:true});await this.capture('adopted');if(adopted)return;}
      await pause(200);
    }
    throw Error('The receiving open editor did not adopt the synced completion.');
  }
  onunload(){this.stopped=true;this.manager?.dispose();nativeResponses(this.app).dispose();}
}
function nativeCommit(record:any){
  if(!record?.verified||!record.attempt)throw Error('Missing local immutable materialization.');
  // Keep the production coordinator's exact generated range calculation.
  const {GeneratedNoteCoordinator}=require('../generated-note-coordinator');
  return new GeneratedNoteCoordinator({},{}).materialization(record);
}
