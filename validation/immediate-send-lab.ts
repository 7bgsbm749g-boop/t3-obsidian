import {Plugin,MarkdownView,setIcon} from 'obsidian';
import SendToT3 from '../src/app/main';
import {InlineChatManager} from '../src/conversations/inline-chat';
import {hiddenInlineMarkerExtension} from '../src/conversations/inline-markers';
import {nativeResponses} from '../src/responses/native-response-manager';
import {captureCursorInsertion} from '../src/notes/cursor-insertion';
import {installActivityShine} from '../src/ui/activity-shine';
import {installResponsePresentation} from '../src/responses/response-presentation';
import {commandId} from '../src/connection/direct';

const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve!:()=>void;return {work:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};}

/** Real native editor and production Send/Ask entry points. Preparation is
 * deliberately stalled, then cancelled before any external T3 dispatch. */
export default class ImmediateSendLab extends Plugin {
  private cleanups:Array<()=>void>=[];
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
    const capture=async(name:string)=>fs.writeFileSync(path.join(root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    this.register(installActivityShine(document));
    this.register(installResponsePresentation(document,setIcon));
    this.app.workspace.onLayoutReady(()=>void pause(800).then(()=>this.run(write,capture)).catch(error=>write('ERROR.json',{error:String(error),stack:error.stack})).finally(async()=>{
      for(const cleanup of this.cleanups.splice(0))cleanup();
      nativeResponses(this.app).dispose();
      for(const leaf of this.app.workspace.getLeavesOfType('markdown')){await (leaf.view as MarkdownView).save();leaf.detach();}
      await pause(400);
      for(const name of ['Immediate Send.md','Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
      await pause(400);
      write('CLEANUP.json',{threadsCreated:[],remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path)});
    }));
  }
  private async run(write:(name:string,value:unknown)=>void,capture:(name:string)=>Promise<void>){
    const original='# Immediate Send\n\nFirst paragraph.\n\nLater paragraph.\n';
    const file=await this.app.vault.create('Immediate Send.md',original),leaf=this.app.workspace.getLeaf(false);
    await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false},active:true});
    const view=leaf.view as MarkdownView,subject:any=new SendToT3(this.app,this.manifest),events:unknown[]=[];
    subject.settings={inlineStreaming:{enabled:true,intermediateMode:'collapse'},noteThreads:[]};
    const previews=subject.sendPreviews;this.register(()=>previews.dispose());this.cleanups.push(()=>previews.dispose());
    const checkBox=()=>{
      const pending=view.contentEl.querySelector('.send-to-t3-send-preview'),fold=pending?.querySelector('.callout[data-callout="t3-progress"]');
      const heading=fold?.querySelector(':scope > .callout-title');
      const details={nativeFold:!!fold?.classList.contains('is-collapsible'),foldControl:!!heading?.querySelector('.callout-fold'),content:!!fold?.querySelector(':scope > .callout-content .send-to-t3-response-activity'),timer:!!heading?.querySelector('.send-to-t3-run-timer'),identity:!!heading?.querySelector('.send-to-t3-fold-key'),noteName:!!heading?.textContent?.includes('Immediate Send · Sending'),correctStatus:!heading?.textContent?.match(/T3 ·|Working|Thinking/)};
      if(Object.values(details).some(value=>!value))throw Error('Pending response is not a full native Sending box: '+JSON.stringify(details));
      return details;
    };
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
    events.push({case:'native-streaming-structure',...checkBox()});
    await capture('send-project-check-pending.png');
    if(!pending||!synchronousDecoration||view.editor.getValue()!==original)throw Error('Whole-note pending block did not appear before project lookup.');
    const fold=pending.querySelector<HTMLElement>('.callout')!,heading=fold.querySelector<HTMLElement>(':scope > .callout-title')!,foldStates:boolean[]=[];
    // Presentation handles the real callout's click at document capture and
    // stops it there. Observe at the window before that handler, then read
    // the resulting fold state after the native event has finished.
    const clicked=(event:Event)=>{if(!event.isTrusted||!(event.target instanceof Element)||event.target.closest('.callout-title')!==heading)return;setTimeout(()=>{foldStates.push(fold.classList.contains('is-collapsed'));write('FOLD-INPUT.json',{foldStates});},0);};
    window.addEventListener('click',clicked,true);
    const rect=heading.getBoundingClientRect();write('READY.json',{case:'native-fold',heading:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}});
    const deadline=Date.now()+120_000;
    while(foldStates.length<2&&Date.now()<deadline)await pause(100);
    window.removeEventListener('click',clicked,true);
    if(foldStates[0]!==true||foldStates[1]!==false)throw Error('Two trusted native clicks did not collapse and expand the pending streaming box: '+JSON.stringify(foldStates));
    events.push({case:'native-fold-input',foldStates,sourceUnchanged:view.editor.getValue()===original,diskUnchanged:await this.app.vault.read(file)===original});
    await capture('send-fold-expanded-again.png');
    gate.resolve();await sending;await pause(60);
    if(view.contentEl.querySelector('.send-to-t3-send-preview')||view.editor.getValue()!==original)throw Error('Failed Send left a block or changed the note.');

    await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'preview'},active:true});await pause(500);
    const readingGate=deferred();subject.chatTarget=async()=>{await readingGate.work;throw Error('Synthetic cancellation before dispatch');};
    const reading=subject.sendNote(file,undefined,undefined,true).catch((error:Error)=>error.message);await pause(500);
    const readingPending=!!view.contentEl.querySelector('.markdown-preview-sizer .send-to-t3-send-preview');
    events.push({case:'reading-native-structure',...checkBox()});
    await capture('reading-preparation-pending.png');readingGate.resolve();await reading;
    const readingCleared=!view.contentEl.querySelector('.send-to-t3-send-preview');
    events.push({case:'reading',pending:readingPending,cleared:readingCleared,diskUnchanged:await this.app.vault.read(file)===original});
    if(!readingPending||!readingCleared)throw Error('Reading-view pending block did not appear and clear.');
    await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false},active:true});await pause(500);

    const manager=new InlineChatManager(this.app,'immediate-send-lab',async()=>undefined);subject.inlineChat=manager;
    this.register(()=>manager.dispose());this.cleanups.push(()=>manager.dispose());manager.prepare=async(job,request)=>{job.threadId='synthetic-thread';job.messageId=commandId(request.id,'message');};manager.start=()=>{};
    const askGate=deferred(),dispatchGate=deferred(),prepared=deferred();subject.sendChat=async(_prompt:unknown,_note:unknown,options:any)=>{await askGate.work;await options.onPrepared({id:options.requestId,title:'New thread'});prepared.resolve();await dispatchGate.work;};
    const asking=subject.sendInlineChat('Explain',{path:file.path},{view,editor:view.editor,insertion},{newThread:true});
    await pause(100);
    const askPending=!!view.contentEl.querySelector('.send-to-t3-send-preview');
    events.push({case:'ask-native-structure',...checkBox()});
    if(!askPending||view.editor.getValue()!==original)throw Error('Ask did not show an immediate, document-free block.');
    await pause(500);await capture('ask-preparation-pending.png');askGate.resolve();await prepared.work;await pause(700);
    const handoff=!view.contentEl.querySelector('.send-to-t3-send-preview')&&view.editor.getValue().split('<!-- t3-inline:start:').length-1===1;
    events.push({case:'ask',pendingBeforePreparation:askPending,handoffToOneResponse:handoff,responseBeforeLaterParagraph:view.editor.getValue().indexOf('t3-inline:end:')<view.editor.getValue().indexOf('Later paragraph.')});
    await capture('ask-real-block-handoff.png');if(!handoff)throw Error('Ask did not hand off to one response block.');
    const job=manager.activeFor(file.path)[0];
    if(!view.editor.getValue().includes('Immediate Send · Sending'))throw Error('Prepared response switched to Working before dispatch.');
    dispatchGate.resolve();await asking;
    (manager as any).receive(job,{kind:'snapshot',snapshot:{snapshotSequence:1,thread:{title:'Created thread title',messages:[{id:job.messageId,role:'user',text:'Explain',turnId:'turn',streaming:false,createdAt:job.createdAt},{id:'reply',role:'assistant',text:'Visible streamed output.\n\n',turnId:'turn',streaming:true}],activities:[],latestTurn:{turnId:'turn',state:'running',messageId:job.messageId,requestedAt:job.createdAt},session:{status:'running',activeTurnId:'turn'}}}});
    await pause(700);
    const live=view.contentEl.querySelectorAll('.callout[data-callout="t3-progress"]');
    const continued=live.length===1&&live[0].textContent?.includes('Created thread title · Working')&&live[0].textContent?.includes('Visible streamed output.');
    events.push({case:'thread-created',oneLiveBoxWithThreadTitleAndOutput:continued});
    await capture('thread-created-streaming.png');if(!continued)throw Error('Sending did not become one live response with the canonical thread title.');
    await manager.deliveryFailed(job);
    await view.save();
    nativeResponses(this.app).dispose();
    write('RESULT.json',{scope:'Real Obsidian desktop editor; synthetic delayed preparation, cancelled before dispatch. No real delivery, Sync, or native mobile coverage.',events,threadsCreated:[],allPassed:true});
  }
}
