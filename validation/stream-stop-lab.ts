import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {installStreamBlockControls} from '../stream-block-controls';
import {installResponsePresentation} from '../response-presentation';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {renderInlineTurn} from '../inline-thread';
import {InlineChatManager} from '../inline-chat';
import {interruptStoppedResponse} from '../response-stop';
import type {ResponseRecord} from '../response-record';
const fs=require('node:fs'),path=require('node:path');
const ids=['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'];
/** Real native editor with synthetic provider snapshots and a recording-only
 * interrupt transport. It has no credentials, network or T3 dispatch access. */
export default class StreamStopLab extends Plugin {
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated synthetic lab is required.');
    const evidence=(name:string,value:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n');
    const error=(error:unknown)=>evidence('error.json',{message:String(error),stack:(error as Error).stack});
    const manager=nativeResponses(this.app),commands:any[]=[],events:any[]=[];
    const {EditorState}=require('@codemirror/state') as typeof import('@codemirror/state');
    this.registerEditorExtension([hiddenInlineMarkerExtension(),EditorState.transactionFilter.of(tr=>manager.filter(tr))]);
    this.register(installResponsePresentation(document,setIcon));
    const chat=new InlineChatManager(this.app,'synthetic-stream-stop',async()=>undefined,{
      prepare:async()=>{},stop:async job=>{
        const index=ids.indexOf(job.id);if(index<0)throw Error('Unknown synthetic run');
        await interruptStoppedResponse(async()=>({origin:'https://synthetic.invalid',api:async(_route,payload)=>{
          if(payload){commands.push(payload);return {};}
          return {thread:{id:`thread-${index}`,messages:[],activities:[],latestTurn:{turnId:`run-${index}`,state:'running'},session:{activeTurnId:`run-${index}`}}};
        }}),job.id,`thread-${index}`,`run-${index}`);
      }
    });
    this.register(()=>{chat.dispose();manager.dispose();});
    this.register(installStreamBlockControls(this.app,document,setIcon,error,undefined,(id,view)=>chat.stopAt(id,view.editor,view)));
    this.app.workspace.onLayoutReady(()=>void (async()=>{
      const name='Stream stop fixture.md',saved=`# Stream stop fixture\n\nOrdinary before.\n\n${responseAnchor(ids[0])}\n\nOrdinary between.\n\n${responseAnchor(ids[1])}\n\nOrdinary after.\n`;
      const file=this.app.vault.getFileByPath(name)??await this.app.vault.create(name,saved),leaf=this.app.workspace.getLeaf(false);
      await this.app.vault.modify(file,saved);
      await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:name,mode:'source',source:false},active:true});
      const records:ResponseRecord[]=ids.map((id,index)=>({coordinated:true,owner:'synthetic',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:3,id,vaultId:'synthetic',host:{environmentId:'synthetic',workspaceRoot:(this.app.vault.adapter as any).getFullPath(''),directory:'.obsidian/synthetic'},notePath:name,threadId:`thread-${index}`,messageId:id,projectId:'synthetic',threadEnvironmentId:'synthetic',initialHash:'initial',createdAt:'2026-10-20T12:00:00Z'},state:{requestHash:'synthetic',accepted:true,notePath:name,status:'running',hashes:[],body:'',updatedAt:''}}));
      const output=['Alpha stream text can be selected.\n\n[Open reference](Reference.md)\n\nAlpha retained content.','Beta stream remains independent.'];
      const update=async(index:number)=>{
        const record=records[index];record.revision++;record.state!.body=renderInlineTurn({messages:[{id:`answer-${index}`,role:'assistant',text:output[index],turnId:`run-${index}`,streaming:true}],activities:[],latestTurn:{turnId:`run-${index}`,state:'running'}} as any,`run-${index}`,`thread-${index}`,'running','collapse',undefined,undefined,undefined,index?'Beta':'Alpha',{startedAt:record.request.createdAt});
        await manager.receive(record);
      };
      await update(0);await update(1);
      const snapshot=async(label:string)=>{
        const view=leaf.view as MarkdownView;
        const foldState=Array.from(view.contentEl.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]')).map(fold=>{
          const key=fold.querySelector<HTMLElement>('.send-to-t3-fold-key')?.dataset.t3Fold,button=fold.querySelector<HTMLButtonElement>('.send-to-t3-stream-stop'),rect=button?.getBoundingClientRect(),box=fold.getBoundingClientRect();
          const actions=fold.querySelector<HTMLElement>(':scope > .send-to-t3-reading-actions')??fold.closest('.cm-embed-block')?.querySelector<HTMLElement>(':scope > .send-to-t3-stream-actions'),follow=actions?.querySelector<HTMLElement>('.send-to-t3-stream-follow');
          const followBox=follow?.getBoundingClientRect();
          return {key,text:fold.innerText,collapsed:fold.classList.contains('is-collapsed'),parent:fold.parentElement?.className,follow:follow?{hidden:follow.hidden,visible:follow.getClientRects().length>0,display:getComputedStyle(follow).display,active:follow.getAttribute('aria-pressed'),control:key?manager.view(view)?.scrollControl(key):undefined,rect:followBox&&{x:followBox.x,y:followBox.y,width:followBox.width,height:followBox.height}}:null,stop:button?{hidden:button.hidden,disabled:button.disabled,label:button.getAttribute('aria-label'),focused:document.activeElement===button,rect:rect&&{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}:null,box:{x:box.x,y:box.y,width:box.width,height:box.height}};
        });
        const scroller=view.getMode()==='preview'?view.contentEl.querySelector('.markdown-preview-view'):(view.editor as any).cm?.scrollDOM;
        const state={label,notePath:view.file?.path,mode:view.getMode(),scrollTop:scroller?.scrollTop,saved:view.getViewData(),display:view.editor.getValue(),disk:await this.app.vault.read(file),selection:window.getSelection()?.toString(),folds:foldState,commands,events,active:document.activeElement?.outerHTML.slice(0,500)};
        evidence('state.json',state);return state;
      };
      for(const type of ['click','pointerdown','pointerup','keydown','focusin'])this.registerDomEvent(document,type as any,(event:any)=>{
        events.push({type,pointerType:event.pointerType,key:event.key,trusted:event.isTrusted,target:event.target?.className});if(events.length>100)events.shift();
      },true);
      let working=false,cleaned=false;
      const timer=setInterval(()=>{if(working||cleaned)return;working=true;void(async()=>{
        const mailbox=path.join(root,'action.json');if(fs.existsSync(mailbox)){
          const action=JSON.parse(fs.readFileSync(mailbox,'utf8'));fs.unlinkSync(mailbox);
          if(action.kind==='update'){output[action.index]+='\n\nNew independent tokens.'.repeat(Math.max(1,Math.min(80,action.paragraphs??1)));await update(action.index);}
          if(action.kind==='terminal'){records[action.index].revision++;records[action.index].state!.status='complete';await manager.receive(records[action.index]);}
          if(action.kind==='mode')await leaf.setViewState({type:'markdown',state:{file:name,mode:action.mode,source:false}});
          if(action.kind==='mobile-style')document.body.classList.toggle('is-mobile',true);
          if(action.kind==='capture'&&/^[a-z0-9-]+$/.test(action.name)){
            evidence(`${action.name}.json`,await snapshot(action.name));
            const frame=await require('electron').remote.getCurrentWindow().webContents.capturePage();fs.writeFileSync(path.join(root,`${action.name}.png`),frame.toPNG());
          }
          if(action.kind==='cleanup'){
            chat.dispose();await this.app.vault.delete(file);const reference=this.app.vault.getFileByPath('Reference.md'),virtual=this.app.vault.getFileByPath('Virtual.md');
            if(reference)await this.app.vault.delete(reference);if(virtual)await this.app.vault.delete(virtual);
            evidence('cleanup.json',{notesAbsent:[name,'Reference.md','Virtual.md'].every(note=>!this.app.vault.getAbstractFileByPath(note)),threadsCreated:[],commands});cleaned=true;return;
          }
        }
        manager.refresh();await snapshot('native-observation');
      })().catch(error).finally(()=>{working=false;});},200);
      this.register(()=>clearInterval(timer));await snapshot('ready');
    })().catch(error));
  }
}
