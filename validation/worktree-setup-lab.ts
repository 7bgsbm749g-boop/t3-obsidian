import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {DirectInlinePreview} from '../direct-inline-preview';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {installActivityShine} from '../activity-shine';
import {contentHash} from '../completion';
import {normalizeV2Snapshot} from '../orchestration-v2';
import {completedSetup,preparationItem} from '../tests/fixtures/worktree-setup';
import type {ResponseRecord} from '../response-record';
import type {ThreadStreamCallbacks,watchThread} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check:()=>boolean)=>{const end=Date.now()+6000;while(!check()&&Date.now()<end)await pause(40);};

/** Native editor replay of the real setup subscription shape. No dispatch or Sync. */
export default class WorktreeSetupLab extends Plugin {
 private root='';private preview?:DirectInlinePreview;
 async onload(){
  this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Isolated lab required.');
  this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document,setIcon));this.register(installActivityShine(document));
  const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>nativeResponses(this.app).filter(tr)));
  this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('error.json',{message:String(error),stack:error.stack})).finally(()=>this.cleanup()));
 }
 private write(name:string,data:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
 private async capture(name:string){fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
 private async cleanup(){
  this.preview?.dispose();nativeResponses(this.app).dispose();
  for(const name of ['Worktree setup.md','Reference.md','Virtual.md']){const file=this.app.vault.getAbstractFileByPath(name);if(file)await this.app.vault.delete(file);}
  this.write('CLEANUP.json',{temporaryThreads:[],remainingNotes:this.app.vault.getMarkdownFiles().map(f=>f.path)});
 }
 private async run(){
  await pause(500);const app=this.app,manager=nativeResponses(app),id=crypto.randomUUID(),now=Date.now(),at=(offset:number)=>new Date(now+offset).toISOString();
  const saved='# Worktree setup\n\nOrdinary note text.\n\n'+responseAnchor(id)+'\n',file=await app.vault.create('Worktree setup.md',saved),first=app.workspace.getLeaf(false);await first.openFile(file);
  const second=app.workspace.createLeafBySplit(first,'vertical');await second.openFile(file);await second.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});const leaves=[first,second];
  const record:ResponseRecord={coordinated:true,migrating:true,owner:'fixture',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:4,nativeProjection:true,id,initialOwner:crypto.randomUUID(),vaultId:crypto.randomUUID(),host:{environmentId:'fixture',workspaceRoot:'/unavailable-host',directory:'.obsidian/inline'},notePath:file.path,threadId:'fixture-thread',messageId:'prompt',projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:contentHash(''),createdAt:at(0),intermediateMode:'collapse',threadTitle:'Worktree setup'}};
  let callbacks!:ThreadStreamCallbacks,sequence=20,lastBody='';
  const watch:typeof watchThread=(_id,_access,next)=>{callbacks=next;return {stop:()=>{}};};
  this.preview=new DirectInlinePreview(record,async()=>{throw Error('No network in setup fixture');},update=>{lastBody=update.body;manager.stream(update);},watch);await manager.receive(record);this.preview.tick(true);
  callbacks.item({kind:'snapshot',snapshot:normalizeV2Snapshot({snapshotSequence:sequence,projection:{thread:{id:'fixture-thread',projectId:'fixture-project',title:'Worktree setup'},messages:[{id:'prompt',role:'user',runId:'run',text:'Synthetic task',streaming:false,createdAt:at(0)}],runs:[{id:'run',ordinal:1,userMessageId:'prompt',status:'preparing',requestedAt:at(0)}],runtimeRequests:[],turnItems:[{...preparationItem,status:'running',startedAt:at(0),completedAt:null,updatedAt:at(0)}]}})});
  const base={...completedSetup,startedAt:at(0),endedAt:null,phase:'running' as const,sequence:1,stages:completedSetup.stages.map(s=>({...s,startedAt:null,endedAt:null,status:'pending' as const}))};
  const update=(value:any)=>callbacks.item({kind:'event',event:{type:'thread.worktree-setup',aggregateId:'fixture-thread',payload:value}});
  const panel=(leaf:any)=>leaf.view.containerEl.querySelector('.send-to-t3-worktree-setup') as HTMLElement|null;
  const rows:Array<{name:string;pass:boolean}>=[],check=(name:string,pass:boolean)=>rows.push({name,pass});
  update({...base,stages:base.stages.map(s=>s.id==='fetch'?{...s,status:'running',startedAt:at(0)}:s)});
  await until(()=>leaves.every(leaf=>!!panel(leaf)?.querySelector('[data-worktree-setup-status="running"]')));
  check('live panel appears in editor and Reading without command wrappers',leaves.every(leaf=>panel(leaf)?.textContent?.includes('Setting up worktree…')&&!leaf.view.containerEl.querySelector('[data-t3-tool-group]')));
  check('active header uses the text shine',leaves.every(leaf=>!!panel(leaf)?.querySelector('[data-t3-shine="true"]')));
  const details=leaves.map(leaf=>panel(leaf)?.querySelector<HTMLDetailsElement>('details'));details.forEach(d=>d?.querySelector('summary')?.click());await pause(100);
  const held=leaves.map(panel),ticks=leaves.map(leaf=>panel(leaf)?.querySelector('[data-t3-setup-start]')?.textContent);await pause(1100);
  check('elapsed clocks advance without stream writes',leaves.every((leaf,i)=>panel(leaf)?.querySelector('[data-t3-setup-start]')?.textContent!==ticks[i]));
  update({...base,sequence:2,stages:base.stages.map(s=>s.id==='fetch'?{...s,status:'done',startedAt:at(0),endedAt:at(756)}:s.id==='checkout'?{...s,status:'running',startedAt:at(756),percent:42}:s)});
  await until(()=>leaves.every(leaf=>panel(leaf)?.textContent?.includes('42%')===true));
  check('stage changes retain panel and open Details',leaves.every((leaf,i)=>panel(leaf)===held[i]&&details[i]?.open&&details[i]?.isConnected));await this.capture('setup-running.png');
  const done={...completedSetup,sequence:3,startedAt:at(0),endedAt:at(2000),stages:completedSetup.stages.map(s=>({...s,startedAt:s.startedAt?at(Date.parse(s.startedAt)-Date.parse(completedSetup.startedAt)):null,endedAt:s.endedAt?at(Date.parse(s.endedAt)-Date.parse(completedSetup.startedAt)):null}))};
  update(done);await until(()=>leaves.every(leaf=>panel(leaf)?.dataset.worktreeSetupPhase==='done'));
  check('exact labels, skipped script, icons and durations',leaves.every(leaf=>['Fetch base branch','Check out files','Run setup script','Start agent','756ms','1.1s','54ms','skipped'].every(t=>panel(leaf)?.textContent?.includes(t))&&panel(leaf)?.querySelectorAll('.lucide-check').length===3));
  check('Details shows branch, base and path',details.every(d=>d?.textContent?.includes('test/worktree')&&d.textContent.includes('/synthetic/worktree')));
  details.forEach(d=>d?.querySelector('summary')?.click());await pause(100);await this.capture('setup-complete.png');
  check('completed panel has no active stage or shine',leaves.every(leaf=>!panel(leaf)?.querySelector('[data-worktree-setup-status="running"], [data-t3-shine="true"]')));
  check('generated display leaves note and editor save data clean',await app.vault.read(file)===saved&&leaves.every(leaf=>(leaf.view as MarkdownView).getViewData()===saved));
  callbacks.item({kind:'event',event:{sequence:++sequence,type:'thread.message-sent',payload:{messageId:'final',role:'assistant',turnId:'run',text:'Worktree ready.',streaming:false,createdAt:at(3000)}}});callbacks.item({kind:'event',event:{sequence:++sequence,type:'thread.session-set',payload:{session:{status:'ready',activeTurnId:null}}}});await pause(200);
  this.write('RESULT.json',{pass:rows.every(r=>r.pass),rows,body:lastBody,temporaryThreads:[],coverage:['VPS desktop Live Preview','VPS desktop Reading'],nativeMobileTested:false});
 }
 onunload(){this.preview?.dispose();nativeResponses(this.app).dispose();}
}
