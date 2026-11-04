import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {CodebaseBridge} from '../../src/projects/codebase-native';
import {nativeResponses} from '../../src/responses/native-response-manager';
import {deviceFinalNoteIO} from '../../src/conversations/inline-note-io';
import {responseAnchor} from '../../src/responses/native-response-projection';
import {hiddenInlineMarkerExtension} from '../../src/conversations/inline-markers';
import {installStreamBlockControls} from '../../src/responses/stream-block-controls';
import {installResponsePresentation} from '../../src/responses/response-presentation';
import {renderInlineTurn} from '../../src/conversations/inline-thread';
import {renderResponseToolGroup} from '../../src/responses/response-tools';
import type {ResponseRecord} from '../../src/responses/response-record';
const fs=require('node:fs'),path=require('node:path');
const ids=['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'];
/** Isolated native project editor; synthetic streams, no credentials or dispatch. */
export default class CodebaseResponseSaveLab extends Plugin {
  async onload(){this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>{
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    fs.writeFileSync(path.join(root,'error.json'),JSON.stringify({error:String(error),stack:error.stack}));
  }));}
  async run(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated lab is required.');
    const evidence=(name:string,data:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2)+'\n');
    const external=path.join(root,'external');fs.mkdirSync(external);const projectFile=path.join(external,'response.md');
    const initial='Ordinary before.\n\n'+responseAnchor(ids[0])+'\n\n'+responseAnchor(ids[1])+'\n\nOrdinary after.\n';
    fs.writeFileSync(projectFile,initial);
    const scope={environmentId:'synthetic',projectId:'synthetic',title:'Synthetic project',root:external};
    const manager=nativeResponses(this.app),events:unknown[]=[];
    const {EditorState}=require('@codemirror/state') as typeof import('@codemirror/state');
    this.registerEditorExtension([hiddenInlineMarkerExtension(),EditorState.transactionFilter.of(tr=>manager.filter(tr))]);
    this.register(installResponsePresentation(document,setIcon));
    this.register(installStreamBlockControls(this.app,document,setIcon,error=>evidence('control-error.json',{error:String(error)})));
    const bridge=new CodebaseBridge(this.app,this,{read:async()=>fs.readFileSync(projectFile,'utf8'),write:async(_scope,_file,text)=>{fs.writeFileSync(projectFile,text);},list:async()=>({entries:[{path:'response.md',kind:'file'}],truncated:false}),search:async()=>[],resource:async()=>({url:'',expiresAt:0})},()=>[],'synthetic-response-save',{environments:()=>['synthetic'],load:()=>undefined,save:async()=>{}});
    await bridge.install();this.register(()=>{manager.dispose();bridge.dispose();});
    const item=bridge.register(scope,'response.md');let leaf=this.app.workspace.getLeaf(false);await bridge.open(item,leaf);
    const render=(title:string,phase:'running'|'interrupted')=>renderInlineTurn({title,messages:[{id:title,turnId:title,role:'assistant',text:'Retained response text.',streaming:false}],activities:[],latestTurn:{turnId:title,state:phase}} as any,title,title,phase,'collapse',undefined,undefined,undefined,undefined,{startedAt:'2026-11-02T12:00:00Z',...(phase==='interrupted'?{finishedAt:'2026-11-02T12:00:27Z'}:{})});
    const tool=renderResponseToolGroup({id:'tool',turnId:'turn',tools:[{id:'command',turnId:'turn',key:'command',status:'completed',label:'Ran command',activeLabel:'Running command',icon:'terminal',action:'command',sequence:1,output:'Retained canonical tool output. '.repeat(100)}]});
    const body=(phase:'running'|'interrupted')=>render('Project response',phase).replace('\n>\n','\n>\n> '+tool+'\n>\n');
    const record=(id:string,index:number):ResponseRecord=>({coordinated:true,owner:'synthetic',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:4,id,localOnly:true,nativeProjection:true,responseContainer:true,vaultId:'synthetic',host:{environmentId:'synthetic',workspaceRoot:external,directory:'.synthetic'},notePath:item.file.path,threadId:index?'independent':'project',messageId:id,projectId:'synthetic',threadEnvironmentId:'synthetic',initialHash:'initial',createdAt:'2026-11-02T12:00:00Z'},state:{requestHash:'synthetic',accepted:true,notePath:item.file.path,status:'running',hashes:[],body:index?render('Independent running response','running'):body('running'),updatedAt:''}});
    const active=record(ids[0],0);await manager.receive(active);await manager.receive(record(ids[1],1));
    const snapshot=async(label:string)=>{
      const view=leaf.view as MarkdownView,adapter=manager.view(view),saved=adapter?.saved()??view.getViewData();
      const folds=Array.from(view.contentEl.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]')).map(fold=>{
        const actions=fold.closest('.cm-embed-block')?.querySelector(':scope > .embed-actions');
        const control=(name:string)=>{const element=actions?.querySelector<HTMLElement>('.send-to-t3-stream-'+name);return element?{hidden:element.hidden,label:element.getAttribute('aria-label')}:null;};
        return {key:fold.querySelector<HTMLElement>('.send-to-t3-fold-key')?.dataset.t3Fold,text:fold.innerText,close:control('close'),follow:control('follow')};
      });
      const state={label,nativeObsidian:require('obsidian').apiVersion,virtualFile:item.file.path,saved,display:view.editor.getValue(),project:fs.readFileSync(projectFile,'utf8'),uncertain:item.document.uncertain,draft:item.document.draft,folds,events,notices:Array.from(document.querySelectorAll('.notice')).map(element=>(element as HTMLElement).innerText)};
      evidence('state.json',state);return state;
    };
    for(const type of ['click','keydown'])this.registerDomEvent(document,type as any,(event:any)=>{events.push({type,trusted:event.isTrusted,key:event.key,target:event.target?.className});if(events.length>100)events.shift();},true);
    let working=false,cleaned=false;
    const timer=setInterval(()=>{if(working||cleaned)return;working=true;void(async()=>{
      const mailbox=path.join(root,'action.json');
      if(fs.existsSync(mailbox)){
        const action=JSON.parse(fs.readFileSync(mailbox,'utf8'));fs.unlinkSync(mailbox);
        if(action.kind==='interrupt')manager.stream({request:active.request,messageId:ids[0],sequence:1,phase:'interrupted',completionVerified:true,body:body('interrupted')});
        if(action.kind==='commit'){
          const io=deviceFinalNoteIO(this.app,()=>true),before=await io.read(item.file.path);if(before===undefined)throw Error('The saved project note is unavailable.');
          const after=before.replace(responseAnchor(ids[0]),body('interrupted'));
          if(!await io.compareAndSet(item.file.path,before,after))throw Error('The final project save was not verified.');
          manager.localCompleted(ids[0],item.file.path);evidence('commit.json',{before,after,verified:true});
        }
        if(action.kind==='reopen'){
          await (leaf.view as MarkdownView).save();leaf.detach();manager.refresh();leaf=this.app.workspace.getLeaf(false);await bridge.open(item,leaf);manager.refresh();
        }
        if(action.kind==='capture'&&/^[a-z0-9-]+$/.test(action.name)){
          evidence(action.name+'.json',await snapshot(action.name));const frame=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(root,action.name+'.png'),frame.toPNG());
        }
        if(action.kind==='cleanup'){
          await (leaf.view as MarkdownView).save();manager.dispose();bridge.dispose();
          for(const name of ['Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
          fs.unlinkSync(projectFile);fs.rmdirSync(external);
          evidence('cleanup.json',{notesAbsent:['Reference.md','Virtual.md'].every(name=>!this.app.vault.getAbstractFileByPath(name)),projectFileAbsent:!fs.existsSync(projectFile),threadsCreated:[]});cleaned=true;return;
        }
      }
      manager.refresh();await snapshot('native-observation');
    })().catch(error=>evidence('error.json',{error:String(error),stack:error.stack})).finally(()=>{working=false;});},250);
    this.register(()=>clearInterval(timer));await snapshot('ready');
  }
}
