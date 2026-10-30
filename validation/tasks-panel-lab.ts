import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {DirectInlinePreview} from '../direct-inline-preview';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {contentHash} from '../completion';
import type {ResponseRecord} from '../response-record';
import type {ThreadStreamCallbacks,watchThread} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check:()=>boolean)=>{const end=Date.now()+5000;while(!check()&&Date.now()<end)await pause(40);};

/** Synthetic task updates in real native editors; no T3 or Sync connection. */
export default class TasksPanelLab extends Plugin {
  private root='';private preview?:DirectInlinePreview;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated fixture vault is required.');
    this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document,setIcon));
    require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false);
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>nativeResponses(this.app).filter(tr)));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('error.json',{message:String(error),stack:error.stack})).finally(()=>this.cleanup()));
  }
  private write(name:string,data:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
  private async capture(name:string){fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
  private async cleanup(){
    this.preview?.dispose();nativeResponses(this.app).dispose();
    for(const name of ['Tasks.md','Reference.md','Virtual.md']){const file=this.app.vault.getAbstractFileByPath(name);if(file)await this.app.vault.delete(file);}
    this.write('CLEANUP.json',{temporaryThreads:[],remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path)});
  }
  private async run(){
    await pause(500);const app=this.app,manager=nativeResponses(app),id=crypto.randomUUID(),startedAt=new Date().toISOString();
    const saved='# Tasks panel fixture\n\nOrdinary note text.\n\n'+responseAnchor(id)+'\n';
    const file=await app.vault.create('Tasks.md',saved),first=app.workspace.getLeaf(false);await first.openFile(file);
    const second=app.workspace.createLeafBySplit(first,'vertical');await second.openFile(file);
    await second.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});const leaves=[first,second];
    const record:ResponseRecord={coordinated:true,migrating:true,owner:'fixture',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:4,nativeProjection:true,id,initialOwner:crypto.randomUUID(),vaultId:crypto.randomUUID(),host:{environmentId:'fixture',workspaceRoot:'/unavailable-host',directory:'.obsidian/inline'},notePath:file.path,threadId:'fixture-thread',messageId:'prompt',projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:contentHash(''),createdAt:startedAt,intermediateMode:'collapse',threadTitle:'Task display',initialInput:{messageId:'prompt',text:'Synthetic task input'}}};
    let callbacks!:ThreadStreamCallbacks,sequence=2,lastBody='';
    const watch:typeof watchThread=(_id,_access,next)=>{callbacks=next;return {stop:()=>{}};};
    this.preview=new DirectInlinePreview(record,async()=>{throw Error('No network in task fixture');},update=>{lastBody=update.body;manager.stream(update);},watch);
    await manager.receive(record);this.preview.tick(true);
    const start=Date.now(),at=(n:number)=>new Date(start+n).toISOString();
    callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:sequence,thread:{id:'fixture-thread',projectId:'fixture-project',title:'Task display',messages:[{id:'prompt',role:'user',text:'Synthetic task input',turnId:'turn',streaming:false,createdAt:at(0)}],activities:[],latestTurn:{turnId:'turn',messageId:'prompt',state:'running'},session:{status:'running',activeTurnId:'turn'}}}});
    const event=(type:string,payload:any)=>callbacks.item({kind:'event',event:{sequence:++sequence,aggregateId:'fixture-thread',type,payload}});
    const plan=(id:string,steps:any[],text?:string)=>event('v2.turn-item.updated',{id,runId:'turn',type:'todo_list',ordinal:1,steps,text,startedAt:at(sequence),updatedAt:at(sequence)});
    const fold=(leaf:any)=>leaf.view.containerEl.querySelector('.callout[data-callout="t3-progress"]') as HTMLElement|null;
    const panel=(leaf:any)=>fold(leaf)?.querySelector<HTMLDetailsElement>('.send-to-t3-tasks');
    const rows:Array<{name:string;pass:boolean}>=[],check=(name:string,pass:boolean)=>rows.push({name,pass});
    plan('plan',[{step:'Read the request',status:'completed'},{step:'Check Tasks display',status:'in_progress'},{step:'Publish the change',status:'pending'}]);
    await until(()=>leaves.every(leaf=>!!panel(leaf)?.querySelector('.lucide-list-checks')));
    check('Tasks has a visible gray list icon in both native views',leaves.every(leaf=>{
      const summary=panel(leaf)?.querySelector('summary'),icon=summary?.querySelector('svg');if(!summary||!icon)return false;
      const color=getComputedStyle(summary).color,parts=color.match(/\d+/g);
      return !!parts&&parts[0]===parts[1]&&parts[1]===parts[2]&&getComputedStyle(icon).color===color&&icon.getBoundingClientRect().width>0;
    }));
    check('Tasks is the first history item at its original depth',leaves.every(leaf=>fold(leaf)?.querySelector(':scope > .callout-content')?.firstElementChild===panel(leaf)));
    check('the label is Tasks and starts closed',leaves.every(leaf=>panel(leaf)?.querySelector('summary')?.textContent?.trim()==='Tasks'&&!panel(leaf)?.open));
    await this.capture('tasks-closed.png');
    for(const leaf of leaves)panel(leaf)?.querySelector<HTMLElement>('summary')?.click();
    await until(()=>leaves.every(leaf=>panel(leaf)?.open));
    check('pending, in-progress slash and completed check have separate marks',leaves.every(leaf=>{
      const marks=panel(leaf)?.querySelectorAll('.send-to-t3-task-mark');
      return marks?.length===3&&marks[0].getAttribute('aria-label')==='Completed'&&marks[1].getAttribute('aria-label')==='In progress'&&marks[2].getAttribute('aria-label')==='Pending'&&getComputedStyle(marks[1],'::after').transform!=='none';
    }));
    const competing=document.createElement('style');competing.textContent='.task-list-item[data-task="/"] { color: rgb(255,0,0) !important; } .task-list-item-checkbox { appearance: none !important; display: none !important; }';document.head.appendChild(competing);this.register(()=>competing.remove());
    const before=leaves.map(leaf=>panel(leaf)?.innerHTML);
    for(const leaf of leaves)for(const mark of Array.from(panel(leaf)?.querySelectorAll<HTMLElement>('.send-to-t3-task-mark')??[])){mark.click();mark.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));}
    await pause(100);
    check('task items have no user controls or third-party task selectors and clicks change no state',leaves.every((leaf,index)=>panel(leaf)?.innerHTML===before[index]&&!panel(leaf)?.querySelector('input, button, [tabindex], .task-list-item, .task-list-item-checkbox, [data-task]')&&!!panel(leaf)?.open));
    await this.capture('tasks-open.png');
    event('thread.message-sent',{messageId:'commentary',role:'assistant',text:'Checking task behavior.',turnId:'turn',createdAt:at(10),streaming:false});
    event('v2.turn-item.updated',{id:'tool',runId:'turn',type:'command_execution',ordinal:2,status:'completed',command:'pwd',input:'pwd',output:'Synthetic result',startedAt:at(11),updatedAt:at(11)});
    await until(()=>leaves.every(leaf=>fold(leaf)?.textContent?.includes('Checking task behavior.')));
    check('unrelated commentary and tool updates preserve task expansion and icon',leaves.every(leaf=>panel(leaf)?.open&&!!panel(leaf)?.querySelector('.lucide-list-checks')));
    plan('plan',[{step:'Read the request',status:'completed'},{step:'Check Tasks display',status:'completed'},{step:'Publish the change',status:'in_progress'}]);
    await until(()=>leaves.every(leaf=>panel(leaf)?.querySelectorAll('[data-t3-task-state="completed"]').length===2));
    check('task status updates retain expansion and icon',leaves.every(leaf=>panel(leaf)?.open&&!!panel(leaf)?.querySelector('.lucide-list-checks')&&panel(leaf)?.querySelectorAll('[data-t3-task-state="completed"]').length===2));
    panel(first)?.querySelector<HTMLElement>('summary')?.click();
    plan('replacement',[], '- [x] Read the request\n- [/] Verify Markdown slash\n- [ ] Publish the change');
    await until(()=>leaves.every(leaf=>panel(leaf)?.textContent?.includes('Verify Markdown slash')));
    check('new plan IDs and Markdown slash preserve each pane choice with one latest list',!panel(first)?.open&&!!panel(second)?.open&&leaves.every(leaf=>fold(leaf)?.querySelectorAll('.send-to-t3-tasks').length===1&&panel(leaf)?.querySelectorAll('[data-t3-task-state="in_progress"]').length===1));
    panel(first)?.querySelector<HTMLElement>('summary')?.click();
    await this.capture('tasks-updated.png');
    check('generated Tasks never changes saved note text',leaves.every(leaf=>(leaf.view as MarkdownView).getViewData()===saved)&&await app.vault.read(file)===saved);
    event('thread.message-sent',{messageId:'final',role:'assistant',text:'Task display verified.',turnId:'turn',createdAt:at(20),streaming:false});event('thread.session-set',{session:{status:'ready',activeTurnId:null}});
    await until(()=>leaves.every(leaf=>fold(leaf)?.classList.contains('is-collapsed')));
    for(const leaf of leaves)fold(leaf)?.querySelector<HTMLElement>(':scope > .callout-title')?.click();
    await until(()=>leaves.every(leaf=>!fold(leaf)?.classList.contains('is-collapsed')));
    check('task expansion survives completion and reopening history',leaves.every(leaf=>panel(leaf)?.open&&!!panel(leaf)?.querySelector('.lucide-list-checks')));
    this.write('TASKS-DOM.json',{body:lastBody,modes:leaves.map(leaf=>(leaf.view as MarkdownView).getMode()),folds:leaves.map(leaf=>fold(leaf)?.outerHTML)});
    await this.capture('tasks-complete.png');
    this.write('RESULT.json',{pass:rows.every(row=>row.pass),rows,temporaryThreads:[],coverage:['VPS desktop Live Preview','VPS desktop Reading','representative competing task CSS'],nativeMobileTested:false});
  }
  onunload(){this.preview?.dispose();nativeResponses(this.app).dispose();}
}
