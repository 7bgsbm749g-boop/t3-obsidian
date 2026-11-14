import {Plugin,MarkdownView} from 'obsidian';
import Main from '../../src/app/main';
import {InlineChatManager,type InlineJob} from '../../src/conversations/inline-chat';
import {containerBody} from '../../src/responses/response-container';
import {hiddenInlineMarkerExtension} from '../../src/conversations/inline-markers';

/** Real CodeMirror selection and reservation; the source finalizes during a
 * synthetic destination lookup. No T3 connection, dispatch, or Sync. */
export default class SelectionFinalSaveLab extends Plugin {
  async onload(){
    const fs=require('node:fs'),path=require('node:path'),root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('Use the isolated native lab builder.');
    const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
    const fail=(error:unknown)=>write('ERROR.json',{message:String(error),stack:(error as Error).stack});
    const name='Selection final save.md',parent=crypto.randomUUID(),selected='Selected generated sentence.',body=selected+'\nRemaining line in the same paragraph.\n\nLater paragraph.';
    const subject=new Main(this.app,this.manifest) as any,manager=new InlineChatManager(this.app,'selection-final-save-lab',async()=>undefined);
    subject.settings={inlineStreaming:{enabled:true,intermediateMode:'collapse'},noteThreads:[]};subject.inlineChat=manager;
    this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(()=>manager.dispose());
    let job:InlineJob|undefined;
    manager.prepare=async next=>{job=next;next.threadId='synthetic-thread';next.turnId='synthetic-run';};
    manager.start=()=>{if(job)(manager as any).receive(job,{kind:'snapshot',snapshot:{thread:{messages:[{id:'answer',role:'assistant',text:'New answer below the selected line.',turnId:'synthetic-run',streaming:true}],activities:[],latestTurn:{turnId:'synthetic-run',state:'running'},session:{status:'running',activeTurnId:'synthetic-run'}}}});};
    this.addCommand({id:'cleanup',name:'Clean up selection final save fixture',callback:()=>void(async()=>{
      manager.dispose();for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();
      for(const item of [name,'Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(item);if(file)await this.app.vault.delete(file,true);}
      write('CLEANUP.json',{remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),threadsCreated:[],syncConfigured:false});
    })().catch(fail)});
    this.app.workspace.onLayoutReady(()=>void(async()=>{
      const initial='Before.\n\n'+containerBody(parent,'**T3 · Working for**\n\n'+body),file=await this.app.vault.create(name,initial),leaf=this.app.workspace.getLeaf(false);
      await leaf.openFile(file);const view=leaf.view as MarkdownView,at=initial.indexOf(selected);
      view.editor.setSelection(view.editor.offsetToPos(at),view.editor.offsetToPos(at+selected.length));
      const captured=subject.capturePaletteSource().context.editor;
      subject.sendChat=async(_prompt:unknown,_note:unknown,options:any)=>{view.editor.setValue('Before.\n\n'+body);await options.onPrepared({id:crypto.randomUUID(),title:'Independent answer'});};
      await subject.sendInlineChat('Explain the selected sentence.',{path:name},captured,{newThread:true});
      let attempts=0;const timer=window.setInterval(()=>{
        const display=view.editor.getValue(),start=display.indexOf('<!-- t3-inline:start:'),end=display.indexOf('<!-- t3-inline:end:'),visible=view.contentEl.innerText;
        const checks={afterSelection:start>display.indexOf(selected)+selected.length,beforeRemainingLine:end>=0&&end<display.indexOf('Remaining line'),answerVisible:visible.includes('New answer below the selected line.')};
        write('RESULT.json',{scope:'Real native CodeMirror editor, production palette capture and reservation, synthetic source final save and provider stream; no external dispatch or Sync.',checks,display,visible});
        if(Object.values(checks).every(Boolean)||++attempts>=20)window.clearInterval(timer);
      },250);this.register(()=>window.clearInterval(timer));
    })().catch(fail));
  }
}
