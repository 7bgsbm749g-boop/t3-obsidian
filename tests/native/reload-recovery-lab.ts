import {Plugin,MarkdownView,TFile} from 'obsidian';
import {LocalResponseManager} from '../../src/responses/local-response-manager';
import {responseAnchor} from '../../src/responses/native-response-projection';
import {noteIndicators} from '../../src/responses/explorer-responses';
import {activityLeafPath,decorateActivityTabs} from '../../src/ui/activity-titles';
import {installActivityShine} from '../../src/ui/activity-shine';
import {installFolderIndicators,type FolderIndicatorController} from '../../src/projects/folder-indicator';
import {contentHash} from '../../src/responses/completion';
import type {ResponseRequest} from '../../src/responses/response-model';
import type {DirectInlineUpdate} from '../../src/responses/direct-inline-preview';

const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const fixturePaths=['Working.md','Completed.md','Reference.md','Virtual.md'];

/** Real Obsidian reload and deferred Markdown tab, production response manager
 * and explorer decorators. T3 lifecycle input is synthetic; no provider work,
 * production settings, Sync or mobile coverage is claimed. */
export default class ReloadRecoveryLab extends Plugin {
  private root='';private manager?:LocalResponseManager;private indicators?:FolderIndicatorController;
  private stopShine?:()=>void;
  private instance=randomUUID();private receive?:((update:DirectInlineUpdate)=>void);
  private reads:string[]=[];private watches=0;private writes=0;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    this.app.workspace.onLayoutReady(()=>void this.run().catch(async error=>{this.write('ERROR.json',{message:String(error),stack:error.stack});await this.cleanup();}));
  }
  private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private async capture(name:string){const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root,name),image.toPNG());}
  private opened(){return this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file&&typeof view.getViewData==='function').map(view=>({path:view.file!.path,document:view.getViewData()}));}
  private async until(predicate:()=>boolean,label:string){const deadline=Date.now()+8000;while(!predicate()){if(Date.now()>deadline)throw Error('Timed out: '+label);await pause(40);}}
  private async run(){
    const statePath=path.join(this.root,'RELOAD.json'),afterReload=fs.existsSync(statePath);
    if(!afterReload){
      await this.app.vault.create('Working.md','# Working note\n\n');await this.app.vault.create('Completed.md','# Completed note\n\nAlready saved final answer.\n');
      const request:ResponseRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id:randomUUID(),initialOwner:randomUUID(),vaultId:'reload-lab',host:{environmentId:'synthetic',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:'Working.md',threadId:randomUUID(),projectId:randomUUID(),messageId:randomUUID(),threadEnvironmentId:'synthetic',initialHash:contentHash(''),createdAt:new Date().toISOString()};
      const completed={...request,id:randomUUID(),notePath:'Completed.md',messageId:randomUUID()};
      await this.app.vault.modify(this.app.vault.getFileByPath('Working.md')!,'# Working note\n\n'+responseAnchor(request.id)+'\n');
      this.write('BINDINGS.json',[request,completed]);
      const working=this.app.workspace.getLeaf(false);await working.openFile(this.app.vault.getFileByPath('Working.md')!);
      const reference=this.app.workspace.getLeaf('tab');await reference.openFile(this.app.vault.getFileByPath('Reference.md')!);await this.app.workspace.revealLeaf(reference);
    }
    const requests:ResponseRequest[]=JSON.parse(fs.readFileSync(path.join(this.root,'BINDINGS.json'),'utf8')),request=requests[0];
    const before=afterReload?JSON.parse(fs.readFileSync(statePath,'utf8')):undefined;
    const openedAtStart=this.opened().map(note=>note.path),checks:Record<string,boolean>={};
    const isOpen=(notePath:string)=>this.opened().some(note=>note.path===notePath);
    this.manager=new LocalResponseManager('lab','reload-lab',{
      localBindings:()=>requests,openedNotes:()=>this.opened(),isOpen,
      readNote:async notePath=>{this.reads.push(notePath);const file=this.app.vault.getFileByPath(notePath);return file?this.app.vault.read(file):undefined;},
      updateNote:async()=>{throw Error('Recovery must not edit a note.');},access:async()=>{throw Error('This fixture must not connect to T3.');},
    },{
      read:async notePath=>{const file=this.app.vault.getFileByPath(notePath);return file?this.app.vault.read(file):undefined;},
      compareAndSet:async(notePath,expected,after,guard)=>{const file=this.app.vault.getFileByPath(notePath);if(!file||guard?.()===false)return false;let written=false;await this.app.vault.process(file,current=>{if(current!==expected||guard?.()===false)return current;written=true;return after;});this.writes+=Number(written);return written;},
    },()=>Date.now(),(record,_access,receive)=>{
      this.watches++;this.receive=receive;
      return {tick:()=>{},update:()=>{},delivery:()=>{},reconnect:()=>{},suspend:()=>{},dispose:()=>{}} as any;
    });
    const explorer=this.app.workspace.getLeavesOfType('file-explorer')[0];if(explorer){this.app.workspace.leftSplit.expand();await this.app.workspace.revealLeaf(explorer);}
    this.indicators=installFolderIndicators(document.body,()=>[],()=>noteIndicators(this.manager!.responses(),notePath=>this.app.vault.getAbstractFileByPath(notePath) instanceof TFile),undefined,notes=>{
      const tabs:Array<{path?:string;title:HTMLElement|null}>=[];this.app.workspace.iterateAllLeaves(leaf=>tabs.push({path:activityLeafPath(leaf as any),title:(leaf as any).tabHeaderEl?.querySelector('.workspace-tab-header-inner-title')??null}));decorateActivityTabs(tabs,notes);
    });
    this.stopShine=installActivityShine(document);
    this.registerInterval(window.setInterval(()=>{this.manager?.tick();this.indicators?.refresh();},150));
    this.manager.resume();await (this.manager as any).recoveryWork;this.indicators.refresh();await pause(400);
    const title=()=>document.querySelector('.nav-file-title[data-path="Working.md"] .nav-file-title-content');
    await this.until(()=>title()?.getAttribute('data-t3-active-title')==='true','Working file indicator');
    if(!afterReload){
      await this.capture('01-before-reload.png');
      const reload=(this.app as any).commands.commands['app:reload'];if(!reload||!/reload/i.test(reload.name))throw Error('The native reload command is unavailable.');
      this.write('RELOAD.json',{instanceId:this.instance,openedAtStart,commandId:'app:reload',commandName:reload.name,activeResponses:this.manager.responses().length});
      await pause(1500);(this.app as any).commands.executeCommandById('app:reload');return;
    }
    try{
      checks.freshNativeInstance=before.instanceId!==this.instance;
      checks.workingNoteDeferred=!openedAtStart.includes('Working.md');
      checks.referenceRemainsActive=this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path==='Reference.md';
      checks.workingRestoredBeforeOpening=this.manager.responses().some(response=>response.id===request.id&&response.active);
      checks.oneWatchForValidAnchor=this.watches===1;
      checks.historicalRecordSkipped=!this.manager.has(requests[1].id);
      checks.indicatorRestored=title()?.getAttribute('data-t3-active-title')==='true';
      checks.circleRestored=title()?.getAttribute('data-t3-circle')==='true';
      checks.noRecoveryWrites=this.writes===0;
      const initialReads=this.reads.length;await pause(1000);checks.unchangedTicksDoNotReadAgain=this.reads.length===initialReads;
      await this.capture('02-after-reload-unopened.png');
      this.receive!({request,messageId:request.messageId,sequence:5,body:'Verified synthetic final answer',turnId:'synthetic-turn',phase:'complete',completionVerified:true});
      this.indicators.refresh();await pause(250);
      checks.completionClearsWorking=title()?.hasAttribute('data-t3-active-title')===false;
      checks.completionClearsCircle=title()?.hasAttribute('data-t3-circle')===false;
      checks.closedFinalWriteDeferred=this.writes===0&&this.manager.responses()[0].complete;
      await this.capture('03-completed-while-unopened.png');
      checks.testCompleted=true;
    }finally{
      await this.cleanup();checks.temporaryNotesDeleted=fixturePaths.every(notePath=>this.app.vault.getAbstractFileByPath(notePath)===null);
      this.write('RESULT.json',{pass:checks.testCompleted===true&&Object.values(checks).every(Boolean),scope:'Real desktop Obsidian app:reload and deferred note recovery; synthetic T3 lifecycle. No Sync, actual provider delivery or native mobile coverage.',checks,beforeInstance:before.instanceId,afterInstance:this.instance,openedAtStart,readPaths:this.reads,watches:this.watches,finalWrites:this.writes,testThreads:[],testNotes:fixturePaths,cleanupVerified:checks.temporaryNotesDeleted});
    }
  }
  private async cleanup(){this.manager?.dispose();this.indicators?.dispose();this.stopShine?.();for(const leaf of this.app.workspace.getLeavesOfType('markdown'))if(fixturePaths.includes((leaf.view as MarkdownView).file?.path??''))leaf.detach();for(const notePath of fixturePaths){const file=this.app.vault.getAbstractFileByPath(notePath);if(file)await this.app.vault.delete(file);}}
  onunload(){this.manager?.dispose();this.indicators?.dispose();this.stopShine?.();}
}
