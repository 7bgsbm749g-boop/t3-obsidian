import type {App,MarkdownView} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {contentHash} from '../completion';
import type {ResponseRecord} from '../response-record';

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** Deliberately separate host completion from local note arrival in a real,
 * unsynced Obsidian client. No live leases, Sync state or settings are altered. */
export async function nativeResponseHandoff(app:App,root:string){
  const fs=require('node:fs'),path=require('node:path'),rows:any[]=[];
  const manager=nativeResponses(app),leaves=app.workspace.getLeavesOfType('markdown').slice(0,2);
  for(const mode of ['preview','source','live-preview'] as const){
    const id=crypto.randomUUID(),token=`HANDOFF_VISIBLE_${mode.replace(/-/g,'_')}`,body=`> ${token}`;
    const before='# Handoff fixture\n\n'+responseAnchor(id)+'\n\nOrdinary tail\n',final=before.replace(responseAnchor(id),body);
    const file=await app.vault.create(`Handoff-${mode}.md`,before);
    for(const leaf of leaves){await leaf.openFile(file);await leaf.setViewState({...leaf.getViewState(),state:{...leaf.getViewState().state,mode:mode==='preview'?'preview':'source',source:mode==='source'}});}
    const views=leaves.map(leaf=>leaf.view as MarkdownView),displayed=views.map(view=>view.getViewData.bind(view));
    const active:ResponseRecord={request:{version:3,id,vaultId:'fixture',host:{environmentId:'fixture',workspaceRoot:'/fixture',directory:'.obsidian/t3-code/inline/v1'},notePath:file.path,threadId:'fixture',messageId:id,projectId:'fixture',threadEnvironmentId:'fixture',createdAt:new Date().toISOString(),initialHash:'fixture'},coordinated:true,owner:'fixture',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,state:{requestHash:'fixture',accepted:true,notePath:file.path,status:'running',hashes:[],body,updatedAt:''}};
    await manager.receive(active);await pause(300);
    const completed:ResponseRecord={...active,revision:2,state:{...active.state!,status:'complete',finalSaved:true,cleanupComplete:true,finalBody:body,delivery:{commitId:crypto.randomUUID(),hash:contentHash(final),verifiedOnHost:true,observedBy:[]}}};
    let samples=0,blank=0,savedLeak=0,done=false;
    const sample=()=>{if(done)return;samples++;if(displayed.some(read=>!read().includes(token)))blank++;if(views.some(view=>view.getViewData().includes(token)&&!manager.view(view)?.hasMaterialized(id)))savedLeak++;requestAnimationFrame(sample);};
    requestAnimationFrame(sample);
    const refresh=setInterval(()=>manager.refresh(),150);
    try{
      await manager.receive(completed);await pause(10_000);
      const pendingScreenshot=require('@electron/remote').getCurrentWebContents().capturePage();
      fs.writeFileSync(path.join(root,`handoff-${mode}-pending.png`),(await pendingScreenshot).toPNG());
      const pendingSaved=await app.vault.read(file),pendingVisible=displayed.every(read=>read().includes(token));
      await app.vault.modify(file,final);await manager.changed(file.path);await pause(500);
      rows.push({name:`native-handoff-${mode}-delayed-note`,pass:blank===0&&savedLeak===0&&pendingSaved===before&&pendingVisible&&views.every(view=>manager.view(view)?.hasMaterialized(id))&&await app.vault.read(file)===final,samples,blankFrames:blank,partialSaveFrames:savedLeak,delayMs:10_000});
      fs.writeFileSync(path.join(root,`handoff-${mode}-adopted.png`),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
    }finally{done=true;clearInterval(refresh);manager.dispose();}
  }
  return rows;
}
