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

/** Public-summary replay in a real, unsynced editor. No T3 work is dispatched. */
export default class ThoughtStreamLab extends Plugin {
  private root='';private preview?:DirectInlinePreview;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated fixture vault is required.');
    this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document,setIcon));
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>nativeResponses(this.app).filter(tr)));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('error.json',{message:String(error),stack:error.stack})).finally(()=>this.cleanup()));
  }
  private write(name:string,data:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
  private async capture(name:string){const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root,name),image.toPNG());}
  private async cleanup(){
    this.preview?.dispose();nativeResponses(this.app).dispose();
    for(const name of ['Thoughts.md','Reference.md','Virtual.md']){const file=this.app.vault.getAbstractFileByPath(name);if(file)await this.app.vault.delete(file);}
    this.write('CLEANUP.json',{temporaryThreads:[],remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path)});
  }
  private async run(){
    await pause(500);const app=this.app,manager=nativeResponses(app),id=crypto.randomUUID(),startedAt=new Date().toISOString();
    const saved='# Thought stream fixture\n\nOrdinary note text.\n\n'+responseAnchor(id)+'\n';
    const file=await app.vault.create('Thoughts.md',saved),first=app.workspace.getLeaf(false);await first.openFile(file);
    const second=app.workspace.createLeafBySplit(first,'vertical');await second.openFile(file);
    await second.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});const leaves=[first,second];
    const record:ResponseRecord={coordinated:true,migrating:true,owner:'fixture',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:4,nativeProjection:true,id,initialOwner:crypto.randomUUID(),vaultId:crypto.randomUUID(),host:{environmentId:'fixture',workspaceRoot:'/unavailable-host',directory:'.obsidian/inline'},notePath:file.path,threadId:'fixture-thread',messageId:'prompt',projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:contentHash(''),createdAt:startedAt,intermediateMode:'collapse',threadTitle:'Thought stream'}};
    let callbacks!:ThreadStreamCallbacks,sequence=2,lastBody='';
    const watch:typeof watchThread=(_id,_access,next)=>{callbacks=next;return {stop:()=>{}};};
    this.preview=new DirectInlinePreview(record,async()=>{throw Error('No network in thought fixture');},update=>{lastBody=update.body;manager.stream(update);},watch);
    await manager.receive(record);this.preview.tick(true);
    const start=Date.now(),at=(n:number)=>new Date(start+n).toISOString();
    callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:sequence,thread:{id:'fixture-thread',projectId:'fixture-project',title:'Thought stream',messages:[{id:'prompt',role:'user',text:'Synthetic task',turnId:'turn',streaming:false,createdAt:at(0)}],activities:[],latestTurn:{turnId:'turn',messageId:'prompt',state:'running'},session:{status:'running',activeTurnId:'turn'}}}});
    const event=(type:string,payload:any)=>callbacks.item({kind:'event',event:{sequence:++sequence,aggregateId:'fixture-thread',type,payload}});
    const thinking=(id:string,ordinal:number,text:string,streaming=false)=>event('v2.turn-item.updated',{id,runId:'turn',type:'reasoning',ordinal,text,streaming,startedAt:at(ordinal),updatedAt:at(ordinal)});
    const fold=(leaf:any)=>leaf.view.containerEl.querySelector('.callout[data-callout="t3-progress"]') as HTMLElement|null;
    const thought=(leaf:any)=>fold(leaf)?.querySelector<HTMLElement>('.callout[data-callout="t3-thought"]');
    const rows:Array<{name:string;pass:boolean}>=[],check=(name:string,pass:boolean)=>rows.push({name,pass});
    thinking('one',1,'**Assessing VPS browser session issues**');thinking('two',2,'**Planning sign-in using saved credentials**',true);await until(()=>leaves.every(leaf=>thought(leaf)?.querySelector('.callout-title')?.textContent?.includes('Thought (×2)')));
    check('one closed Thought (×2) group in Live Preview and Reading',leaves.every(leaf=>fold(leaf)?.querySelectorAll('.callout[data-callout="t3-thought"]').length===1&&thought(leaf)?.classList.contains('is-collapsed')&&thought(leaf)?.querySelector('.callout-title')?.textContent?.includes('Thought (×2)')));
    check('each client paints the timestamp',leaves.every(leaf=>!!thought(leaf)?.querySelector('.send-to-t3-thought-time')?.textContent?.trim()));
    check('thought headers show the brain icon',leaves.every(leaf=>!!thought(leaf)?.querySelector(':scope > .callout-title > .callout-icon .lucide-brain')));
    for(const leaf of leaves)thought(leaf)?.scrollIntoView({block:'center'});await this.capture('thought-closed.png');
    thought(first)?.querySelector<HTMLElement>(':scope > .callout-title')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    thought(second)?.querySelector<HTMLElement>(':scope > .callout-title')?.click();await pause(100);
    check('pointer and keyboard open formatted summaries and keep outer history open',leaves.every(leaf=>!thought(leaf)?.classList.contains('is-collapsed')&&!fold(leaf)?.classList.contains('is-collapsed')&&thought(leaf)?.querySelectorAll('strong').length===2));
    thinking('two',2,'**Planning sign-in using saved credentials**\n\nUpdated public summary.');await until(()=>leaves.every(leaf=>thought(leaf)?.textContent?.includes('Updated public summary.')));
    check('open choice survives streamed summary replacement',leaves.every(leaf=>!thought(leaf)?.classList.contains('is-collapsed')&&thought(leaf)?.textContent?.includes('Updated public summary.')&&thought(leaf)?.querySelector('.callout-title')?.textContent?.includes('Thought (×2)')));
    await this.capture('thought-open.png');
    thought(first)?.querySelector<HTMLElement>(':scope > .callout-title')?.click();thinking('three',3,'A third public summary.');await until(()=>leaves.every(leaf=>thought(leaf)?.querySelector('.callout-title')?.textContent?.includes('Thought (×3)')));
    check('fold choices stay independent while the count grows',!!thought(first)?.classList.contains('is-collapsed')&&!thought(second)?.classList.contains('is-collapsed')&&leaves.every(leaf=>thought(leaf)?.querySelector('.callout-title')?.textContent?.includes('Thought (×3)')));
    check('generated thoughts do not enter saved note text',leaves.every(leaf=>(leaf.view as MarkdownView).getViewData()===saved)&&await app.vault.read(file)===saved);
    event('thread.message-sent',{messageId:'commentary',role:'assistant',text:'A commentary boundary.',turnId:'turn',createdAt:at(4),streaming:false});
    thinking('four',5,'A separate public thought.');await until(()=>leaves.every(leaf=>fold(leaf)?.querySelectorAll('.callout[data-callout="t3-thought"]').length===2));
    check('commentary splits consecutive thought groups',leaves.every(leaf=>fold(leaf)?.querySelectorAll('.callout[data-callout="t3-thought"]').length===2));
    this.write('THOUGHT-DOM.json',{body:lastBody,modes:leaves.map(leaf=>(leaf.view as MarkdownView).getMode()),folds:leaves.map(leaf=>fold(leaf)?.outerHTML)});
    event('thread.message-sent',{messageId:'final',role:'assistant',text:'Final answer outside thoughts.',turnId:'turn',createdAt:at(6),streaming:false});event('thread.session-set',{session:{status:'ready',activeTurnId:null}});await until(()=>leaves.every(leaf=>fold(leaf)?.classList.contains('is-collapsed')));
    check('completion leaves the final answer outside closed history',leaves.every(leaf=>fold(leaf)?.classList.contains('is-collapsed')&&!fold(leaf)?.textContent?.includes('Final answer outside thoughts.'))&&lastBody.includes('\n\n> Final answer outside thoughts.'));
    this.write('RESULT.json',{pass:rows.every(row=>row.pass),rows,temporaryThreads:[],coverage:['VPS desktop Live Preview','VPS desktop Reading'],nativeMobileTested:false});
  }
  onunload(){this.preview?.dispose();nativeResponses(this.app).dispose();}
}
