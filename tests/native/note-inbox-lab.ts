/** Runs only in an existing synthetic test vault. Exercises the installed
 * product explorer mode with synthetic stream projections, without dispatching
 * prompts or publishing fixture bindings to plugin settings/Sync. */
import {Plugin,TFile,Notice} from 'obsidian';
import {updateResponseBindingData} from '../../src/responses/response-binding-data';
import {changeNoteInbox,inboxNotes} from '../../src/notes/note-inbox';
import {readInlineSnapshot,PendingThreadError,type ThreadAccess} from '../../src/conversations/thread-stream';
import {readNewThreadDefaults} from '../../src/conversations/model-defaults';
import {deviceState} from '../../src/storage/device-state';
declare const INBOX_LAB_REPORT:string;
declare const INBOX_LAB_VAULT:string;
declare const INBOX_LAB_ENVIRONMENT:string;
const folder='T3 inbox validation';
export default class InboxLab extends Plugin {
  private cleanup?:()=>Promise<void>;
  private nativeProof?:unknown;
  private selectionProof?:unknown;
  private capabilities?:unknown;
  private files:TFile[]=[];
  private access?:ThreadAccess;private ownedThreads:string[]=[];private backend?:unknown;
  onload(){
    this.registerDomEvent(window,'error',event=>{if(event.error instanceof TypeError||event.error instanceof ReferenceError){const message=String(event.error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,300);require('node:fs').appendFileSync(INBOX_LAB_REPORT.replace('.json','-errors.jsonl'),JSON.stringify({name:event.error.name,message})+'\n');}});
    this.addCommand({id:'cleanup',name:'Finish inbox validation',callback:()=>{if(this.cleanup)void this.cleanup().catch(error=>{this.write({phase:'cleanup-failed',error:String(error)});new Notice(String(error));});}});
    this.registerEvent(this.app.workspace.on('files-menu',(_menu,files,source)=>{if(files.length&&files.every(file=>file.path.startsWith(folder+'/'))){this.selectionProof={source,paths:files.map(file=>file.path)};this.write({phase:'native-selection'});}}));
    this.app.workspace.onLayoutReady(()=>void this.start().catch(error=>{this.write({phase:'setup-failed',error:String(error)});new Notice(String(error));}));
  }
  private write(value:unknown){require('node:fs').writeFileSync(INBOX_LAB_REPORT,JSON.stringify({...value as object,nativeFilter:this.nativeProof,nativeSelection:this.selectionProof,nativeCapabilities:this.capabilities,backend:this.backend,threadIds:this.ownedThreads,notePaths:this.files.map(file=>file.path),notesStayedInFolder:this.files.every(file=>file.path.startsWith(folder+'/'))},null,2));}
  private async start(){
    if(this.app.vault.getName()!==INBOX_LAB_VAULT)throw Error('Use the configured synthetic test vault.');
    const plugins=(this.app as any).plugins;await plugins.loadManifests();await plugins.enablePlugin('t-three-code');
    const product=plugins.plugins['t-three-code'];if(!product?.noteInboxView)throw Error('The candidate inbox plugin is not loaded.');
    if(!this.app.workspace.getLeavesOfType('file-explorer').length){const leaf=this.app.workspace.getLeftLeaf(false);if(!leaf)throw Error('The file explorer is unavailable.');await leaf.setViewState({type:'file-explorer',active:true});}
    if(this.app.vault.getAbstractFileByPath(folder))throw Error('Fixture folder already exists. Preserve it.');
    const original={save:product.save,bindings:product.settings.responseBindings,inbox:product.settings.noteInbox,explorer:product.deviceInline.explorerResponses,view:product.inboxViewState};
    const created:string[]=[],ids:string[]=[],responses:any[]=[],actions:any[]=[];
    this.cleanup=async()=>{
      await Promise.allSettled([...product.inboxActions.values()]);
      product.save=original.save;product.deviceInline.explorerResponses=original.explorer;
      for(const id of ids){delete product.settings.responseBindings[id];delete product.responseBindingReplica[id];delete product.settings.noteInbox[id];}
      await deviceState(`response-bindings:${product.deviceId}:${product.settings.vaultId}`,product.responseBindingReplica);
      for(const [id,receipt] of product.completionGlow.receipts)if(receipt.notePath.startsWith(folder+'/'))product.completionGlow.receipts.delete(id);
      product.completionGlow.persist();
      await deviceState(`note-inbox:${product.deviceId}:${product.settings.vaultId}`,product.settings.noteInbox);
      product.inboxViewState=original.view;this.app.saveLocalStorage(`t3-note-inbox-view:${product.settings.vaultId}`,original.view);
      for(const file of this.files)if(this.app.vault.getAbstractFileByPath(file.path)===file)await this.app.vault.delete(file);
      const directory=this.app.vault.getAbstractFileByPath(folder);if(directory)await this.app.vault.delete(directory,true);
      // Native note opening creates identity receipts even without dispatch.
      // Remove only this lab's history from both replicas after saves finish.
      await product.saving;
      const disk=await product.loadData();
      for(const id of ids){delete disk.responseBindings?.[id];delete disk.noteInbox?.[id];}
      for(const smart of [disk.smartSend,product.smartReplica,product.settings.smartSend])if(smart){
        const owned=new Set(Object.entries(smart.notes??{}).filter(([,note]:[string,any])=>note.path.startsWith(folder+'/')).map(([id])=>id));
        for(const id of owned)delete smart.notes[id];
        for(const key of ['responses','heads','noteEdits','recoveries'])for(const [id,entry] of Object.entries(smart[key]??{}) as [string,any][])if(owned.has(entry.noteId))delete smart[key][id];
      }
      await deviceState(`smart-send:${product.deviceId}:${product.settings.vaultId}`,product.smartReplica);
      await product.saveData(disk);product.lastDiskSnapshot=JSON.stringify(disk);product.sharedBaseline=JSON.stringify(product.sharedSnapshot());
      if(this.access){
        for(const threadId of this.ownedThreads){
          try{await readInlineSnapshot(this.access,threadId);}catch(error){if(error instanceof PendingThreadError)continue;throw error;}
          await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId,onlyIfUnused:true});
          try{const snapshot=await readInlineSnapshot(this.access,threadId);if(!snapshot.thread.deletedAt)throw Error('An owned test thread was not deleted.');}catch(error){if(!(error instanceof PendingThreadError))throw error;}
        }
        await this.access.close?.();this.access=undefined;
      }
      product.refreshFolderIndicators();this.write({phase:'clean',ownedThreadsDeleted:this.ownedThreads.length,version:product.manifest.version,ownedNotesRemoved:!this.app.vault.getFolderByPath(folder)&&this.files.every(file=>this.app.vault.getAbstractFileByPath(file.path)!==file),fixtureBindingsRemoved:ids.every(id=>!product.settings.responseBindings[id]&&!product.responseBindingReplica[id]),fixtureStateRemoved:ids.every(id=>!product.settings.noteInbox[id]),actions});new Notice('Inbox validation fixtures removed.');
    };
    const environmentId=INBOX_LAB_ENVIRONMENT;
    if(!product.settings.paired.some((connection:{environmentId:string})=>connection.environmentId===environmentId))throw Error('Connect the configured native test machine first.');
    this.access=await product.inlineThreadAccess(environmentId);const access=this.access!;
    const project=await product.commandProject(environmentId),defaults=await readNewThreadDefaults(access.api,access.origin,project);
    await this.app.vault.createFolder(folder);
    const createThread=async(title:string)=>{
      const threadId=crypto.randomUUID();this.ownedThreads.push(threadId);
      await access.api('/api/orchestration/dispatch',{type:'thread.create',commandId:crypto.randomUUID(),threadId,projectId:project.id,title:'Synthetic inbox validation: '+title,modelSelection:defaults.modelSelection,runtimeMode:defaults.runtimeMode,interactionMode:'default',branch:null,worktreePath:null,createdAt:new Date().toISOString()});
      return threadId;
    };
    const backend=async()=>{const states=[];for(const threadId of this.ownedThreads){const snapshot=await readInlineSnapshot(access,threadId,project.id);states.push({threadId,settled:snapshot.thread.settledOverride==='settled'});}this.backend=states;};
    product.save=async()=>{await backend();actions.push({at:new Date().toISOString(),state:JSON.parse(JSON.stringify(product.settings.noteInbox)),backend:this.backend});this.write({phase:'actions',version:product.manifest.version,scope:'Installed product; synthetic stream projections; real idle T3 threads; no provider runs/Sync claim',actions});};
    const titles=['Release checklist','Update the documentation','Plan the next feature','Review the agent question','Follow up tomorrow','Completed investigation','Past stream retained'];
    for(let index=0;index<titles.length;index++){
      const path=`${folder}/${titles[index]}.md`,file=await this.app.vault.create(path,`# ${titles[index]}\n\nSynthetic note for native inbox validation.\n`);created.push(file.path);this.files.push(file);
      const id=crypto.randomUUID(),threadId=await createThread(titles[index]);ids.push(id);
      product.settings.responseBindings=updateResponseBindingData(product.settings.responseBindings,{version:4,localOnly:true,nativeProjection:true,responseContainer:true,id,vaultId:product.settings.vaultId,initialOwner:product.deviceId,host:{environmentId,workspaceRoot:project.workspaceRoot,directory:'.t3-obsidian'},notePath:path,threadId,messageId:crypto.randomUUID(),projectId:project.id,threadEnvironmentId:environmentId,initialHash:'0'.repeat(64),createdAt:new Date(Date.now()-index*60_000).toISOString()},product.deviceId);
      responses.push({id,notePath:path,epoch:1,revision:1,active:index===1,input:index===3,complete:index!==1&&index!==3});
    }
    const extraId=crypto.randomUUID(),extraThread=await createThread('Second thread in Plan');ids.push(extraId);
    const originalBinding=product.settings.responseBindings[ids[2]].request;
    product.settings.responseBindings=updateResponseBindingData(product.settings.responseBindings,{...originalBinding,id:extraId,threadId:extraThread,messageId:crypto.randomUUID()},product.deviceId);
    responses.push({id:extraId,notePath:created[2],epoch:1,revision:1,active:false,input:false,complete:true});
    product.responseBindingReplica=product.settings.responseBindings;
    const unbound=await this.app.vault.create(`${folder}/Ordinary note without streams.md`,'# This note must not appear in the inbox\n');created.push(unbound.path);this.files.push(unbound);
    product.deviceInline.explorerResponses=()=>[...original.explorer.call(product.deviceInline),...responses];
    // The installed product still owns grouping, rendering, actions and local
    // persistence. Block shared publication of all synthetic fixture records.
    const bindings=Object.values(product.settings.responseBindings).map((entry:any)=>entry.request);
    for(const [index,action] of [[0,{kind:'pin',value:true}],[4,{kind:'snoozed',until:Date.now()+3_600_000}],[5,{kind:'settled'}]] as const){
      const note=inboxNotes(bindings as any,[],new Map(),product.settings.noteInbox??{},product.settings.vaultId,()=>true).find(note=>note.path===created[index])!;
      product.settings.noteInbox=changeNoteInbox(product.settings.noteInbox??{},note,action,product.deviceId);
    }
    await access.api('/api/orchestration/dispatch',{type:'thread.settle',commandId:crypto.randomUUID(),threadId:this.ownedThreads[5]});await backend();
    product.refreshFolderIndicators();
    await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));
    const explorer=this.app.workspace.getLeavesOfType('file-explorer')[0]?.view.containerEl;
    const tab=(this.app.workspace.getLeavesOfType('file-explorer')[0] as any)?.tabHeaderEl as HTMLElement|undefined;
    const toggle=tab?.parentElement?.querySelector<HTMLButtonElement>('.t3-note-inbox-toggle');
    const nativeView=this.app.workspace.getLeavesOfType('file-explorer')[0]?.view as any,tree=nativeView?.tree,root=tree?.root;
    const codebaseTab=(this.app.workspace.getLeavesOfType('t3-codebase')[0] as any)?.tabHeaderEl as HTMLElement|undefined;
    this.capabilities={topModeRow:!!toggle&&toggle.parentElement===tab?.parentElement,nextToCodebase:!!toggle&&codebaseTab?.nextElementSibling===toggle,insideFileActions:!!toggle&&!!explorer?.querySelector('.nav-buttons-container')?.contains(toggle),ready:nativeView?.ready,registeredRoot:!!root,rootChildren:typeof root?.vChildren?.setChildren,viewMethods:Object.fromEntries(['getSortedFolderItems','getNodeId','isItem','sort'].map(key=>[key,typeof nativeView?.[key]])),treeFields:tree?Object.keys(tree):[],treeMethods:Object.fromEntries(['clearSelectedDoms','deselectItem','saveFolds','requestSaveFolds'].map(key=>[key,typeof tree?.[key]])),selectionValues:typeof tree?.selectedDoms?.values,invalidate:typeof tree?.infinityScroll?.invalidateAll,toggle:!!toggle};
    if(explorer&&toggle){const record=(event:Event)=>{
      if(!(event.target as HTMLElement)?.closest?.('.t3-note-inbox-toggle,.t3-note-inbox-heading'))return;
      const view=this.app.workspace.getLeavesOfType('file-explorer')[0].view as any;
      const paths=[...product.inboxNotes().map((note:any)=>note.path).filter((path:string)=>path.startsWith(folder+'/')),unbound.path];
      const before=paths.map(path=>view.fileItems[path]).filter(Boolean).map((item:any)=>({title:item.selfEl,row:item.el,item,font:item.selfEl.isConnected?window.getComputedStyle(item.selfEl).fontSize:undefined}));
      window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>{
        const enabled=explorer.classList.contains('t3-note-inbox-mode');
        const visible=view.tree.root.vChildren.children.filter((item:any)=>item.file?.path?.endsWith('.md')),visibleSet=new Set(visible);
        this.nativeProof={enabled,originalElementsRetained:before.every(item=>item.item.el===item.row&&item.item.selfEl===item.title),normalFontRetained:before.filter(item=>item.font&&visibleSet.has(item.item)).every(item=>window.getComputedStyle(item.item.selfEl).fontSize===item.font),storedViewState:this.app.loadLocalStorage(`t3-note-inbox-view:${product.settings.vaultId}`),nativeItems:before.length,eligible:visible.map((item:any)=>item.file.path),headers:Array.from(explorer.querySelectorAll<HTMLElement>('.t3-note-inbox-heading')).map(header=>({text:header.textContent,height:header.getBoundingClientRect().height,font:window.getComputedStyle(header).fontSize})),noteGeometry:visible.map((item:any)=>({path:item.file.path,height:item.selfEl.getBoundingClientRect().height,display:window.getComputedStyle(item.el).display})),customNoteControls:explorer.querySelectorAll('.t3-note-inbox-open,.t3-note-inbox-actions,.t3-note-inbox-detail,.t3-note-inbox-search').length};
        this.write({phase:'native-filter',version:product.manifest.version,actions});
      }));
    };explorer.addEventListener('click',record,true);toggle.addEventListener('click',record,true);}
    const first=this.app.vault.getAbstractFileByPath(created[0]);if(first instanceof TFile)await this.app.workspace.getLeaf(false).openFile(first);
    this.write({phase:'ready',version:product.manifest.version,scope:'Installed product; synthetic stream projections; real idle T3 threads; no provider runs/Sync claim',notes:created,streamIds:ids,expected:{pinned:1,working:1,regular:3,snoozed:1,settled:1,unboundExcluded:true}});
    new Notice('Inbox validation ready. Open the T3 mode in Files.');
  }
}
