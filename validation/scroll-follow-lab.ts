import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {installStreamBlockControls} from '../stream-block-controls';
import {installActivityShine} from '../activity-shine';
import {responseHeightAttribute,responseHeightProperty} from '../response-height';
const fs=require('node:fs/promises'),path=require('node:path');
/** Synthetic setup and observation only. Activation and manual cancellation
 * require trusted native input. No Sync or external work is dispatched. */
export default class ScrollFollowLab extends Plugin {
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    await fs.access(path.join(root,'ISOLATED-NATIVE-LAB'));
    const manager=nativeResponses(this.app);
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    const {EditorState}=require('@codemirror/state');
    this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>manager.filter(tr)));
    this.register(installResponsePresentation(document,setIcon));this.register(installActivityShine(document));this.register(()=>manager.dispose());
    this.register(installStreamBlockControls(this.app,document,setIcon,error=>void fs.writeFile(path.join(root,'error.json'),String(error))));
    this.app.workspace.onLayoutReady(()=>void(async()=>{
      let config:{large?:boolean}={};try{config=JSON.parse(await fs.readFile(path.join(root,'case.json'),'utf8'));}catch(error:any){if(error.code!=='ENOENT')throw error;}
      const prefix=config.large?Array.from({length:1000},(_,i)=>`${i%25===0?'## Section '+i+'\n\n':''}Reference paragraph ${i+1}. A synthetic design review describes navigation, spacing, typography, comparison cards, filters, and layout alternatives. `+'This text stays unchanged while the response grows. '.repeat(2)+'\n\n').join(''):'';
      const id=crypto.randomUUID(),file=this.app.vault.getFileByPath('Virtual.md')!,saved=`# Scroll follow fixture\n\n${prefix}${responseAnchor(id)}\n\n${config.large?'\n\n':'Ordinary after.\n'}`;
      await this.app.vault.modify(file,saved);
      const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
      await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
      let lines=config.large?1200:35,revision=0;
      const record:any={coordinated:true,owner:'fixture',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:3,id,vaultId:'fixture',host:{environmentId:'fixture',workspaceRoot:(this.app.vault.adapter as any).getFullPath(''),directory:'.obsidian/fixture'},notePath:file.path,threadId:'fixture-thread',messageId:id,projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:'initial',createdAt:new Date().toISOString()},state:{accepted:true,notePath:file.path,status:'running',hashes:[],body:'',updatedAt:''}};
      const update=async()=>{record.revision++;record.state.body=`> [!t3-progress]+ Scroll follow · Working ${revision} <span class="send-to-t3-fold-key" data-t3-fold="fixture:active"></span>\n>\n`+Array.from({length:lines},(_,i)=>`> Paragraph ${i+1}. ${config.large?'Synthetic streamed design detail. The layout uses a navigation panel, comparison cards, visible actions, balanced spacing, and distinct sections to test long wrapped paragraphs.':'Synthetic streaming text.'}\n>\n`).join('');await manager.receive(record);};
      await update();
      const snapshots:any[]=[],events:any[]=[];
      const observe=(kind:string,extra:any={})=>{
        const cm=((leaf.view as MarkdownView).editor as any)?.cm;if(!cm)return;
        events.push({at:performance.now(),kind,scrollTop:cm.scrollDOM.scrollTop,scrollHeight:cm.scrollDOM.scrollHeight,clientHeight:cm.scrollDOM.clientHeight,
          documentLength:cm.state.doc.length,cursor:cm.state.selection.main.head,focused:cm.hasFocus,scrolledToBottom:cm.viewState?.scrolledToBottom,viewport:cm.viewport,
          nativeBlocks:cm.scrollDOM.querySelectorAll('.cm-embed-block').length,heightGuard:cm.contentDOM.hasAttribute(responseHeightAttribute),...extra});
        if(events.length>5000)events.shift();
      };
      const cm=((leaf.view as MarkdownView).editor as any).cm;
      for(const name of ['scroll','scrollend','wheel','touchstart','touchmove','touchcancel','focusin','focusout'])this.registerDomEvent(cm.scrollDOM,name as any,(event:Event)=>observe(name,{trusted:event.isTrusted}));
      const snapshot=async(label:string)=>{
        const view=leaf.view as MarkdownView,cm=(view.editor as any).cm,scroller=view.getMode()==='preview'?view.contentEl.querySelector('.markdown-preview-view'):cm?.scrollDOM,fold=scroller?.querySelector('.callout[data-callout="t3-progress"]');
        const rect=(el:Element|null)=>{const r=el?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}:null;};
        const buttons=Array.from(scroller?.querySelectorAll('.send-to-t3-stream-follow')??[]).map((element:any)=>{const el=element as HTMLElement;return {hidden:el.hidden,pressed:el.getAttribute('aria-pressed'),label:el.getAttribute('aria-label'),color:getComputedStyle(el).color,filter:getComputedStyle(el).filter,box:rect(el),actions:el.parentElement?.className};});
        observe(label);snapshots.push({label,appVersion:require('obsidian').apiVersion,mode:view.getMode(),documentLength:cm?.state.doc.length,cursorLine:cm?.state.doc.lineAt(cm.state.selection.main.head).text,focused:cm?.hasFocus,
          activeElement:(document.activeElement as HTMLElement)?.className,scrollTop:scroller?.scrollTop,scrollHeight:scroller?.scrollHeight,clientHeight:scroller?.clientHeight,
          heightGuard:cm?.contentDOM.hasAttribute(responseHeightAttribute),heightFloor:cm?.scrollDOM.style.getPropertyValue(responseHeightProperty),scrolledToBottom:cm?.viewState?.scrolledToBottom,
          scroller:rect(scroller),fold:rect(fold),buttons,savedUnchanged:view.getViewData()===saved,diskUnchanged:await this.app.vault.read(file)===saved,selection:cm?.state.selection.toJSON()});
        await fs.writeFile(path.join(root,'scroll-follow.json'),JSON.stringify(snapshots,null,2));
        await fs.writeFile(path.join(root,'events.json'),JSON.stringify(events,null,2));
        const image=await require('@electron/remote').getCurrentWebContents().capturePage();await fs.writeFile(path.join(root,`snapshot-${snapshots.length}.png`),image.toPNG());
      };
      let busy=false,finished=false;
      this.registerInterval(window.setInterval(()=>{if(busy||finished)return;busy=true;void(async()=>{
        const mailbox=path.join(root,'control.json');let command:any;try{command=JSON.parse(await fs.readFile(mailbox,'utf8'));}catch(error:any){if(error.code==='ENOENT')return;throw error;}await fs.unlink(mailbox);
        if(command.kind==='cleanup'){
          observe('cleanup');await fs.writeFile(path.join(root,'events.json'),JSON.stringify(events,null,2));manager.dispose();await leaf.detach();
          for(const name of ['Virtual.md','Reference.md']){const item=this.app.vault.getFileByPath(name);if(item)await this.app.vault.trash(item,true);}
          finished=true;await fs.writeFile(path.join(root,'cleanup.json'),JSON.stringify({temporaryNotePaths:['Virtual.md','Reference.md'],remainingMarkdown:this.app.vault.getMarkdownFiles().map(item=>item.path),createdT3Threads:[]},null,2));return;
        }
        if(command.kind==='grow'||command.kind==='reflow'){lines=Math.max(0,Math.min(2500,lines+(command.lines??15)));if(command.kind==='reflow')revision++;observe('before-growth');await update();observe('after-growth');}
        if(command.kind==='burst'){for(let i=0;i<Math.min(12,command.count??8);i++){lines=Math.min(2500,lines+(command.lines??2));observe('before-burst-growth',{index:i});await update();observe('after-burst-growth',{index:i});await new Promise(resolve=>setTimeout(resolve,Math.max(25,command.interval??120)));}}
        if(command.kind==='mode'){await leaf.setViewState({type:'markdown',state:{file:file.path,mode:command.mode,source:false}});manager.refresh();}
        if(command.waitMs)await new Promise(resolve=>setTimeout(resolve,Math.min(5000,command.waitMs)));
        // The observation request is separate from setup so native layout can
        // settle before measurement; it never clicks or enables follow.
        await snapshot(command.kind);
      })().catch(error=>fs.writeFile(path.join(root,'error.json'),String(error.stack))).finally(()=>{busy=false;});},150));
      await fs.writeFile(path.join(root,'ready.json'),JSON.stringify({id,savedCharacters:saved.length,displayCharacters:cm.state.doc.length,responseParagraphs:lines,large:!!config.large}));
    })().catch(error=>fs.writeFile(path.join(root,'error.json'),String(error.stack))));
  }
}
