import {Plugin,MarkdownView} from 'obsidian';
import SendToT3 from '../src/app/main';
import {closeNoteTabPanel} from '../src/notes/note-tab-panel';
import {loadSmartSend,prepareSmartSend,confirmSmartSend,smartDestination} from '../src/notes/smart-send';

const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const notes=['First send.md','Selected send.md','Imported send.md','Reference.md','Virtual.md'];

/** Native chooser and production routing. Acceptance is synthetic and bounded;
 * this fixture never connects to T3 or creates a thread. */
export default class FirstSendLab extends Plugin {
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
    const capture=async(name:string)=>fs.writeFileSync(path.join(root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
    this.app.workspace.onLayoutReady(()=>void pause(700).then(()=>this.run(write,capture)).catch(error=>write('ERROR.json',{error:String(error),stack:error.stack})).finally(async()=>{
      closeNoteTabPanel(this.app);
      for(const leaf of this.app.workspace.getLeavesOfType('markdown'))if(notes.includes((leaf.view as MarkdownView).file?.path??'')){await (leaf.view as MarkdownView).save();leaf.detach();}
      for(const name of notes){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
      write('CLEANUP.json',{threadsCreated:[],remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),notesAbsent:notes.every(name=>!this.app.vault.getAbstractFileByPath(name))});
    }));
  }
  private async run(write:(name:string,value:unknown)=>void,capture:(name:string)=>Promise<void>){
    const original='# First send\n\nFirst paragraph.\n\nOther note contents.\n';
    const file=await this.app.vault.create(notes[0],original),leaf=this.app.workspace.getLeaf(false);
    const open=async(file:import('obsidian').TFile)=>{await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false},active:true});await pause(150);return leaf.view as MarkdownView;};
    const view=await open(file),subject:any=new SendToT3(this.app,this.manifest),smart=loadSmartSend(undefined),sent:any[]=[],events:any[]=[];
    const project={id:'synthetic-project',title:'Synthetic project',workspaceRoot:'/synthetic'};
    subject.mode='desktop';
    subject.settings={threadNoteMode:'free',projects:[project],directProjects:[],paired:[],folderLinks:[{id:'synthetic-link',folderPath:'/',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:'',self:true}],noteThreads:[],noteContexts:[],responseBindings:{},inlineStreaming:{enabled:false}};
    subject.smartData=()=>smart;subject.recoverNoteThread=async()=>{};subject.recoverSmartReplies=async()=>{};
    subject.vaultMachines=()=>[];subject.defaultNoProjectMachine=()=>undefined;
    subject.connection=()=>({transport:'desktop',environmentId:'synthetic-environment'});
    subject.localInlineEnvironment=async()=> 'synthetic-environment';
    subject.readChatThread=async()=>({id:'synthetic-thread',projectId:project.id,title:'Synthetic thread',session:{status:'ready',activeTurnId:null},latestTurn:{state:'completed'}});
    subject.sendNote=async(source:import('obsidian').TFile,threadId?:string,_projectKey?:string,newThread=false)=>{
      const document=(leaf.view as MarkdownView).editor.getValue();
      const destination=smartDestination('synthetic-environment',project.id,'synthetic-thread');
      const plan=await prepareSmartSend(smart,source.path,destination,document);
      confirmSmartSend(smart,'synthetic-acceptance-'+sent.length,destination,plan.capture);
      subject.rememberNoteThread(subject.noteThreadIntent(source.path,project,subject.connection()),'synthetic-thread');
      sent.push({source:source.path,threadId,newThread,sourceText:plan.text});
    };
    const panel=()=>view.containerEl.ownerDocument.querySelector<HTMLElement>('.send-to-t3-tab-panel');
    const assert=(condition:unknown,message:string)=>{if(!condition)throw Error(message);};
    const trusted:any[]=[];const record=(event:Event)=>{if(event.isTrusted)trusted.push({type:event.type,text:(event.target as HTMLElement)?.textContent,key:(event as KeyboardEvent).key});};
    document.addEventListener('click',record,true);document.addEventListener('keydown',record,true);
    const until=async(check:()=>boolean)=>{const deadline=Date.now()+120_000;while(!check()&&Date.now()<deadline)await pause(100);assert(check(),'Native input did not reach the expected state.');};
    try{
      await subject.openNoteSend(file);await pause(200);
      assert(panel()&&sent.length===0&&!view.containerEl.querySelector('.send-to-t3-send-preview'),'First send did not open a quiet chooser.');
      events.push({case:'first-send',chooser:true,sent:sent.length,sourcePreserved:view.editor.getValue()===original});
      await capture('first-send-menu.png');write('READY.json',{stage:'cancel-first',note:file.path});
      await until(()=>!panel());assert(sent.length===0&&!subject.hasConfirmedNoteSend(file.path),'Cancellation established a send.');
      await subject.openNoteSend(file);await pause(150);assert(panel(),'Cancellation did not preserve the first-send chooser.');
      write('READY.json',{stage:'choose-new',note:file.path});
      await until(()=>sent.length===1);await pause(150);assert(!panel()&&subject.hasConfirmedNoteSend(file.path),'Explicit send did not confirm the note.');
      view.editor.setValue(original+'\nFollow-up instruction.\n');await view.save();await subject.openNoteSend(file);
      assert(sent.length===2&&!panel()&&sent[1].threadId==='synthetic-thread','Confirmed follow-up did not use its exact previous thread.');
      events.push({case:'confirmed-follow-up',chooser:false,threadId:sent[1].threadId,newText:sent[1].sourceText});
      await subject.openNoteSend(file,true);await pause(200);assert(panel(),'Explicit chooser failed after a confirmed send.');await capture('explicit-menu-after-send.png');closeNoteTabPanel(this.app);
      const selectedFile=await this.app.vault.create(notes[1],original),selectedView=await open(selectedFile);
      const start=original.indexOf('First paragraph.');selectedView.editor.setSelection(selectedView.editor.offsetToPos(start),selectedView.editor.offsetToPos(start+16));
      await subject.openManualAction(selectedFile,'Explain it.','First paragraph.',{view:selectedView,editor:selectedView.editor});await pause(150);
      assert(panel()&&sent.length===2&&selectedView.editor.getValue()===original,'Fresh selection Ask did not preserve its source in the chooser.');
      events.push({case:'fresh-selection-ask',chooser:true,noDispatch:true,sourcePreserved:true});await capture('fresh-selection-ask-menu.png');closeNoteTabPanel(this.app);
      const importedFile=await this.app.vault.create(notes[2],'Imported response.\n\nFresh user instruction.\n');await open(importedFile);
      subject.rememberNoteThread(subject.noteThreadIntent(importedFile.path,project,subject.connection()),'synthetic-thread');
      await subject.openNoteSend(importedFile);await pause(200);
      assert(panel()&&sent.length===2&&!subject.hasConfirmedNoteSend(importedFile.path),'Import alone bypassed the first-send chooser.');
      events.push({case:'import-without-send',chooser:true,noDispatch:true});await capture('import-first-send-menu.png');closeNoteTabPanel(this.app);
      assert(trusted.some(event=>event.key==='Escape')&&trusted.some(event=>event.type==='click'&&event.text==='New thread'),'Missing native cancel or send action.');
      write('RESULT.json',{ok:true,scope:'Real desktop editor and production Send/Ask routing; native cancellation and New thread click; synthetic T3 acceptance only. No external dispatch, Sync, or native mobile coverage.',events,sent,trusted,threadsCreated:[]});
    }finally{document.removeEventListener('click',record,true);document.removeEventListener('keydown',record,true);subject.sendPreviews.dispose();}
  }
}
