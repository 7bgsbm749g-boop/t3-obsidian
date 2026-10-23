import {Plugin,MarkdownView,setIcon} from 'obsidian';
import SendToT3 from '../main';
import {LocalResponseManager} from '../local-response-manager';
import {DirectInlinePreview} from '../direct-inline-preview';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {nativeResponses} from '../native-response-manager';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {applyThreadItem} from '../inline-thread';
import {updateResponseBindingData,responseBindingRequests} from '../response-binding-data';
import {importRuns,runImportResultMessage,type RunImportResult} from '../run-import';
import {ImportRunModal} from '../run-import-ui';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Real native file/editor IO with a synthetic exact T3 final item. No dispatch,
 * user settings, production vault, private response, or network connection. */
export default class ImportSaveLab extends Plugin {
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    const write=(name:string,value:any)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2));
    const capture=async(name:string)=>fs.writeFileSync(path.join(root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
    this.app.workspace.onLayoutReady(()=>void this.run(root,write,capture).catch(error=>write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.cleanup(write)));
  }
  private async run(root:string,write:(name:string,value:any)=>void,capture:(name:string)=>Promise<void>){
    const native=nativeResponses(this.app);this.register(()=>native.dispose());
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>native.filter(tr)));
    this.register(installResponsePresentation(document,setIcon));
    const subject:any=new SendToT3(this.app,this.manifest),messageId='cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa',turnId='synthetic-completed-run';
    const source={threadId:'synthetic-thread',projectId:'synthetic-project',environmentId:'synthetic-environment'};
    const at='2026-10-20T00:00:00Z',turn={turnId,messageId,state:'completed',requestedAt:at,completedAt:at,assistantMessageId:'synthetic-answer'};
    const marker='NATIVE_IMPORT_FINAL_SAVED';
    const snapshot={snapshotSequence:2,thread:{protocolVersion:2,id:source.threadId,projectId:source.projectId,title:'Synthetic completed import',latestTurn:turn,turns:{[turnId]:turn},session:{status:'ready',activeTurnId:null},activities:[],messages:[{id:messageId,role:'user',turnId,text:'Synthetic import prompt.',streaming:false,createdAt:at},{id:'synthetic-answer',role:'assistant',turnId,itemId:'synthetic-final-item',updatedAt:at,text:marker,streaming:false,createdAt:at}]}};
    subject.settings={vaultId:'synthetic-import-vault',inlineStreaming:{enabled:true},responseBindings:{}};
    subject.connection=()=>({environmentId:source.environmentId});
    subject.localResponseTarget=async()=>({environmentId:source.environmentId,workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'});
    subject.readImportHistory=async()=>({source,state:applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state,title:snapshot.thread.title});
    let syncReady=false;const completionReads:any[]=[];
    const local=new LocalResponseManager('synthetic-native-client',subject.settings.vaultId,{
      ...deviceNoteIO(this.app),localBindings:()=>responseBindingRequests(subject.settings.responseBindings),saveLocalBinding:async request=>{subject.settings.responseBindings=updateResponseBindingData(subject.settings.responseBindings,request,'synthetic');},
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.saved()??view.getViewData()})),
      syncReady:()=>syncReady,receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(id,note)=>native.localCompleted(id,note),
      completionFailed:error=>write('SAVE-ERROR.json',{error:String(error)}),
      access:async()=>({origin:'https://synthetic.invalid',api:async(route,payload)=>{completionReads.push({route,itemId:payload?.itemId});if(route!=='/api/orchestration/turn-item')throw Error('Unexpected synthetic request.');return {id:'synthetic-final-item',threadId:source.threadId,runId:turnId,messageId:'synthetic-answer',type:'assistant_message',text:marker,streaming:false,status:'completed',updatedAt:at};}}),
    },deviceFinalNoteIO(this.app,()=>true),Date.now,(record,access,receive)=>new DirectInlinePreview(record,access,receive,(_thread,_access,callbacks)=>{queueMicrotask(()=>callbacks.item({kind:'snapshot',snapshot}));return {stop:()=>{}};}));
    this.register(()=>local.dispose());this.registerInterval(window.setInterval(()=>{native.refresh();local.tick();},100));
    let dialog:ImportRunModal|undefined,dialogSaveChecked=false,followChecked=false;
    subject.deviceInline={register:(request:any)=>local.register(request),waitForSave:async(id:string)=>{
      if(!dialogSaveChecked){
        for(let n=0;n<50&&!this.app.workspace.getLeavesOfType('markdown').some(pane=>(pane.view as MarkdownView).editor?.getValue().includes(marker));n++)await pause(100);
        const finalVisible=this.app.workspace.getLeavesOfType('markdown').some(pane=>(pane.view as MarkdownView).editor?.getValue().includes(marker));
        const dialogClosed=!!dialog&&!dialog.modalEl.isConnected;
        write('DIALOG-WAITING-SAVE.json',{finalVisible,dialogClosed,saveStillPending:true});await capture('dialog-waiting-save.png');
        if(!finalVisible||!dialogClosed)throw Error('The import dialog did not close while its final save was pending.');
        dialogSaveChecked=true;await pause(1500);
      }
      return local.waitForSave(id,500);
    }};
    subject.followImportedThread=async()=>{
      const dialogClosed=!!dialog&&!dialog.modalEl.isConnected;
      write('DIALOG-WAITING-FOLLOW.json',{dialogClosed,syntheticFollowAcknowledgementPending:true});await capture('dialog-waiting-follow.png');
      if(!dialogClosed)throw Error('The import dialog stayed open while following waited.');
      followChecked=true;await pause(1500);
    };
    const imported=await this.app.vault.create('Imported.md','# Imported run\n\nOrdinary text before.\n\n');
    const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(imported);await leaf.setViewState({type:'markdown',state:{file:imported.path,mode:'source',source:false}});
    let importedResult!:(result:RunImportResult)=>void,importFailed!:(error:unknown)=>void;
    const importing=new Promise<RunImportResult>((resolve,reject)=>{importedResult=resolve;importFailed=reject;});
    const selected=importRuns(applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state)[0];
    dialog=new ImportRunModal(this.app,imported.path,{id:source.threadId,title:snapshot.thread.title} as any,selected,async follow=>{
      try{const result=await subject.importRun(imported.path,{id:source.projectId},source.threadId,messageId,follow);importedResult(result);return result;}
      catch(error){importFailed(error);throw error;}
    });
    dialog.open();await capture('dialog-ready.png');
    write('DIALOG-READY.json',{instruction:'Enable Follow future runs, then press Import response. The fixture delays saving and a synthetic follow acknowledgement. No T3 prompt or subscription is dispatched.'});
    const pending=await importing;
    if(!followChecked)throw Error('Enable Follow future runs to check the delayed follow acknowledgement.');
    const request=responseBindingRequests(subject.settings.responseBindings)[0],pendingDisk=await this.app.vault.read(imported),pendingVisible=(leaf.view as MarkdownView).editor.getValue();
    write('PENDING.json',{pending,diskHasPlaceholder:pendingDisk.includes(':::send-to-t3-response'),editorHasFinal:pendingVisible.includes(marker)});
    await capture('pending.png');
    if(pending.saveState!=='pending'||pending.pendingReason!=='sync'||!pendingDisk.includes(':::send-to-t3-response')||!pendingVisible.includes(marker))throw Error('The native pending import was not represented honestly.');
    leaf.detach();syncReady=true;local.tick();
    const saved=await local.waitForSave(request.id,5000),final=await this.app.vault.read(imported);
    if(!saved.saved||final.includes(':::send-to-t3-response')||!final.includes(marker)||!final.includes('Ordinary text before.'))throw Error('The imported final was not saved after its native tab closed.');
    const retry=await subject.importRun(imported.path,{id:source.projectId},source.threadId,messageId,false);
    if(retry.saveState!=='saved'||!retry.duplicate||await this.app.vault.read(imported)!==final)throw Error('Repeat import changed a saved native note.');
    const reference=this.app.vault.getFileByPath('Reference.md')!;await this.app.vault.modify(reference,'# Saved response preview\n\n[[Imported]]\n');
    const referenceLeaf=this.app.workspace.getLeaf(false);await referenceLeaf.openFile(reference);await referenceLeaf.setViewState({type:'markdown',state:{file:reference.path,mode:'preview'}});await pause(500);
    const referenceView=referenceLeaf.view as MarkdownView,anchor=referenceView.contentEl.querySelector<HTMLAnchorElement>('a.internal-link');
    if(!anchor)throw Error('The native reference wikilink did not render.');
    const anchorBounds=anchor.getBoundingClientRect(),hoverParent=referenceView.previewMode as any;
    (this.app.workspace as any).trigger('hover-link',{event:new MouseEvent('mouseover',{bubbles:true,ctrlKey:true,view:window,clientX:anchorBounds.left+5,clientY:anchorBounds.top+5}),source:'preview',hoverParent,targetEl:anchor,linktext:'Imported',sourcePath:reference.path});
    for(let n=0;n<25&&!document.querySelector('.hover-popover')?.textContent?.includes(marker);n++)await pause(100);
    // The fixture has no physical pointer to keep the native hover open.
    // Show the core-created popover after its real note renderer has loaded.
    hoverParent.hoverPopover?.show?.();await pause(250);
    const popover=document.querySelector<HTMLElement>('.hover-popover'),bounds=popover?.getBoundingClientRect(),style=popover&&getComputedStyle(popover);
    const hoverContentLoaded=!!popover?.textContent?.includes(marker),hoverVisible=hoverContentLoaded&&!!bounds&&bounds.width>0&&bounds.height>0&&style?.display!=='none'&&style?.visibility!=='hidden'&&style?.opacity!=='0';
    write('HOVER.json',{hoverContentLoaded,hoverVisible,bounds:bounds&&{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},display:style?.display,visibility:style?.visibility,opacity:style?.opacity});await capture('saved-hover.png');
    const show=this.app.workspace.getLeaf(false);await show.openFile(imported);await show.setViewState({type:'markdown',state:{file:imported.path,mode:'preview'}});await pause(300);
    const readingVisible=(show.view as MarkdownView).contentEl.textContent?.includes(marker)??false;await capture('saved-reading.png');
    write('RESULT.json',{scope:'Synthetic T3 final item and follow acknowledgement; real native Obsidian import dialog, editors and checked file IO. The optional core hover observation does not perform a physical pointer gesture. No real delivery, Sync or native mobile claim.',pending,pendingNotice:runImportResultMessage(pending),saved,retry,completionReads,checks:{dialogClosedDuringFinalSave:dialogSaveChecked,dialogClosedDuringFollow:followChecked,pendingShowsFinalWithoutSaving:true,closedTabFinalSaved:true,ordinaryTextPreserved:true,repeatLeavesSavedBytes:true,readingVisible},hoverObservation:{hoverContentLoaded,hoverVisible,physicalGesture:false},testThreads:[]});
  }
  private async cleanup(write:(name:string,value:any)=>void){
    for(const pane of this.app.workspace.getLeavesOfType('markdown'))if(['Imported.md','Reference.md','Virtual.md'].includes((pane.view as MarkdownView).file?.path??''))pane.detach();
    for(const name of ['Imported.md','Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
    write('CLEANUP.json',{testThreads:[],deletedNotes:['Imported.md','Reference.md','Virtual.md'],remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path)});
  }
}
