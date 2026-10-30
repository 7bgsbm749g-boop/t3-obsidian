import {Plugin,MarkdownView} from 'obsidian';
import SendToT3 from '../main';
import {InlineChatManager} from '../inline-chat';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {nativeResponses} from '../native-response-manager';
import {captureCursorInsertion} from '../cursor-insertion';
import {installActivityShine} from '../activity-shine';

const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve!:()=>void;return {work:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};}

/** Real native editor and production Send/Ask entry points. Preparation is
 * deliberately stalled, then cancelled before any external T3 dispatch. */
export default class ImmediateSendLab extends Plugin {
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
    const capture=async(name:string)=>fs.writeFileSync(path.join(root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    this.register(installActivityShine(document));
    this.app.workspace.onLayoutReady(()=>void pause(800).then(()=>this.run(write,capture)).catch(error=>write('ERROR.json',{error:String(error),stack:error.stack})).finally(async()=>{
      for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();
      for(const name of ['Immediate Send.md','Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
      write('CLEANUP.json',{threadsCreated:[],remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path)});
    }));
  }
  private async run(write:(name:string,value:unknown)=>void,capture:(name:string)=>Promise<void>){
    const original='# Immediate Send\n\nFirst paragraph.\n\nLater paragraph.\n';
    const file=await this.app.vault.create('Immediate Send.md',original),leaf=this.app.workspace.getLeaf(false);
    await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false},active:true});
    const view=leaf.view as MarkdownView,subject:any=new SendToT3(this.app,this.manifest),events:unknown[]=[];
    subject.settings={inlineStreaming:{enabled:true,intermediateMode:'collapse'},noteThreads:[]};
    const previews=subject.sendPreviews;this.register(()=>previews.dispose());
    const at=original.indexOf('Later'),insertion=captureCursorInsertion(original,at);
    view.editor.setCursor(view.editor.offsetToPos(at));
    await pause(500);
    const gate=deferred();subject.chatTarget=async()=>{await gate.work;throw Error('Synthetic cancellation before dispatch');};
    const started=performance.now(),sending=subject.sendNote(file,undefined,undefined,true,undefined,undefined,insertion).catch((error:Error)=>error.message);
    const cm=(view.editor as any).cm;
    // Decoration dispatch is synchronous; DOM measurement may run next frame.
    const synchronousDecoration=cm.state.facet(require('@codemirror/view').EditorView.decorations).some((value:any)=>typeof value!=='function'&&value.size>0);
    await pause(120);
    const pending=view.contentEl.querySelector('.send-to-t3-send-preview'),visibleAt=performance.now()-started;
    events.push({case:'whole-note',synchronousDecoration,visible:!!pending,visibleAtMilliseconds:visibleAt,sourceUnchanged:view.editor.getValue()===original,diskUnchanged:await this.app.vault.read(file)===original});
    await pause(500);
    await capture('send-project-check-pending.png');
    if(!pending||!synchronousDecoration||view.editor.getValue()!==original)throw Error('Whole-note pending block did not appear before project lookup.');
    gate.resolve();await sending;await pause(60);
    if(view.contentEl.querySelector('.send-to-t3-send-preview')||view.editor.getValue()!==original)throw Error('Failed Send left a block or changed the note.');

    await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'preview'},active:true});await pause(500);
    const readingGate=deferred();subject.chatTarget=async()=>{await readingGate.work;throw Error('Synthetic cancellation before dispatch');};
    const reading=subject.sendNote(file,undefined,undefined,true).catch((error:Error)=>error.message);await pause(500);
    const readingPending=!!view.contentEl.querySelector('.markdown-preview-sizer .send-to-t3-send-preview');
    await capture('reading-preparation-pending.png');readingGate.resolve();await reading;
    const readingCleared=!view.contentEl.querySelector('.send-to-t3-send-preview');
    events.push({case:'reading',pending:readingPending,cleared:readingCleared,diskUnchanged:await this.app.vault.read(file)===original});
    if(!readingPending||!readingCleared)throw Error('Reading-view pending block did not appear and clear.');
    await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false},active:true});await pause(500);

    const manager=new InlineChatManager(this.app,'immediate-send-lab',async()=>undefined);subject.inlineChat=manager;
    this.register(()=>manager.dispose());manager.prepare=async()=>{};manager.start=()=>{};
    const askGate=deferred();subject.sendChat=async(_prompt:unknown,_note:unknown,options:any)=>{await askGate.work;await options.onPrepared({id:options.requestId,title:'Synthetic response'});};
    const asking=subject.sendInlineChat('Explain',{path:file.path},{view,editor:view.editor,insertion},{newThread:true});
    await pause(100);
    const askPending=!!view.contentEl.querySelector('.send-to-t3-send-preview');
    if(!askPending||view.editor.getValue()!==original)throw Error('Ask did not show an immediate, document-free block.');
    await pause(500);await capture('ask-preparation-pending.png');askGate.resolve();await asking;await pause(700);
    const handoff=!view.contentEl.querySelector('.send-to-t3-send-preview')&&view.editor.getValue().split('<!-- t3-inline:start:').length-1===1;
    events.push({case:'ask',pendingBeforePreparation:askPending,handoffToOneResponse:handoff,responseBeforeLaterParagraph:view.editor.getValue().indexOf('t3-inline:end:')<view.editor.getValue().indexOf('Later paragraph.')});
    await capture('ask-real-block-handoff.png');if(!handoff)throw Error('Ask did not hand off to one response block.');
    await manager.deliveryFailed(manager.activeFor(file.path)[0]);
    await view.save();
    nativeResponses(this.app).dispose();
    write('RESULT.json',{scope:'Real Obsidian desktop editor; synthetic delayed preparation, cancelled before dispatch. No real delivery, Sync, or native mobile coverage.',events,threadsCreated:[],allPassed:true});
  }
}
