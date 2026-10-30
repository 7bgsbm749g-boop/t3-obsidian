import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {contentHash} from '../completion';
import {renderResponseToolGroup} from '../response-tools';
import {installStreamBlockControls} from '../stream-block-controls';
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
/** Interactive unsynced fixture. Native input comes from the driver; this
 * mailbox only sets up test state and records application-owned observations. */
export default class StreamInteractionLab extends Plugin {
  async onload(){
    const adapter=this.app.vault.adapter as any,fs=adapter.fsPromises;
    const root=adapter.getFullPath('').replace(/[\\/]vault[\\/]?$/,'');
    const path={join:(...parts:string[])=>parts.join('/')};
    const exists=async(p:string)=>{try{await fs.stat(p);return true;}catch{return false;}};
    if(!await exists(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('Isolated fixture required.');
    await fs.writeFile(path.join(root,'boot.json'),JSON.stringify({body:document.body.className}));
    const manager=nativeResponses(this.app);
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    const {EditorState}=require('@codemirror/state');
    this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>manager.filter(tr)));
    this.register(installResponsePresentation(document));this.register(installStreamBlockControls(this.app,document,setIcon,error=>{throw error;}));this.register(()=>manager.dispose());
    this.registerEvent(this.app.vault.on('rename',(file,before)=>manager.renamed(before,file.path)));
    this.app.workspace.onLayoutReady(()=>void (async()=>{
      const saved=`# Interaction fixture\n\nOrdinary before.\n\n${responseAnchor(id)}\n\nOrdinary after.\n`;
      const file=this.app.vault.getFileByPath('Virtual.md')!;
      await this.app.vault.modify(file,saved);
      const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
      await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
      let view=leaf.view as MarkdownView;
      const tools=renderResponseToolGroup({id:'caret-tools',turnId:'turn',tools:[{id:'tool',turnId:'turn',key:'tool',status:'completed',label:'Read synthetic output',activeLabel:'Read output',icon:'file-text',action:'read',sequence:1,output:'Synthetic retained output.\n'.repeat(20)}]});
      const body=['> [!t3-progress]+ Interaction · Working','> <span class="send-to-t3-fold-key" data-t3-fold="fixture:active"></span>','>','> Progress content with **bold text**.','>',...tools.split('\n').map(line=>'> '+line),'>','> Thinking'].join('\n');
      const record:any={coordinated:true,owner:'host',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:3,id,vaultId:'fixture',host:{environmentId:'fixture',workspaceRoot:(this.app.vault.adapter as any).getFullPath(''),directory:'.obsidian/fixture'},notePath:file.path,threadId:'fixture-thread',messageId:id,projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:'initial',createdAt:new Date().toISOString()},state:{accepted:true,notePath:file.path,status:'running',hashes:[],body,updatedAt:''}};
      const events:any[]=[];
      const snapshot=async(label:string)=>{
        view=leaf.view as MarkdownView;
        const cm=(view.editor as any).cm;
        const visible:string[]=[];
        const walk=document.createTreeWalker(view.contentEl,NodeFilter.SHOW_TEXT);let node:Node|null;
        while(node=walk.nextNode()){
          const range=document.createRange();range.selectNodeContents(node);
          if(Array.from(range.getClientRects()).some(r=>r.width&&r.height)&&getComputedStyle(node.parentElement!).visibility!=='hidden')visible.push(node.textContent??'');
        }
        events.push({label,path:file.path,saved:view.getViewData(),editor:view.editor.getValue(),cm:cm?.state.doc.toString(),visible:visible.join('\n'),raw:(view as any).currentMode?.get(),previewHTML:(view as any).previewMode?.containerEl?.innerHTML,disk:await this.app.vault.read(file),selection:view.editor.getSelection(),caret:cm?.state.selection.main.head,folds:view.contentEl.querySelectorAll('.callout[data-callout="t3-progress"]').length,mode:view.getMode(),focused:cm?.hasFocus,active:document.activeElement?.className});
        await fs.writeFile(path.join(root,'interaction.json'),JSON.stringify(events,null,2));
        if(!document.body.classList.contains('emulate-mobile')){const remote=require('electron').remote??require('@electron/remote'),frame=await remote.getCurrentWindow().webContents.capturePage();await fs.writeFile(path.join(root,`frame-${events.length}.png`),frame.toPNG());}
      };
      await manager.receive(record);await snapshot('ready');
      for(const name of ['pointerdown','pointerup','focusin','focusout','touchstart','touchend'])this.registerDomEvent(document,name as any,()=>{setTimeout(()=>void snapshot(name),100);});
      this.registerDomEvent(document,'keydown',event=>{if(event.isTrusted)setTimeout(()=>void snapshot('trusted-key:'+event.key),150);});
      let working=false;
      this.registerInterval(window.setInterval(()=>{
        manager.refresh();if(working)return;
        working=true;
        void (async()=>{
          const mailbox=path.join(root,'control.json');if(!await exists(mailbox))return;
          const command=JSON.parse(await fs.readFile(mailbox,'utf8'));await fs.unlink(mailbox);
          if(command.kind==='cleanup'){
            manager.cancel(file.path);
            for(const note of [...this.app.vault.getMarkdownFiles()])await this.app.vault.delete(note);
            await fs.writeFile(path.join(root,'cleanup.json'),JSON.stringify({temporaryThreadIds:[],remainingThreadIds:[],remainingNotes:this.app.vault.getMarkdownFiles().map(note=>note.path)}));return;
          }
          if(command.kind==='caret-before'||command.kind==='caret-after'){
            const cm=(view.editor as any).cm,text=cm.state.doc.toString(),at=command.kind==='caret-before'?text.indexOf('Ordinary before.')+'Ordinary before.'.length:text.indexOf('Ordinary after.');
            cm.dispatch({selection:{anchor:at},scrollIntoView:true});cm.focus();
          }
          if(command.kind==='mode'){await leaf.setViewState({type:'markdown',state:{file:file.path,mode:command.mode,source:false}});view=leaf.view as MarkdownView;manager.refresh();}
          if(command.kind==='update'){record.revision++;record.state.body+='\n\nSubsequent stream update.';await manager.receive(record);}
          if(command.kind==='rename'){await this.app.fileManager.renameFile(file,command.path);}
          if(command.kind==='finish'){
            const before=await this.app.vault.read(file),after=before.replace(responseAnchor(id),'Final interaction answer.');
            manager.prepare(file.path,before,after,[id]);await this.app.vault.modify(file,after);manager.committed(file.path,after,[id]);manager.cancel(file.path);
            record.revision++;record.state={...record.state,notePath:file.path,status:'complete',finalBody:'Final interaction answer.',finalSaved:true,cleanupComplete:true,delivery:{commitId:'fixture',hash:contentHash(after),verifiedOnHost:true,observedBy:[]}};await manager.receive(record);
          }
          await view.save();await snapshot(command.kind);
        })().catch(error=>fs.writeFile(path.join(root,'interaction-error.json'),String(error.stack))).finally(()=>{working=false;});
      },150));
    })().catch(error=>fs.writeFile(path.join(root,'error.json'),String(error.stack))));
  }
}
