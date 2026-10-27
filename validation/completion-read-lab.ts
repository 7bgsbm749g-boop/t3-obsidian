import {Plugin,MarkdownView,TFile} from 'obsidian';
import {CompletionGlow} from '../completion-glow';
import {completionSource,noteIndicators,type ExplorerResponse} from '../explorer-responses';
import {installFolderIndicators,type FolderIndicatorController} from '../folder-indicator';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const before='2026-10-20T10:00:00Z',completed='2026-10-20T10:01:00Z',later='2026-10-20T10:02:00Z';

/** Real Obsidian explorer/editor with synthetic T3 metadata. No network,
 * provider delivery, production vault, or native mobile coverage is claimed. */
export default class CompletionReadLab extends Plugin {
  private root='';private glow?:CompletionGlow;private indicators?:FolderIndicatorController;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated fixture vault is required.');
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('error.json',{message:String(error),stack:error.stack})));
  }
  private write(name:string,value:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private async capture(name:string){const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root,name),image.toPNG());}
  private glowing(note:string){return document.querySelector(`.nav-file-title[data-path="${note}"]`)?.getAttribute('data-t3-completion-glow')==='note';}
  async run(){
    await pause(700);
    const folder='Completion Read Lab',note=folder+'/Result.md',mirror=folder+'/Mirror.md',paths=[note,mirror],fixtures=[...paths,'Reference.md','Virtual.md'];
    const checks:Record<string,boolean>={},visits:any[]=[];let saved:unknown;
    try{
      await this.app.vault.createFolder(folder);
      const file=await this.app.vault.create(note,'# Completed reply\n\nSynthetic result for shared read-state verification.\n');
      await this.app.vault.create(mirror,'# Mirrored completed reply\n\nThe same synthetic result.\n');
      const reference=this.app.vault.getFileByPath('Reference.md')!;
      await this.app.workspace.getLeaf(false).openFile(reference);
      const explorer=this.app.workspace.getLeavesOfType('file-explorer')[0];
      if(explorer){this.app.workspace.leftSplit.expand();await this.app.workspace.revealLeaf(explorer);(explorer.view as any).fileItems?.[folder]?.setCollapsed(false);}
      const thread={id:'synthetic-thread',projectId:'synthetic-project',status:'completed',latestRunId:'run',latestRunCompletedAt:completed,lastVisitedAt:before};
      const completion=completionSource({threadEnvironmentId:'synthetic-machine',projectId:thread.projectId,threadId:thread.id},{turnId:'run',state:'completed',completedAt:completed})!;
      let responses:ExplorerResponse[]=paths.map((notePath,index)=>({id:'synthetic-'+index,notePath,epoch:1,revision:1,active:false,input:false,complete:true,completionId:'run',completion:{...completion}}));
      this.glow=new CompletionGlow(undefined,value=>{saved=value;},{changed:()=>this.indicators?.refresh(),access:async()=>({origin:'https://synthetic.invalid',api:async(route,command)=>{
        if(route==='/api/orchestration/shell')return {threads:[{...thread}]};
        if(route!=='/api/orchestration/dispatch'||command.type!=='thread.visit')throw Error('Unexpected synthetic operation.');
        visits.push({...command});if(Date.parse(command.visitedAt)>Date.parse(thread.lastVisitedAt))thread.lastVisitedAt=command.visitedAt;
        return {sequence:visits.length};
      }})});
      this.glow.observe(responses);await this.glow.refresh();
      const exists=(value:string)=>this.app.vault.getAbstractFileByPath(value) instanceof TFile;
      this.indicators=installFolderIndicators(document.body,()=>[],()=>this.glow!.project(noteIndicators(responses,exists),exists));
      await pause(350);checks.initialBothGlow=paths.every(value=>this.glowing(value));await this.capture('01-unread.png');
      thread.lastVisitedAt=completed;await this.glow.refresh(true);await pause(100);
      checks.otherClientReadClearsBoth=paths.every(value=>!this.glowing(value));await this.capture('02-read-in-t3.png');
      thread.lastVisitedAt=before;await this.glow.refresh(true);await pause(100);checks.serverMarkUnreadRelightsBoth=paths.every(value=>this.glowing(value));
      const started=Date.now();this.glow.view(note,started);this.glow.view(undefined,started+1000);await pause(50);checks.hiddenViewDoesNotVisit=visits.length===0;
      // The note contains the older exact result. The thread's newer result
      // remains unread after this displayed result is acknowledged.
      thread.latestRunId='newer-run';thread.latestRunCompletedAt=later;await this.glow.refresh(true);
      await this.app.workspace.getLeaf(false).openFile(file);
      this.glow.view(note);await pause(850);this.glow.view(note);await pause(250);
      checks.visibleEditorHasResult=this.app.workspace.getActiveViewOfType(MarkdownView)?.getViewData().includes('Synthetic result')===true;
      checks.observedResultAcknowledged=visits.length===1&&visits[0].visitedAt===completed&&thread.lastVisitedAt===completed;
      checks.newerResultStillUnread=Date.parse(thread.latestRunCompletedAt)>Date.parse(thread.lastVisitedAt);
      checks.mirroredNoteCleared=paths.every(value=>!this.glowing(value));await this.capture('03-read-in-obsidian.png');
      const reloaded=new CompletionGlow(saved,()=>{},{access:async()=>({origin:'https://synthetic.invalid',api:async()=>({threads:[{...thread}]})}),changed:()=>{}});
      await reloaded.refresh();checks.reloadUsesServerState=reloaded.project(new Map(),exists).size===0;reloaded.dispose();
      responses=responses.map(response=>({...response,completionId:'newer-run',completion:{...completion,runId:'newer-run',completedAt:later}}));this.glow.observe(responses);this.indicators.refresh();
      checks.newCompletionRelightsBoth=paths.every(value=>this.glowing(value));await this.capture('04-newer-unread.png');
      const refreshed=Date.now();this.glow.view(note,refreshed);await pause(100);this.glow.view(note,refreshed+100);await pause(50);checks.freshCompletionNeedsViewingInterval=visits.length===1;
    }finally{
      this.glow?.dispose();this.indicators?.dispose();
      await this.app.workspace.getLeaf(false).setViewState({type:'empty',state:{}});
      for(const notePath of fixtures){const file=this.app.vault.getAbstractFileByPath(notePath);if(file)await this.app.vault.delete(file);}
      const directory=this.app.vault.getAbstractFileByPath(folder);if(directory)await this.app.vault.delete(directory);
      checks.temporaryNotesDeleted=fixtures.every(value=>this.app.vault.getAbstractFileByPath(value)===null);
      checks.temporaryFolderDeleted=this.app.vault.getAbstractFileByPath(folder)===null;
      this.write('RESULT.json',{scope:'Real desktop Obsidian editor/explorer, synthetic T3 read state. No Sync, provider delivery, or native mobile coverage.',checks,pass:Object.values(checks).every(Boolean)&&Object.keys(checks).length>=13,visits,testThreads:[],testNotes:fixtures,cleanupVerified:checks.temporaryNotesDeleted&&checks.temporaryFolderDeleted});
    }
  }
  onunload(){this.glow?.dispose();this.indicators?.dispose();}
}
