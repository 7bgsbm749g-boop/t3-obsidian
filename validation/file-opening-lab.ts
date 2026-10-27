import {MarkdownView,type Plugin} from 'obsidian';
import {CodebaseBridge} from '../codebase-native';
import type {CodebaseIO} from '../codebase-core';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** A real editor and native notices, with bounded synthetic transport delays.
 * Fixtures live only in the explicitly marked, unsynced lab. */
export async function runFileOpeningLab(plugin:Plugin,root:string){
  const app=plugin.app,uiDocument=app.workspace.containerEl.ownerDocument,write=(name:string,data:unknown)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2));
  const capture=async(name:string)=>fs.writeFileSync(path.join(root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
  const external=path.join(root,'external');fs.mkdirSync(external);
  const report='# Project report\n\nThe linked file is now open.\n';fs.writeFileSync(path.join(external,'report.md'),report);
  const scope={environmentId:'lab',projectId:'project',root:external,title:'File opening lab'},checks:Record<string,boolean>={},samples:unknown[]=[];
  let noticeDocument=uiDocument;
  let capturedOpening=false,loading:Promise<void>|undefined,started!:()=>void;const firstRead=new Promise<void>(resolve=>{started=resolve;});
  const io:CodebaseIO={catalog:async()=>{const pending=[...(bridge as any).openingFiles.values()][0];noticeDocument=pending?.notice.messageEl.ownerDocument??uiDocument;checks.noticeBeforeDiscovery=!!noticeDocument.querySelector('.send-to-t3-file-opening');await pause(400);return [scope];},list:async()=>({entries:[],truncated:false}),search:async()=>[],write:async()=>{throw Error('This lab does not edit project files');},resource:async()=>{throw Error('This lab does not load media');},read:async(_scope,file)=>{
    started();
    if(file==='report.md'){
      if(capturedOpening)return fs.readFileSync(path.join(external,file),'utf8');
      capturedOpening=true;
      loading=(async()=>{
        await pause(150);const notices=noticeDocument.querySelectorAll<HTMLElement>('.send-to-t3-file-opening'),notice=notices[0];
        checks.oneNoticeDuringRead=notices.length===1&&notice.textContent?.includes('Opening report.md')===true;
        if(!notice){write('notice-debug.json',{tracked:[...(bridge as any).openingFiles.values()].map((entry:any)=>({users:entry.users,message:entry.notice.messageEl?.outerHTML,container:entry.notice.containerEl?.outerHTML,connected:entry.notice.messageEl?.isConnected,sameDocument:entry.notice.messageEl?.ownerDocument===uiDocument})),notices:Array.from(noticeDocument.querySelectorAll('.notice')).map(el=>el.outerHTML)});throw Error('The native opening notice was absent during the file read');}
        const first=notice.ownerDocument.defaultView!.getComputedStyle(notice,'::before'),firstTransform=first.transform;
        samples.push({text:notice.textContent,role:notice.getAttribute('role'),animation:first.animationName,transform:firstTransform,bounds:notice.getBoundingClientRect().toJSON(),ownerUrl:notice.ownerDocument.URL,workspaceUrl:uiDocument.URL,ownerTitle:notice.ownerDocument.title});
        await capture('opening-first.png');await pause(180);
        const next=notice.ownerDocument.defaultView!.getComputedStyle(notice,'::before');checks.spinnerAnimates=next.animationName==='send-to-t3-file-opening-spin'&&next.transform!==firstTransform;
        samples.push({animation:next.animationName,transform:next.transform});await capture('opening-next.png');await pause(600);
      })();await loading;
      return fs.readFileSync(path.join(external,file),'utf8');
    }
    await pause(400);throw Error('Synthetic unavailable file');
  }};
  const bridge=new CodebaseBridge(app,plugin,io,()=>[],'file-opening-lab',{environments:()=>['lab'],load:()=>undefined,save:async()=>{}});await bridge.install();plugin.register(()=>bridge.dispose());
  const reference=app.vault.getFileByPath('Reference.md')!;
  await app.vault.modify(reference,`# File opening check\n\n[Open report](<${external}/report.md>)\n\nThe file opens after a short test delay.\n`);
  const leaf=app.workspace.getLeaf(false);await leaf.openFile(reference);await leaf.setViewState({type:'markdown',state:{file:reference.path,mode:'preview'}});await pause(500);
  await capture('ready-page.png');
  write('opening-ready.json',{link:external+'/report.md',note:reference.path,scope:'Separate test vault; synthetic delay; awaiting a real pointer click'});
  try{
    await Promise.race([firstRead,new Promise((_,reject)=>setTimeout(()=>reject(Error('No link click within 120 seconds')),120000))]);
    await loading;for(let attempt=0;attempt<100&&app.workspace.getActiveViewOfType(MarkdownView)?.file?.name!=='report.md';attempt++)await pause(50);
    const view=app.workspace.getActiveViewOfType(MarkdownView);checks.nativeFileDisplayed=view?.file?.name==='report.md'&&view.getViewData()===report;
    await pause(400);checks.noticeClearedOnSuccess=!noticeDocument.querySelector('.send-to-t3-file-opening');await capture('opened.png');
    await app.workspace.openLinkText(external+'/missing.md',reference.path,false);await pause(400);checks.noticeClearedOnError=!noticeDocument.querySelector('.send-to-t3-file-opening');checks.errorVisible=Array.from(noticeDocument.querySelectorAll('.notice')).some(el=>el.textContent?.includes('Synthetic unavailable file'));await capture('failed.png');
    checks.noProjectFilesInVault=!app.vault.getFiles().some(file=>file.path.startsWith('__t3_codebase__')||file.name==='report.md');
  }finally{
    bridge.dispose();for(const owned of ['Reference.md','Virtual.md']){const file=app.vault.getFileByPath(owned);if(file)await app.vault.delete(file);}
    checks.temporaryNotesDeleted=['Reference.md','Virtual.md'].every(name=>!app.vault.getAbstractFileByPath(name));
    checks.allNoticesCleared=!noticeDocument.querySelector('.send-to-t3-file-opening');
    fs.rmSync(external,{recursive:true});checks.externalFixturesDeleted=!fs.existsSync(external);
    write('RESULT.json',{pass:Object.values(checks).every(Boolean),checks,samples,testThreads:[],testNotes:['Reference.md','Virtual.md'],cleanupVerified:checks.temporaryNotesDeleted&&checks.externalFixturesDeleted,scope:'Actual VPS Obsidian native link click and editor, synthetic transport delays; no QLO2 test content, no T3 dispatch, no native phone coverage'});
  }
}
