import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {DirectInlinePreview} from '../direct-inline-preview';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {contentHash} from '../completion';
import {normalizeV2Snapshot} from '../orchestration-v2';
import type {ResponseRecord} from '../response-record';
import type {ThreadStreamCallbacks,watchThread} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check:()=>boolean)=>{const end=Date.now()+6000;while(!check()&&Date.now()<end)await pause(40);};

/** Replays canonical provider failures in native editors without T3 dispatch. */
export default class ProviderErrorLab extends Plugin {
 private root='';private preview?:DirectInlinePreview;
 async onload(){
  this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Isolated lab required.');
  this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document,setIcon));
  const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>nativeResponses(this.app).filter(tr)));
  this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('error.json',{message:String(error),stack:error.stack})).finally(()=>this.cleanup()));
 }
 private write(name:string,data:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
 private async capture(name:string){fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
 private async cleanup(){
  this.preview?.dispose();nativeResponses(this.app).dispose();
  for(const name of ['Provider error.md','Reference.md','Virtual.md']){const file=this.app.vault.getAbstractFileByPath(name);if(file)await this.app.vault.delete(file);}
  this.write('CLEANUP.json',{temporaryThreads:[],remainingNotes:this.app.vault.getMarkdownFiles().map(f=>f.path)});
 }
 private async run(){
  await pause(500);const app=this.app,manager=nativeResponses(app),id=crypto.randomUUID(),at=new Date().toISOString();
  const saved='# Provider error\n\n'+responseAnchor(id)+'\n',file=await app.vault.create('Provider error.md',saved),first=app.workspace.getLeaf(false);await first.openFile(file);
  const second=app.workspace.createLeafBySplit(first,'vertical');await second.openFile(file);await second.setViewState({type:'markdown',state:{file:file.path,mode:'preview'}});const leaves=[first,second];
  const record:ResponseRecord={coordinated:true,migrating:true,owner:'fixture',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:4,nativeProjection:true,id,initialOwner:crypto.randomUUID(),vaultId:crypto.randomUUID(),host:{environmentId:'fixture',workspaceRoot:'/unavailable-host',directory:'.obsidian/inline'},notePath:file.path,threadId:'fixture-thread',messageId:'prompt',projectId:'fixture-project',threadEnvironmentId:'fixture',initialHash:contentHash(''),createdAt:at,intermediateMode:'collapse',threadTitle:'Provider error'}};
  let callbacks!:ThreadStreamCallbacks,lastBody='';
  const watch:typeof watchThread=(_id,_access,next)=>{callbacks=next;return {stop:()=>{}};};
  this.preview=new DirectInlinePreview(record,async()=>{throw Error('No network in provider error fixture');},update=>{lastBody=update.body;manager.stream(update);},watch);await manager.receive(record);this.preview.tick(true);
  const message='Selected model is at capacity. Please try a different model.';
  const snapshot=(sequence:number,status:string,text:string)=>({kind:'snapshot' as const,snapshot:normalizeV2Snapshot({snapshotSequence:sequence,projection:{thread:{id:'fixture-thread',projectId:'fixture-project',title:'Provider error'},messages:[{id:'prompt',role:'user',runId:'run',text:'Synthetic task',streaming:false,createdAt:at}],runs:[{id:'run',ordinal:1,userMessageId:'prompt',status,requestedAt:at,...(status==='failed'?{completedAt:at}:{})}],runtimeRequests:[],turnItems:[{id:'provider-error',runId:'run',ordinal:1,type:'error',status:'failed',failure:{message:text},startedAt:at,updatedAt:at}]}})});
  const rows:Array<{name:string;pass:boolean}>=[],check=(name:string,pass:boolean)=>rows.push({name,pass});
  const panels=()=>leaves.map(leaf=>leaf.view.containerEl.querySelector<HTMLElement>('.send-to-t3-provider-error'));
  callbacks.item(snapshot(1,'running',message));await until(()=>panels().every(panel=>!!panel?.querySelector('.lucide-circle-alert')&&!!panel.querySelector('time')?.textContent));
  check('native editor and Reading show the label, icon, message and local time',panels().every(panel=>panel?.textContent?.includes(message)&&panel.textContent.includes('Provider error')&&!!panel.querySelector('time')?.textContent));
  callbacks.item(snapshot(2,'failed',message));await until(()=>!lastBody.includes('inline-spinner'));
  check('terminal failure is displayed once on each surface',leaves.every(leaf=>leaf.view.containerEl.querySelectorAll('.send-to-t3-provider-error').length===1)&&lastBody.split(message).length===2);
  check('compact row has transparent background, no border and indented message',panels().every(panel=>{if(!panel)return false;const style=getComputedStyle(panel),body=panel.querySelector<HTMLElement>('.send-to-t3-provider-error-message')!,heading=panel.querySelector<HTMLElement>('.send-to-t3-provider-error-header')!;return style.backgroundColor==='rgba(0, 0, 0, 0)'&&parseFloat(style.borderTopWidth)===0&&parseFloat(getComputedStyle(body).paddingInlineStart)===24&&Number(getComputedStyle(heading).color.match(/\d+/g)?.[0])>Number(getComputedStyle(heading).color.match(/\d+/g)?.[1]);}));
  const wasDark=document.body.classList.contains('theme-dark');
  for(const dark of [true,false]){document.body.classList.toggle('theme-dark',dark);document.body.classList.toggle('theme-light',!dark);await pause(150);await this.capture(dark?'provider-error-dark.png':'provider-error-light.png');}
  document.body.classList.toggle('theme-dark',wasDark);document.body.classList.toggle('theme-light',!wasDark);
  const unsafe='<img src=x onerror="bad">\n**literal** > [!danger] '+('long-message-'.repeat(35));
  callbacks.item(snapshot(3,'failed',unsafe));await until(()=>panels().every(panel=>panel?.textContent?.includes('<img')));
  check('unsafe and multiline error stays plain text and wraps inside both panes',panels().every(panel=>!!panel?.textContent?.includes('**literal**')&&!panel.querySelector('img,script')&&panel.scrollWidth<=panel.clientWidth+1));await this.capture('provider-error-wrapped.png');
  check('generated display leaves saved note and editor data clean',await app.vault.read(file)===saved&&leaves.every(leaf=>(leaf.view as MarkdownView).getViewData()===saved));
  this.write('RESULT.json',{pass:rows.every(row=>row.pass),rows,body:lastBody,temporaryThreads:[],coverage:['VPS desktop Live Preview','VPS desktop Reading','dark theme','light theme','narrow panes'],nativeMobileTested:false});
 }
 onunload(){this.preview?.dispose();nativeResponses(this.app).dispose();}
}
