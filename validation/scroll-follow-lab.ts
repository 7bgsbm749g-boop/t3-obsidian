import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {installStreamBlockControls} from '../stream-block-controls';
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
    this.register(installResponsePresentation(document));this.register(()=>manager.dispose());
    this.register(installStreamBlockControls(this.app,document,setIcon,error=>void fs.writeFile(path.join(root,'error.json'),String(error))));
    this.app.workspace.onLayoutReady(()=>void(async()=>{
      const id=crypto.randomUUID(),file=this.app.vault.getFileByPath('Virtual.md')!,saved=`# Scroll follow fixture\n\n${responseAnchor(id)}\n\nOrdinary after.\n`;
      await this.app.vault.modify(file,saved);
      const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
      await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
      let lines=35;
      const record:any={coordinated:true,owner:'fixture',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:3,id,vaultId:'fixture',host:{environmentId:'fixture',workspaceRoot:(this.app.vault.adapter as any).getFullPath(''),directory:'.obsidian/fixture'},notePath:file.path,threadId:'fixture-thread',messageId:id,projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:'initial',createdAt:new Date().toISOString()},state:{accepted:true,notePath:file.path,status:'running',hashes:[],body:'',updatedAt:''}};
      const update=async()=>{record.revision++;record.state.body=`> [!t3-progress]+ Scroll follow · Working <span class="send-to-t3-fold-key" data-t3-fold="fixture:active"></span>\n>\n`+Array.from({length:lines},(_,i)=>`> Paragraph ${i+1}. Synthetic streaming text.\n>\n`).join('');await manager.receive(record);};
      await update();
      const snapshots:any[]=[];
      const snapshot=async(label:string)=>{
        const view=leaf.view as MarkdownView,cm=(view.editor as any).cm,scroller=view.getMode()==='preview'?view.contentEl.querySelector('.markdown-preview-view'):cm?.scrollDOM,fold=scroller?.querySelector('.callout[data-callout="t3-progress"]');
        const rect=(el:Element|null)=>{const r=el?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}:null;};
        const buttons=Array.from(scroller?.querySelectorAll('.send-to-t3-stream-follow')??[]).map((element:any)=>{const el=element as HTMLElement;return {hidden:el.hidden,pressed:el.getAttribute('aria-pressed'),label:el.getAttribute('aria-label'),color:getComputedStyle(el).color,filter:getComputedStyle(el).filter,box:rect(el),actions:el.parentElement?.className};});
        snapshots.push({label,mode:view.getMode(),scrollTop:scroller?.scrollTop,scroller:rect(scroller),fold:rect(fold),buttons,savedUnchanged:view.getViewData()===saved,diskUnchanged:await this.app.vault.read(file)===saved,selection:cm?.state.selection.toJSON()});
        await fs.writeFile(path.join(root,'scroll-follow.json'),JSON.stringify(snapshots,null,2));
        const image=await require('@electron/remote').getCurrentWebContents().capturePage();await fs.writeFile(path.join(root,`snapshot-${snapshots.length}.png`),image.toPNG());
      };
      let busy=false;
      this.registerInterval(window.setInterval(()=>{if(busy)return;busy=true;void(async()=>{
        manager.refresh();const mailbox=path.join(root,'control.json');let command:any;try{command=JSON.parse(await fs.readFile(mailbox,'utf8'));}catch(error:any){if(error.code==='ENOENT')return;throw error;}await fs.unlink(mailbox);
        if(command.kind==='grow'){lines+=command.lines??15;await update();}
        if(command.kind==='mode'){await leaf.setViewState({type:'markdown',state:{file:file.path,mode:command.mode,source:false}});manager.refresh();}
        // The observation request is separate from setup so native layout can
        // settle before measurement; it never clicks or enables follow.
        await snapshot(command.kind);
      })().catch(error=>fs.writeFile(path.join(root,'error.json'),String(error.stack))).finally(()=>{busy=false;});},150));
      await fs.writeFile(path.join(root,'ready.json'),JSON.stringify({id,saved}));
    })().catch(error=>fs.writeFile(path.join(root,'error.json'),String(error.stack))));
  }
}
