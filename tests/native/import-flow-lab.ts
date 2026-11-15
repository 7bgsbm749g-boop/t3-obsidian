import {Plugin} from 'obsidian';
import {openRunImport,ImportThreadPicker,RunImportPicker,type RunImportHost} from '../../src/conversations/run-import-ui';
import {attachAllImportRuns,type ImportRun} from '../../src/conversations/run-import';
const fs=require('node:fs'),path=require('node:path'),remote=require('@electron/remote');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean){const start=performance.now();while(!check()){if(performance.now()-start>8000)throw Error('Import UI condition timed out');await pause(20);}}
/** Native UI with synthetic metadata in an unsynced vault. No T3 requests. */
export default class ImportFlowLab extends Plugin {
 private root='';private calls:Array<{id:string;follow:boolean}>=[];private threadPicker?:ImportThreadPicker;private runPicker?:RunImportPicker;
 async onload(){
  this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
  const lab=this,threadOpen=ImportThreadPicker.prototype.onOpen,runOpen=RunImportPicker.prototype.onOpen;
  ImportThreadPicker.prototype.onOpen=function(){lab.threadPicker=this;threadOpen.call(this);};
  RunImportPicker.prototype.onOpen=function(){lab.runPicker=this;runOpen.call(this);};
  this.register(()=>{ImportThreadPicker.prototype.onOpen=threadOpen;RunImportPicker.prototype.onOpen=runOpen;});
  this.app.workspace.onLayoutReady(()=>void this.run().catch(async error=>{this.write('ERROR.json',{error:String(error),stack:error.stack,notices:Array.from(document.querySelectorAll('.notice')).map(el=>el.textContent)});await this.capture('error.png');}));
 }
 private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
 private async capture(name:string){await pause(200);fs.writeFileSync(path.join(this.root,name),(await remote.getCurrentWebContents().capturePage()).toPNG());}
 private search(value:string){const input=document.querySelector<HTMLInputElement>('.prompt-input')!;input.value=value;input.dispatchEvent(new Event('input'));}
 private row(selector:string){
  const row=document.querySelector<HTMLElement>(selector);if(!row)throw Error('Missing native row: '+selector);
  const box=row.getBoundingClientRect(),options={bubbles:true,clientX:box.left+box.width/2,clientY:box.top+box.height/2,button:0};
  // Exercise Obsidian's public selection API and its real close/choose order.
  // Synthetic DOM clicks do not represent native suggestion selection.
  const event=new MouseEvent('click',options);
  if(selector==='.send-to-t3-import-thread'){const picker=this.threadPicker!;picker.selectSuggestion(picker.getSuggestions(picker.inputEl.value)[0],event);return;}
  if(selector==='.send-to-t3-all-runs'){const picker=this.runPicker!;picker.selectSuggestion(picker.getSuggestions('')[0],event);return;}
  row.dispatchEvent(event);
 }
 private async run(){
  remote.getCurrentWindow().setSize(1200,900);
  const projects=[{id:'atlas',title:'Atlas',workspaceRoot:'/synthetic/atlas',connectionId:'vps',connectionName:'VPS'},{id:'studio',title:'Studio',workspaceRoot:'/synthetic/studio',connectionId:'laptop',connectionName:'Laptop'}];
  const runs:ImportRun[]=[{messageId:'third',turnId:'third-run',turn:{turnId:'third-run',state:'running'},status:'Running',prompt:'Add keyboard navigation and check the empty states',createdAt:'2026-11-11T18:30:00Z'},{messageId:'second',turnId:'second-run',turn:{turnId:'second-run',state:'completed'},status:'Completed',prompt:'Polish the release dashboard and activity timeline',createdAt:'2026-11-11T17:00:00Z'},{messageId:'first',turnId:'first-run',turn:{turnId:'first-run',state:'completed'},status:'Completed',prompt:'Build the first release dashboard',createdAt:'2026-11-11T15:00:00Z'}];
  const host:RunImportHost={projects:()=>projects,projectLabel:p=>`${p.title} · ${p.connectionName}`,threads:async p=>p.id==='atlas'?[{id:'release-thread',projectId:p.id,title:'Build a release dashboard',status:'Active',branch:'feature/release-dashboard',updatedAt:'2026-11-11T18:30:00Z'},{id:'auth-thread',projectId:p.id,title:'Simplify the sign-in flow',status:'Idle',branch:'fix/sign-in',updatedAt:'2026-11-11T16:30:00Z'}]:[{id:'design-thread',projectId:p.id,title:'Explore the new activity timeline',status:'Idle',branch:'design/activity',updatedAt:'2026-11-11T18:00:00Z'},{id:'icons-thread',projectId:p.id,title:'Update the workspace icons',status:'Idle',updatedAt:'2026-11-10T16:00:00Z'}],runs:async()=>runs,preview:async(_p,_t,run,el)=>{el.createEl('p',{text:run.status==='Running'?'Checking keyboard navigation and empty states…':'The release dashboard now has a clearer activity timeline, compact status rows, and a summary of the latest changes.'});},attach:async(_p,_t,run,follow)=>{this.calls.push({id:run.messageId,follow});return {duplicate:false,following:follow,saveState:'saved'};},attachAll:async(p,t,runs,follow)=>attachAllImportRuns(runs,follow,(run,follow)=>host.attach(p,t,run,follow))};
  openRunImport(this.app,'Reference.md',host);
  await until(()=>document.querySelectorAll('.send-to-t3-import-thread').length===4);
  const titles=Array.from(document.querySelectorAll('.send-to-t3-import-thread .send-to-t3-import-title')).map(el=>el.textContent);
  if(titles.join('|')!=='Build a release dashboard|Explore the new activity timeline|Simplify the sign-in flow|Update the workspace icons')throw Error('Threads were not sorted across projects');
  await this.capture('recent-threads.png');
  this.search('Laptop');await until(()=>document.querySelectorAll('.send-to-t3-import-thread').length===2);this.search('Build a release dashboard');await until(()=>document.querySelectorAll('.send-to-t3-import-thread').length===1);
  this.row('.send-to-t3-import-thread');await until(()=>!!document.querySelector('.send-to-t3-all-runs'));await this.capture('run-selection.png');
  this.row('.send-to-t3-import-back');await until(()=>document.querySelectorAll('.send-to-t3-import-thread').length===4);
  this.search('Build a release dashboard');await until(()=>document.querySelectorAll('.send-to-t3-import-thread').length===1);this.row('.send-to-t3-import-thread');await until(()=>!!document.querySelector('.send-to-t3-all-runs'));
  const preview=document.querySelector<HTMLElement>('[data-t3-import-run="second"]')!;preview.dispatchEvent(new PointerEvent('pointerenter'));await until(()=>preview.classList.contains('is-previewing'));await this.capture('run-preview.png');
  this.row('.send-to-t3-all-runs');await until(()=>!!document.querySelector('.modal-title')?.textContent?.includes('Import all T3'));await this.capture('all-runs-confirmation.png');
  const confirm=Array.from(document.querySelectorAll<HTMLButtonElement>('.modal button')).find(button=>button.textContent==='Import all 3 runs');if(!confirm)throw Error('Missing all-runs confirmation');confirm.click();await until(()=>this.calls.length===3);
  if(this.calls.map(call=>call.id).join(',')!=='first,second,third'||this.calls.some(call=>call.follow))throw Error('All runs did not keep order or follow default');
  openRunImport(this.app,'Reference.md',host);await until(()=>document.querySelectorAll('.send-to-t3-import-thread').length===4);remote.getCurrentWindow().setSize(430,850);await this.capture('recent-threads-narrow.png');
  const modal=document.querySelector('.send-to-t3-thread-picker')!;if(modal.getBoundingClientRect().right>window.innerWidth+1)throw Error('Narrow picker overflow');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  // Close the remaining fixture modal through its native close control.
  document.querySelector<HTMLElement>('.modal-close-button')?.click();
  for(const name of ['Reference.md','Virtual.md']){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
  this.write('RESULT.json',{pass:true,scope:'Real native Obsidian UI; synthetic projects, threads, runs and attach results; no Sync or native mobile claim',checks:{crossProjectOrder:true,machineSearch:true,back:true,preview:true,allRuns:true,narrowViewport:true},calls:this.calls,cleanup:{remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),openImportModals:document.querySelectorAll('.send-to-t3-thread-picker,.send-to-t3-run-picker').length},testThreads:[],dispatches:0});
 }
}
