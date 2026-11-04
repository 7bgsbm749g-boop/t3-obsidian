import {Component,Plugin,MarkdownRenderer,MarkdownView} from 'obsidian';
import {ImportRunModal,RunImportPicker,RUN_PREVIEW_DELAY} from '../../src/conversations/run-import-ui';
import {availableImportRun,type ImportRun} from '../../src/conversations/run-import';
import {renderRunImportPreview} from '../../src/conversations/run-import-preview';
import {HtmlResultViews} from '../../src/responses/html-result-view';
import {HtmlResultStore} from '../../src/responses/html-result-store';
import type {HtmlResultReference} from '../../src/responses/html-results';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean,timeout=8000){const start=performance.now();while(!check()){if(performance.now()-start>timeout)throw Error('Native lab condition timed out');await pause(10);}}

/** Unsynced native picker lab. Optional fixtures are the original synthetic
 * Logile apps from run 4, never private response records or account state. */
export default class RunImportLab extends Plugin {
 private root='';private picker?:RunImportPicker;private views?:HtmlResultViews;private downloads=0;
 private pages=new Map<string,string>();private references:HtmlResultReference[]=[];
 private heavy!:ImportRun;private runs:ImportRun[]=[];private longTasks:number[]=[];
 async onload(){
  this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
  this.addCommand({id:'cleanup',name:'Clean up run import fixture',callback:()=>void this.cleanup()});
  this.addCommand({id:'show',name:'Show run import fixture',callback:()=>this.show()});
  this.addCommand({id:'capture',name:'Capture run import fixture',callback:()=>void this.nativeCapture()});
  this.app.workspace.onLayoutReady(()=>void this.run().catch(async error=>{this.write('ERROR.json',{error:String(error),stack:error.stack});await this.capture('error.png');await this.cleanup();}));
 }
 private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
 private async capture(name:string){const doc=this.picker?.modalEl.ownerDocument??document,win=doc.defaultView as any,remote=win.require?win.require('@electron/remote'):require('@electron/remote');const image=await remote.getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root,name),image.toPNG());}
 private async nativeCapture(){const doc=this.picker?.modalEl.ownerDocument??document;this.write('NATIVE.json',{expanded:doc.querySelector('.send-to-t3-run-row.is-previewing')?.getAttribute('data-t3-import-run'),frames:doc.querySelectorAll('.send-to-t3-run-preview iframe').length,modalText:doc.querySelector('.send-to-t3-run-picker')?.textContent});await this.capture('native-check.png');}
 private makeViews(){const cache=new Map();return new HtmlResultViews(this.app,new HtmlResultStore({read:async key=>cache.get(key),write:async(key,value)=>{cache.set(key,value);}},async()=>({origin:'https://fixture.test',api:async(route,payload)=>{
  if(route==='/api/orchestration/turn-item'){const ref=this.references.find(r=>r.itemId===payload.itemId)!;return {id:ref.itemId,threadId:ref.threadId,runId:ref.runId,type:'dynamic_tool',toolName:'t3-code.html_render',status:'completed',updatedAt:ref.revision,output:{htmlRender:ref}};}
  return {relativeUrl:'/api/assets/'+payload.resource.attachmentId,expiresAt:Date.now()+60000};
 }}),async url=>{this.downloads++;await pause(50);return {status:200,mimeType:'text/html',bytes:new TextEncoder().encode(this.pages.get(url.split('/').at(-1)!)!).buffer};}));}
 private show(baseline=false){
  const previous=this.picker;this.picker=undefined;previous?.close();
  const views=this.views!;
  this.picker=new RunImportPicker(this.app,this.runs,run=>new ImportRunModal(this.app,'Reference.md',{id:'source',projectId:'fixture',updatedAt:'2026-10-27T22:42:06.279Z',title:'Logile fixture',status:'Idle'},run,async()=>{throw Error('Fixture never imports or dispatches');}).open(),async(run,el,child,signal)=>{
   if(!baseline)return renderRunImportPreview(this.app,run,el,child,signal,views);
   el.empty();await MarkdownRenderer.render(this.app,run.preview!.body,el,'',child);
   for(const ref of run.preview!.html){if(signal.aborted)return;const mounted=views.mount(ref,el.ownerDocument,false,undefined,{passive:true});el.append(mounted.root);child.register(()=>mounted.dispose());}
  });this.picker.scope.register([],'F12',()=>{void this.nativeCapture();return false;});this.picker.open();return this.picker;
 }
 private async trial(baseline:boolean,cold:boolean){
  if(cold){this.views?.dispose();this.views=this.makeViews();}
  this.show(baseline);this.picker!.modalEl.style.pointerEvents='none';await pause(40);const modal=this.picker!.modalEl,row=modal.querySelector<HTMLElement>('[data-t3-import-run="logile"]')!;
  const before=modal.getBoundingClientRect(),downloads=this.downloads,start=performance.now();
  row.dispatchEvent(new PointerEvent('pointerenter'));
  await until(()=>{if(!row.isConnected)throw Error('Picker disappeared before content was prepared');return !!row.querySelector('[data-t3-html-prepared="true"]');});
  const prepared=performance.now()-start;
  await until(()=>{if(!row.isConnected)throw Error('Picker disappeared before frame paint');return !!row.querySelector('[data-t3-html-painted="true"]');});
  const paint=performance.now()-start,frames=row.querySelectorAll('iframe').length;
  await until(()=>row.classList.contains('is-previewing'));await pause(30);
  const after=modal.getBoundingClientRect(),panel=modal.querySelector<HTMLElement>('.prompt-results')!,box=panel.getBoundingClientRect();
  const below=Array.from(panel.querySelectorAll<HTMLElement>('.suggestion-item')).slice(1).filter(el=>{const r=el.getBoundingClientRect();return r.top>=row.getBoundingClientRect().bottom-1&&r.bottom<=box.bottom+1;}).length;
  if(before.height!==after.height||before.width!==after.width||below<2)throw Error('Popup resized or lost following rows');
  const result={preparedMs:prepared,paintMs:paint,revealMs:performance.now()-start,frames,downloads:this.downloads-downloads,followingRows:below,modalHeight:after.height};
  if(!baseline&&!cold)await this.capture('preview-'+Date.now()+'.png');
  this.picker!.close();this.picker=undefined;await pause(300);if(modal.ownerDocument.querySelector('.send-to-t3-run-preview'))throw Error('Preview was not disposed');return result;
 }
 private async run(){
  const fixtures=path.join(this.root,'fixtures');
  const names=fs.existsSync(fixtures)?fs.readdirSync(fixtures).filter((name:string)=>name.endsWith('.html')):[];
  if(!names.length)throw Error('Copy the original Logile synthetic HTML fixtures into the lab fixtures directory.');
  this.references=names.map((name:string,index:number)=>{const id='logile-'+index;this.pages.set(id,fs.readFileSync(path.join(fixtures,name),'utf8'));return {version:1,environmentId:'synthetic',threadId:'logile-fixture',runId:'run-4',itemId:id,revision:'2026-10-27T22:42:06.279Z',attachmentId:id,title:name,height:900};});
  const base={messageId:'logile',turnId:'run-4',turn:{turnId:'run-4',state:'completed' as const},status:'Completed' as const,createdAt:'2026-10-27T22:10:38.224Z',prompt:'Logile Pilot — five full application mockups',preview:{body:'**Logile Pilot** — original application previews.',html:this.references}};
  this.heavy=base;this.runs=[base,...Array.from({length:10},(_,i)=>({...base,messageId:'other-'+i,status:i===0?'Running' as const:i===1?'Failed' as const:i===2?'Interrupted' as const:'Completed' as const,prompt:i===3?'An exceptionally long run name with spaces and a very long identifier '.repeat(9):'Another response '+(i+1),preview:{body:'A concise response with **formatted text**.',html:[]}})),{...base,messageId:'unavailable',status:'Unavailable',unavailable:'A completely new unavailable reason'},{...base,messageId:'flagged',unavailable:'Unexpected reason'}];
  this.views=this.makeViews();
  const observer=new PerformanceObserver(list=>{for(const item of list.getEntries())this.longTasks.push(item.duration);});observer.observe({type:'longtask',buffered:false});this.register(()=>observer.disconnect());
  const measurements:any[]=[];
  for(const baseline of [true,false])for(const cold of [true,false])for(let sample=0;sample<8;sample++){this.write('PROGRESS.json',{baseline,cold,sample});measurements.push({baseline,cold,sample,...await this.trial(baseline,cold)});this.write('SAMPLES.json',measurements);}
  const groups=[true,false].flatMap(baseline=>[true,false].map(cold=>{const values=measurements.filter(x=>x.baseline===baseline&&x.cold===cold).map(x=>x.paintMs).sort((a,b)=>a-b);return {baseline,cold,p50:values[Math.floor(values.length/2)],p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)};}));
  this.show();await pause(50);
  const rows=this.picker!.modalEl.querySelectorAll<HTMLElement>('.suggestion-item');if(rows.length!==this.runs.filter(availableImportRun).length)throw Error('Unavailable run reached picker');
  rows[0].dispatchEvent(new PointerEvent('pointerenter'));await pause(50);rows[1].dispatchEvent(new PointerEvent('pointerenter'));await pause(RUN_PREVIEW_DELAY+80);
  if(rows[0].classList.contains('is-previewing')||!rows[1].classList.contains('is-previewing'))throw Error('Rapid hover displayed stale response');
  this.picker!.close();this.picker=undefined;await pause(300);this.show();await this.capture('picker.png');
  (window as any).runImportLab={picker:this.picker,show:()=>this.show(),cleanup:()=>this.cleanup()};
  this.write('RESULT.json',{pass:true,sourceThreadId:'7ab7b91e-c690-5279-af7c-2771243409fd',sourceRunOrdinal:4,scope:'Actual original Logile synthetic HTML bytes; real Obsidian picker and frame painting; simulated 50 ms asset transport; no real network latency, Sync, delivery or native mobile claim.',measurements,groups,longTasks:this.longTasks,fixtureBytes:[...this.pages.values()].reduce((sum,html)=>sum+new TextEncoder().encode(html).length,0),checks:{unavailableExcluded:true,fixedPopup:true,twoFollowingRows:true,rapidHover:true,disposed:true},testThreads:[],dispatches:0});
 }
 private async cleanup(){
  this.picker?.close();this.views?.dispose();
  for(const leaf of this.app.workspace.getLeavesOfType('markdown'))if(['Reference.md','Virtual.md'].includes((leaf.view as MarkdownView).file?.path??''))leaf.detach();
  for(const name of ['Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
  this.write('CLEANUP.json',{testThreads:[],deletedNotes:['Reference.md','Virtual.md'],remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path)});
 }
}
