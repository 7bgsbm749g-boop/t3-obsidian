import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installStreamBlockControls} from '../stream-block-controls';
import {installResponsePresentation} from '../response-presentation';
import {renderInlineTurn} from '../inline-thread';
const fs=require('node:fs'),path=require('node:path');
const ids=['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'];
/** Native editor fixture with no credentials, provider dispatch or Sync. */
export default class InterruptedStreamCloseLab extends Plugin {
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated synthetic lab is required.');
    const evidence=(name:string,value:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
    const error=(error:unknown)=>evidence('error.json',{message:String(error),stack:(error as Error).stack});
    const manager=nativeResponses(this.app),events:any[]=[];
    const {EditorState}=require('@codemirror/state') as typeof import('@codemirror/state');
    this.registerEditorExtension([hiddenInlineMarkerExtension(),EditorState.transactionFilter.of(tr=>manager.filter(tr))]);
    this.register(installResponsePresentation(document,setIcon));
    this.register(installStreamBlockControls(this.app,document,setIcon,error));
    this.register(()=>manager.dispose());
    this.app.workspace.onLayoutReady(()=>void(async()=>{
      const render=(title:string,phase:'complete'|'running'|'interrupted')=>renderInlineTurn({title,messages:phase==='running'?[]:[{id:title,turnId:title,role:'assistant',text:phase==='complete'?'Completed answer stays.':'Retained interrupted output.',streaming:false}],activities:[],latestTurn:{turnId:title,state:phase==='complete'?'completed':phase}} as any,title,title,phase,'collapse',undefined,undefined,undefined,undefined,{startedAt:'2026-10-24T10:00:00Z',...(phase!=='running'?{finishedAt:'2026-10-24T10:00:27Z'}:{})});
      const name='Interrupted stream close.md',saved='Ordinary before.\n\n'+render('Saved interrupted','interrupted').replace('[!t3-progress]+','[!t3-progress]-')+'\n'+render('Saved completed','complete')+'\n'+responseAnchor(ids[0])+'\n\n'+responseAnchor(ids[1])+'\n\nOrdinary after.\n';
      const file=await this.app.vault.create(name,saved),leaf=this.app.workspace.getLeaf(false);
      await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:name,mode:'source',source:false},active:true});
      for(const [index,id] of ids.entries())await manager.receive({coordinated:true,owner:'synthetic',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:3,id,vaultId:'synthetic',host:{environmentId:'synthetic',workspaceRoot:(this.app.vault.adapter as any).getFullPath(''),directory:'.obsidian/synthetic'},notePath:name,threadId:`thread-${index}`,messageId:id,projectId:'synthetic',threadEnvironmentId:'synthetic',initialHash:'initial',createdAt:'2026-10-24T10:00:00Z'},state:{requestHash:'synthetic',accepted:true,notePath:name,status:'running',hashes:[],body:render(index?'Unsaved interrupted preview':'Active stream',index?'interrupted':'running'),updatedAt:''}});
      const snapshot=async(label:string)=>{
        const view=leaf.view as MarkdownView;
        evidence('state.json',{label,saved:view.getViewData(),display:view.editor.getValue(),disk:await this.app.vault.read(file),events,folds:Array.from(view.contentEl.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]')).map(fold=>{
          const actions=fold.closest('.cm-embed-block')?.querySelector(':scope > .embed-actions'),button=actions?.querySelector<HTMLElement>('.send-to-t3-stream-close');
          return {key:fold.querySelector<HTMLElement>('.send-to-t3-fold-key')?.dataset.t3Fold,text:fold.innerText,close:button?{hidden:button.hidden,label:button.getAttribute('aria-label')}:null};
        })});
      };
      for(const type of ['click','keydown'])this.registerDomEvent(document,type as any,(event:any)=>{events.push({type,trusted:event.isTrusted,key:event.key,target:event.target?.className});if(events.length>100)events.shift();},true);
      let working=false,cleaned=false;
      const timer=setInterval(()=>{if(working||cleaned)return;working=true;void(async()=>{
        const mailbox=path.join(root,'action.json');if(fs.existsSync(mailbox)){
          const action=JSON.parse(fs.readFileSync(mailbox,'utf8'));fs.unlinkSync(mailbox);
          if(action.kind==='capture'&&/^[a-z0-9-]+$/.test(action.name)){
            await snapshot(action.name);fs.copyFileSync(path.join(root,'state.json'),path.join(root,`${action.name}.json`));
            const frame=await require('electron').remote.getCurrentWindow().webContents.capturePage();fs.writeFileSync(path.join(root,`${action.name}.png`),frame.toPNG());
          }
          if(action.kind==='cleanup'){
            manager.dispose();await this.app.vault.delete(file);
            for(const name of ['Reference.md','Virtual.md']){const extra=this.app.vault.getFileByPath(name);if(extra)await this.app.vault.delete(extra);}
            evidence('cleanup.json',{notesAbsent:[name,'Reference.md','Virtual.md'].every(note=>!this.app.vault.getAbstractFileByPath(note)),threadsCreated:[]});cleaned=true;return;
          }
        }
        manager.refresh();await snapshot('native-observation');
      })().catch(error).finally(()=>{working=false;});},200);
      this.register(()=>clearInterval(timer));await snapshot('ready');
    })().catch(error));
  }
}
