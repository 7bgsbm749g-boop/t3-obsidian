import {Plugin,MarkdownView,MarkdownRenderer,MarkdownRenderChild,setIcon} from 'obsidian';
import {DirectInlinePreview} from '../direct-inline-preview';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {mountToolGroups} from '../response-tool-presentation';
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
    require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false);
    const mounted=new WeakMap<HTMLDetailsElement,string>();
    this.registerDomEvent(document,'toggle' as any,(event:Event)=>{
      const details=event.target as HTMLDetailsElement;
      if(!details?.matches?.('details[data-t3-tool-ref]')||!details.open)return;
      const ref=details.getAttribute('data-t3-tool-ref')!;if(mounted.get(details)===ref)return;mounted.set(details,ref);
      const child=new MarkdownRenderChild(details);this.addChild(child);
      child.register(mountToolGroups(details,value=>nativeResponses(this.app).toolGroup(details,value),(html,target)=>MarkdownRenderer.render(this.app,html,target,this.app.workspace.getActiveFile()?.path??'',child),error=>this.write('lazy-error.json',{message:String(error)})));
    },true);
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
    const groups=(leaf:any)=>Array.from(fold(leaf)?.querySelectorAll<HTMLDetailsElement>('details[data-t3-tool-group]')??[]);
    const batch=(leaf:any)=>groups(leaf)[0];
    const thoughts=(leaf:any)=>Array.from(batch(leaf)?.querySelectorAll<HTMLDetailsElement>('.send-to-t3-thought')??[]);
    const rows:Array<{name:string;pass:boolean}>=[],check=(name:string,pass:boolean)=>rows.push({name,pass});
    const command=(id:string,ordinal:number,status='completed')=>event('v2.turn-item.updated',{id,runId:'turn',type:'command_execution',ordinal,status,input:'pwd',command:'pwd',output:'Synthetic exact result',startedAt:at(ordinal),updatedAt:at(ordinal)});
    thinking('one',1,'**Check the request**');command('command-one',2);thinking('two',3,'**Check the result**',true);
    await until(()=>leaves.every(leaf=>batch(leaf)?.querySelector(':scope > summary')?.textContent?.includes('Ran 1 command · 2 thoughts')));
    check('alternating thoughts and tools share one closed batch in both views',leaves.every(leaf=>groups(leaf).length===1&&!batch(leaf)?.open&&batch(leaf)?.querySelector(':scope > summary')?.textContent?.includes('Ran 1 command · 2 thoughts')===true));
    check('standalone thought callouts are absent',leaves.every(leaf=>!fold(leaf)?.querySelector('.callout[data-callout="t3-thought"]')));
    for(const leaf of leaves)batch(leaf)?.scrollIntoView({block:'center'});await this.capture('batch-closed.png');
    for(const leaf of leaves)batch(leaf)?.querySelector<HTMLElement>(':scope > summary')?.click();
    await until(()=>leaves.every(leaf=>thoughts(leaf).length===2));
    check('thoughts and tools are direct peers in chronological order',leaves.every(leaf=>Array.from(batch(leaf)?.querySelector('.send-to-t3-tool-group-content')?.children??[]).map(el=>el.className).join(',')==='send-to-t3-thought,send-to-t3-tool,send-to-t3-thought'));
    await until(()=>leaves.every(leaf=>thoughts(leaf).length===2&&thoughts(leaf).every(thought=>!!thought.querySelector('.send-to-t3-thought-time')?.textContent?.trim()&&!!thought.querySelector('.lucide-brain'))));
    check('thought timestamps and brain icons render',leaves.every(leaf=>thoughts(leaf).length===2&&thoughts(leaf).every(thought=>!!thought.querySelector('.send-to-t3-thought-time')?.textContent?.trim()&&!!thought.querySelector('.lucide-brain'))));
    for(const leaf of leaves)thoughts(leaf)[0]?.querySelector<HTMLElement>(':scope > summary')?.click();
    await until(()=>leaves.every(leaf=>thoughts(leaf)[0]?.open));
    check('expanding a thought shows formatted public content',leaves.every(leaf=>thoughts(leaf)[0]?.open&&thoughts(leaf)[0]?.querySelector('strong')?.textContent==='Check the request'));
    await this.capture('batch-open.png');
    const identity=batch(first)?.getAttribute('data-t3-tool-group');
    thinking('two',3,'**Check the result**\n\nUpdated public summary.');
    await until(()=>leaves.every(leaf=>batch(leaf)?.textContent?.includes('Updated public summary.')));
    check('batch and nested thought choices survive streamed replacement',leaves.every(leaf=>batch(leaf)?.open&&thoughts(leaf)[0]?.open&&batch(leaf)?.getAttribute('data-t3-tool-group')===identity&&batch(leaf)?.textContent?.includes('Updated public summary.')));
    batch(first)?.querySelector<HTMLElement>(':scope > summary')?.click();
    command('command-two',4);thinking('three',5,'A third public summary.');
    await until(()=>leaves.every(leaf=>batch(leaf)?.querySelector(':scope > summary')?.textContent?.includes('Ran 2 commands · 3 thoughts')));
    check('each pane keeps its own fold choice as the mixed batch grows',!batch(first)?.open&&!!batch(second)?.open&&leaves.every(leaf=>groups(leaf).length===1&&batch(leaf)?.getAttribute('data-t3-tool-group')===identity));
    check('generated activity does not enter saved note text',leaves.every(leaf=>(leaf.view as MarkdownView).getViewData()===saved)&&await app.vault.read(file)===saved);
    event('thread.message-sent',{messageId:'commentary',role:'assistant',text:'A commentary boundary.',turnId:'turn',createdAt:at(6),streaming:false});
    thinking('four',7,'A separate public thought.');await until(()=>leaves.every(leaf=>groups(leaf).length===2));
    check('commentary starts a new activity batch',leaves.every(leaf=>groups(leaf).length===2));
    this.write('THOUGHT-DOM.json',{body:lastBody,modes:leaves.map(leaf=>(leaf.view as MarkdownView).getMode()),folds:leaves.map(leaf=>fold(leaf)?.outerHTML)});
    event('thread.message-sent',{messageId:'final',role:'assistant',text:'Final answer outside thoughts.',turnId:'turn',createdAt:at(8),streaming:false});event('thread.session-set',{session:{status:'ready',activeTurnId:null}});await until(()=>leaves.every(leaf=>fold(leaf)?.classList.contains('is-collapsed')));
    check('completion leaves the final answer outside closed history',leaves.every(leaf=>fold(leaf)?.classList.contains('is-collapsed')&&!fold(leaf)?.textContent?.includes('Final answer outside thoughts.'))&&lastBody.includes('\n\n> Final answer outside thoughts.'));
    this.write('RESULT.json',{pass:rows.every(row=>row.pass),rows,temporaryThreads:[],coverage:['VPS desktop Live Preview','VPS desktop Reading'],nativeMobileTested:false});
  }
  onunload(){this.preview?.dispose();nativeResponses(this.app).dispose();}
}
