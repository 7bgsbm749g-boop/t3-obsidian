import {MarkdownView,Modal,Notice,Setting} from 'obsidian';
import SendToT3 from '../main';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,uuid5} from '../desktop';
import type {ThreadAccess} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Complete product paths in a fresh unsynced native vault. Only the explicitly
 * configured temporary T3 project can receive the two bounded test prompts. */
export default class ThreadNoteModeLab extends SendToT3 {
  private labRoot='';private labAccess?:ThreadAccess;private labThread?:string;
  private labAutomated=false;
  private labNotes=['Fixture/A.md','Fixture/B.md'];private labErrors:string[]=[];
  async onload(){
    this.labRoot=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.labRoot,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    this.app.workspace.onLayoutReady(()=>void this.initializeLab().catch(error=>this.writeLab('STARTUP-ERROR.json',{error:String(error),stack:error.stack})));
  }
  private async initializeLab(){
    this.writeLab('STARTUP.json',{stage:'connecting-test-project'});
    const config=JSON.parse(fs.readFileSync(path.join(this.labRoot,'TEST-CONFIG.json'),'utf8'));this.labAutomated=config.automated===true;
    this.labAccess=await desktopThreadAccess(desktopDefaults());
    const project=(await this.labAccess.api('/api/orchestration/shell')).projects.find((item:any)=>item.id===config.projectId);
    if(!project||project.workspaceRoot!==path.join(this.labRoot,'workspace'))throw Error('Dedicated temporary project required.');
    const environmentId=await desktopEnvironment(desktopDefaults());
    this.app.saveLocalStorage('send-to-t3-code-device-v1',{mode:'desktop'});
    await this.saveData({vaultId:'mode-lab-'+crypto.randomUUID(),threadNoteMode:'free',projects:[project],autoSettleThreads:false,inlineStreaming:{enabled:true,intermediateMode:'collapse'},folderLinks:[{id:crypto.randomUUID(),folderPath:'Fixture',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:'',environmentId,self:false}]});
    this.writeLab('STARTUP.json',{stage:'loading-product-plugin'});
    await super.onload();
    this.addCommand({id:'mode-lab-settings',name:'Show mode test settings',callback:()=>this.showLabSettings()});
    this.addCommand({id:'mode-lab-cleanup',name:'Clean up mode test',callback:()=>void this.cleanupLab()});
    this.app.workspace.onLayoutReady(()=>void this.runLab().catch(error=>{this.writeLab('ERROR.json',{error:String(error),stack:error.stack});this.labErrors.push(String(error));return this.cleanupLab();}));
  }
  private writeLab(name:string,value:unknown){fs.writeFileSync(path.join(this.labRoot,name),JSON.stringify(value,null,2));}
  private async untilLab(check:()=>Promise<boolean>|boolean,label:string,timeout=180_000){
    const end=Date.now()+timeout;do{if(await check())return;await pause(250);}while(Date.now()<end);throw Error('Timed out: '+label);
  }
  private showLabSettings(){const p=this as any;p.settingsTab.section='replies';(this.app as any).setting.open();(this.app as any).setting.openTabById(this.manifest.id);}
  private async shotLab(name:string){fs.writeFileSync(path.join(this.labRoot,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
  private async expectRefusal(action:()=>Promise<unknown>){try{await action();throw Error('Mode guard did not refuse the request.');}catch(error){if(!String(error).includes('1:1 mode'))throw error;}}
  private async waitSaved(ids:string[],marker:string){
    const p=this as any;
    for(const id of ids){const result=await p.deviceInline.waitForSave(id,120_000);if(!result.saved)throw Error('Reply not saved: '+result.reason);}
    for(const note of this.labNotes){const file=this.app.vault.getFileByPath(note)!;if(note==='Fixture/A.md'||ids.length>1){await this.untilLab(async()=>(await this.app.vault.read(file)).includes(marker),'saved '+note);}}
  }
  private async runLab(){
    await this.app.vault.createFolder('Fixture');
    const a=await this.app.vault.create(this.labNotes[0],'Reply with exactly MODE_ONE_TO_ONE_OK. Do not use tools, inspect files, change files, or start other work. This is a bounded synthetic UI test.\n');
    await this.app.vault.create(this.labNotes[1],'# Second synthetic destination\n');
    await this.app.workspace.getLeaf(false).openFile(a);
    this.writeLab('TEMPORARY.json',{projectId:JSON.parse(fs.readFileSync(path.join(this.labRoot,'TEST-CONFIG.json'),'utf8')).projectId,threadIds:[],notePaths:this.labNotes});
    if(this.labAutomated){this.settings.threadNoteMode='one-to-one';await this.save();}else this.showLabSettings();
    this.writeLab('STAGE.json',{stage:'select-one-to-one-in-real-settings'});
    await this.untilLab(()=>this.settings.threadNoteMode==='one-to-one','real settings 1:1 choice');
    await this.shotLab('one-to-one-settings.png');(this.app as any).setting.close();
    const sendId=crypto.randomUUID();this.labThread=uuid5(sendId,'thread');
    this.writeLab('TEMPORARY.json',{threadIds:[this.labThread],notePaths:this.labNotes});
    const sent=await this.executeNoteCommand({version:1,id:sendId,kind:'send-note',notePath:a.path,destinations:[a.path],streamReply:true});
    this.labThread=sent.threadId!;
    this.writeLab('TEMPORARY.json',{threadIds:[this.labThread],notePaths:this.labNotes});
    await this.waitSaved(sent.bindingIds!,'MODE_ONE_TO_ONE_OK');
    await this.expectRefusal(()=>this.executeNoteCommand({version:1,id:crypto.randomUUID(),kind:'send-note',notePath:this.labNotes[1],threadId:this.labThread,destinations:[this.labNotes[1]],streamReply:true}));
    await this.expectRefusal(()=>this.executeNoteCommand({version:1,id:crypto.randomUUID(),kind:'send-note',notePath:a.path,threadId:this.labThread,destinations:this.labNotes,streamReply:true}));
    // Add ordinary source text so the continuation chooser has new material.
    const view=this.app.workspace.getActiveViewOfType(MarkdownView)!;
    view.editor.replaceRange('\nReply with exactly MODE_FREE_OK. Do not use tools or change files.\n',view.editor.offsetToPos(view.editor.getValue().length));await (view as any).save();
    this.openNoteSend(a,true);await pause(1500);await this.shotLab('one-to-one-chooser.png');
    const oneText=document.querySelector('.modal')?.textContent??'';
    const visibleButtons=Array.from(document.querySelectorAll<HTMLButtonElement>('.modal button')).filter(button=>!button.hidden).map(button=>button.textContent);
    if(visibleButtons.includes('New thread')||visibleButtons.includes('Existing thread…')||!oneText.includes('1:1 mode'))throw Error('The 1:1 chooser did not constrain the linked note.');
    this.writeLab('ONE-TO-ONE.json',{sent,checks:{realReplySaved:true,threadReuseRefused:true,multipleDestinationsRefused:true,chooserRestricted:true},visibleButtons});
    this.writeLab('STAGE.json',{stage:'inspect-chooser-then-select-free'});
    if(this.labAutomated){this.settings.threadNoteMode='free';await this.save();}
    await this.untilLab(()=>this.settings.threadNoteMode==='free','real settings Free choice');
    await this.shotLab('free-settings.png');(this.app as any).setting.close();
    const free=await this.executeNoteCommand({version:1,id:crypto.randomUUID(),kind:'send-note',notePath:a.path,threadId:this.labThread,destinations:this.labNotes,streamReply:true});
    // Closed notes retain a final-write plan until a real editor adopts it.
    await this.app.workspace.getLeaf('tab').openFile(this.app.vault.getFileByPath(this.labNotes[1])!);
    await this.waitSaved(free.bindingIds!,'MODE_FREE_OK');
    await this.shotLab('free-two-destinations.png');
    const thread=await this.labAccess!.api('/api/orchestration/threads/'+this.labThread+'?controlOnly=true');
    this.writeLab('RESULT.json',{checks:{oneToOneRealDelivery:true,oneToOneConflictsRefused:true,freeSameThreadTwoNotes:true,freeBothRepliesSaved:true},settingsChangedThroughNativeUI:!this.labAutomated,threadId:this.labThread,oneToOne:sent,free,loadedVersion:this.manifest.version,coverage:'Two bounded real T3 deliveries from a separate native desktop vault. No QLO2 fixture, no Sync claim, no native mobile claim.',canonicalThreadId:thread.thread.id});
    this.writeLab('STAGE.json',{stage:'inspect-final-result-then-cleanup'});
    if(this.labAutomated){await this.cleanupLab();return;}
    const modal=new Modal(this.app);modal.titleEl.setText('Mode test complete');modal.contentEl.createEl('p',{text:'Both modes saved real replies. Capture this window, then remove all temporary notes and the test thread.'});
    new Setting(modal.contentEl).addButton(button=>button.setButtonText('Clean up test').onClick(()=>{modal.close();void this.cleanupLab();}));modal.open();
  }
  private async cleanupLab(){
    const remainingThreadIds:string[]=[];
    try{
      if(this.labThread){
        await this.labAccess?.close?.();this.labAccess=await desktopThreadAccess(desktopDefaults());
        const snapshot=await this.labAccess.api('/api/orchestration/threads/'+this.labThread+'?controlOnly=true');
        for(const run of snapshot.thread.runs??[])if(run.status==='running'||run.status==='waiting')await this.labAccess.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:crypto.randomUUID(),threadId:this.labThread,turnId:run.id,createdAt:new Date().toISOString()});
        await this.labAccess.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.labThread});
        let deleted=false;try{deleted=!!(await this.labAccess.api('/api/orchestration/threads/'+this.labThread+'?controlOnly=true')).thread.deletedAt;}catch(error){deleted=(error as any)?.status===404;}
        if(!deleted)remainingThreadIds.push(this.labThread);
      }
    }catch(error){this.labErrors.push('Thread cleanup: '+String(error));if(this.labThread)remainingThreadIds.push(this.labThread);}
    await this.labAccess?.close?.();this.labAccess=undefined;
    for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();
    for(const note of [...this.labNotes,'Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(note);if(file)await this.app.vault.delete(file);}
    this.writeLab('CLEANUP.json',{temporaryThreadIds:this.labThread?[this.labThread]:[],remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),errors:this.labErrors});
    new Notice('Temporary mode test notes and thread removed.');
    await pause(250);require('@electron/remote').app.quit();
  }
}
