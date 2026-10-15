import {Plugin,MarkdownView} from 'obsidian';
import {DirectInlinePreview} from '../direct-inline-preview';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {contentHash} from '../completion';
import type {ResponseRecord} from '../response-record';
import type {ThreadStreamCallbacks,watchThread} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** Synthetic, unsynced fixture only. Production verification uses the normal
 * plugin command bridge and a real T3 delivery separately. */
export default class DirectInlineLab extends Plugin {
  private root='';private preview?:DirectInlinePreview;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated native fixture vault is required.');
    this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document));
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((transaction:any)=>nativeResponses(this.app).filter(transaction)));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('error.json',{message:String(error),stack:error.stack})));
  }
  private write(name:string,data:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
  private async capture(name:string){const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root,name),image.toPNG());}
  async run(){
    await pause(800);const app=this.app,manager=nativeResponses(app),id=crypto.randomUUID(),startedAt=new Date().toISOString();
    const saved='# Direct stream fixture\n\nOrdinary text before.\n\n'+responseAnchor(id)+'\n\nOrdinary text after.\n';
    const file=await app.vault.create('Direct.md',saved),first=app.workspace.getLeaf(false);await first.openFile(file);
    const second=app.workspace.createLeafBySplit(first,'vertical');await second.openFile(file);
    const leaves=[first,second],views=leaves.map(leaf=>leaf.view as MarkdownView);
    const record:ResponseRecord={coordinated:true,migrating:true,owner:'host',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:4,nativeProjection:true,id,initialOwner:crypto.randomUUID(),vaultId:crypto.randomUUID(),host:{environmentId:'fixture',workspaceRoot:'/unavailable-host',directory:'.obsidian/inline'},notePath:file.path,threadId:'fixture-thread',messageId:'fixture-prompt',projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:contentHash(''),createdAt:startedAt,intermediateMode:'keep',threadTitle:'Direct stream'}};
    let callbacks!:ThreadStreamCallbacks;
    const watch:typeof watchThread=(_id,_access,next)=>{callbacks=next;return {stop:()=>{}};};
    this.preview=new DirectInlinePreview(record,async()=>{throw Error('The delayed fixture host has no network or note');},update=>manager.stream(update),watch);
    await manager.receive(record);this.preview.tick(true);
    const rows:any[]=[],body='Text arrived directly before host migration.',message={id:'answer',role:'assistant',text:body,turnId:'fixture-turn',streaming:true};
    const snapshot={snapshotSequence:2,thread:{id:'fixture-thread',projectId:'fixture-project',title:'Direct stream',messages:[{id:'fixture-prompt',role:'user',text:'Synthetic prompt',turnId:'fixture-turn',streaming:false},message],activities:[],latestTurn:{turnId:'fixture-turn',messageId:'fixture-prompt',state:'running'},session:{status:'running',activeTurnId:'fixture-turn'}}};
    for(const mode of ['live','reading','source'] as const){
      for(const leaf of leaves)await leaf.setViewState({type:'markdown',state:{file:file.path,mode:mode==='reading'?'preview':'source',source:mode==='source'}});
      callbacks.item({kind:'snapshot',snapshot});await pause(600);
      await manager.receive({...record,revision:++record.revision,state:{requestHash:'fixture',accepted:false,notePath:file.path,status:'waiting',hashes:[],updatedAt:'',body:'Delayed old host body'}});
      const visible=views.map(view=>manager.view(view)?.currentProjection().display??'');
      rows.push({mode,hostMigrating:record.migrating,hostAccepted:false,visible:visible.every(text=>text.includes(body)),savedProjectionClean:views.every(view=>view.getViewData()===saved),diskClean:await app.vault.read(file)===saved,hostDidNotRegress:visible.every(text=>!text.includes('Delayed old host body'))});
      await this.capture('direct-'+mode+'.png');
    }
    const final=saved.replace(responseAnchor(id),'> '+body),completed:ResponseRecord={...record,revision:++record.revision,migrating:false,state:{requestHash:'fixture',accepted:true,notePath:file.path,status:'complete',hashes:[],updatedAt:'',body:'> '+body,finalBody:'> '+body,cleanupComplete:true,finalSaved:true,delivery:{commitId:crypto.randomUUID(),hash:contentHash(final),verifiedOnHost:true,observedBy:[]}}};
    this.preview.update(completed);this.preview.tick(true);await manager.receive(completed);await pause(500);
    rows.push({mode:'delayed-final',visible:views.every(view=>manager.view(view)?.currentProjection().display.includes(body)),diskClean:await app.vault.read(file)===saved});
    await app.vault.modify(file,final);await manager.changed(file.path);await pause(500);
    rows.push({mode:'saved-adoption',adopted:views.every(view=>view.getViewData()===final&&!manager.view(view)?.conflictRecord())});
    this.write('RESULT.json',{rows,pass:rows.every(row=>Object.entries(row).filter(([key])=>!['mode','hostAccepted'].includes(key)).every(([,value])=>value===true))});await this.capture('direct-final.png');
  }
  onunload(){this.preview?.dispose();nativeResponses(this.app).dispose();}
}
