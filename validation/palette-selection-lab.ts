import {Plugin,MarkdownView} from 'obsidian';
import SendToT3Code from '../main';
import {installPaletteChat} from '../palette-chat';
import {InlineChatManager,type InlineJob} from '../inline-chat';
import {loadSmartSend} from '../smart-send';
import {hiddenInlineMarkerExtension} from '../inline-markers';

const fs=require('node:fs'),path=require('node:path');
const note='Palette selection fixture.md';
const passage='This repeated passage is the selected source.';
const original=`# Palette selection fixture\n\n${passage}\n\nBetween the two copies.\n\n${passage}\n\nLater paragraph must stay below the response.\n\nEnd of note.\n`;

/** Production palette capture, Ask routing, reservation, and stream reducer in
 * a real editor. Provider snapshots are synthetic; no connection or dispatch. */
export default class PaletteSelectionLab extends Plugin {
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated synthetic vault is required.');
    const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
    const fail=(error:unknown)=>write('ERROR.json',{error:String(error),stack:(error as Error).stack});
    const subject=new SendToT3Code(this.app,this.manifest) as any;
    subject.settings={inlineStreaming:{enabled:true},noteThreads:[]};
    const smart=loadSmartSend(undefined),chat=new InlineChatManager(this.app,'palette-selection-lab',async()=>undefined);
    subject.inlineChat=chat;subject.recoverSmartReplies=async()=>{};subject.smartData=()=>smart;
    const events:unknown[]=[];let captured:any,job:InlineJob|undefined,sequence=0,screenshotStarted=false;
    chat.prepare=async next=>{job=next;next.threadId='synthetic-thread';next.turnId='synthetic-turn';};
    chat.start=()=>{
      const timer=window.setInterval(()=>{
        if(!job)return;
        const text='The response streams directly below the second selected passage. '.repeat(++sequence);
        (chat as any).receive(job,{kind:'snapshot',snapshot:{snapshotSequence:sequence,thread:{messages:[{id:'synthetic-answer',role:'assistant',text,turnId:'synthetic-turn',streaming:true}],activities:[],latestTurn:{turnId:'synthetic-turn',state:'running'},session:{status:'running',activeTurnId:'synthetic-turn'}}}});
        if(sequence===3)window.clearInterval(timer);
      },400);
      this.register(()=>window.clearInterval(timer));
    };
    subject.sendChat=async(_prompt:unknown,_note:unknown,options:any)=>options.onPrepared({id:crypto.randomUUID(),title:'Synthetic selection answer'});
    subject.openChatWithNote=(source:unknown,prompt:unknown,context:any)=>{
      captured={anchor:context.anchor,insertion:context.insertion,referenceSelection:context.referenceSelection,prompt};
      return subject.sendInlineChat(prompt,source,context,{newThread:true});
    };
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    this.register(()=>chat.dispose());
    this.addCommand({id:'cleanup',name:'Clean up palette selection fixture',callback:()=>void(async()=>{
      chat.dispose();
      for(const leaf of this.app.workspace.getLeavesOfType('markdown'))if([note,'Reference.md','Virtual.md'].includes((leaf.view as MarkdownView).file?.path??''))leaf.detach();
      for(const name of [note,'Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
      write('CLEANUP.json',{threadsCreated:[],remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),notesAbsent:[note,'Reference.md','Virtual.md'].every(name=>!this.app.vault.getAbstractFileByPath(name))});
    })().catch(fail)});
    this.app.workspace.onLayoutReady(()=>void(async()=>{
      const file=await this.app.vault.create(note,original),leaf=this.app.workspace.getLeaf(false);
      await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:note,mode:'source',source:false},active:true});
      const view=leaf.view as MarkdownView,start=original.lastIndexOf(passage);
      view.editor.setSelection(view.editor.offsetToPos(start),view.editor.offsetToPos(start+passage.length));view.editor.focus();
      const hook=installPaletteChat(this.app,(prompt,selection,choose,source)=>subject.openPaletteAction(prompt,selection,choose,source),{captureSource:()=>subject.capturePaletteSource(),onError:fail});
      this.register(()=>hook.dispose());
      for(const type of ['keydown','click'])this.registerDomEvent(document,type as any,(event:any)=>events.push({type,key:event.key,trusted:event.isTrusted,target:event.target?.className}));
      this.registerInterval(window.setInterval(()=>{
        const display=view.editor.getValue(),at=job?display.indexOf(`<!-- t3-inline:start:${job.id} -->`):-1;
        const rendered=view.contentEl.querySelector<HTMLElement>('.cm-content'),visible=rendered?.innerText??'',box=rendered?.getBoundingClientRect();
        write('STATE.json',{scope:'Real desktop palette and editor; production capture, Ask routing, reservation and stream reducer; synthetic provider snapshots; no external dispatch, Sync or native mobile coverage.',original,display,disk:fs.readFileSync((this.app.vault.adapter as any).getFullPath(note),'utf8'),selection:view.editor.getSelection(),captured,jobId:job?.id,sequence,visible,box:box&&{width:box.width,height:box.height},paletteText:document.querySelector('.prompt')?.textContent,checks:{secondOccurrenceCaptured:captured?.anchor?.start===start,responseBelowSelection:at>start+passage.length,responseBeforeLaterParagraph:at>=0&&at<display.indexOf('Later paragraph'),streamVisible:visible.includes('The response streams directly below')},events,threadsCreated:[]});
        if(sequence===3&&visible.includes('The response streams directly below')&&!screenshotStarted){
          screenshotStarted=true;
          const remote=require('electron').remote??require('@electron/remote');
          void remote.getCurrentWindow().webContents.capturePage().then((image:any)=>fs.writeFileSync(path.join(root,'stream-rendered.png'),image.toPNG())).catch(fail);
        }
      },250));
      write('READY.json',{note,selection:view.editor.getSelection(),start,paletteStatus:hook.status});
    })().catch(fail));
  }
}
