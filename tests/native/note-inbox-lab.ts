/** Runs only in an existing synthetic test vault. Exercises the installed
 * product explorer mode with synthetic stream projections, without dispatching
 * prompts or publishing fixture bindings to plugin settings/Sync. */
import {Plugin,TFile,Notice} from 'obsidian';
import {updateResponseBindingData} from '../../src/responses/response-binding-data';
import {changeNoteInbox,inboxNotes} from '../../src/notes/note-inbox';
import {deviceState} from '../../src/storage/device-state';
declare const INBOX_LAB_REPORT:string;
declare const INBOX_LAB_VAULT:string;
const folder='T3 inbox validation';
export default class InboxLab extends Plugin {
  private cleanup?:()=>Promise<void>;
  onload(){
    this.addCommand({id:'cleanup',name:'Finish inbox validation',callback:()=>{if(this.cleanup)void this.cleanup().catch(error=>{this.write({phase:'cleanup-failed',error:String(error)});new Notice(String(error));});}});
    this.app.workspace.onLayoutReady(()=>void this.start().catch(error=>{this.write({error:String(error)});new Notice(String(error));}));
  }
  private write(value:unknown){require('node:fs').writeFileSync(INBOX_LAB_REPORT,JSON.stringify(value,null,2));}
  private async start(){
    if(this.app.vault.getName()!==INBOX_LAB_VAULT)throw Error('Use the configured synthetic test vault.');
    const plugins=(this.app as any).plugins;await plugins.loadManifests();await plugins.enablePlugin('t-three-code');
    const product=plugins.plugins['t-three-code'];if(!product?.noteInboxView)throw Error('The candidate inbox plugin is not loaded.');
    if(this.app.vault.getAbstractFileByPath(folder))throw Error('Fixture folder already exists. Preserve it.');
    await this.app.vault.createFolder(folder);
    const original={save:product.save,bindings:product.settings.responseBindings,inbox:product.settings.noteInbox,explorer:product.deviceInline.explorerResponses,view:product.inboxViewState};
    const created:string[]=[],ids:string[]=[],responses:any[]=[],actions:any[]=[];
    product.save=async()=>{actions.push({at:new Date().toISOString(),state:product.settings.noteInbox});this.write({phase:'actions',version:product.manifest.version,scope:'Installed product; synthetic stream projections; no provider/Sync claim',actions});};
    const titles=['Release checklist','Update the documentation','Plan the next feature','Review the agent question','Follow up tomorrow','Completed investigation','Past stream retained'];
    for(let index=0;index<titles.length;index++){
      const path=`${folder}/${titles[index]}.md`,file=await this.app.vault.create(path,`# ${titles[index]}\n\nSynthetic note for native inbox validation.\n`);created.push(file.path);
      const id=crypto.randomUUID();ids.push(id);
      product.settings.responseBindings=updateResponseBindingData(product.settings.responseBindings,{version:4,localOnly:true,nativeProjection:true,responseContainer:true,id,vaultId:product.settings.vaultId,initialOwner:product.deviceId,host:{environmentId:'inbox-fixture',workspaceRoot:'/synthetic',directory:'.t3-obsidian'},notePath:path,threadId:id,messageId:crypto.randomUUID(),projectId:'inbox-fixture',threadEnvironmentId:'inbox-fixture',initialHash:'0'.repeat(64),createdAt:new Date(Date.now()-index*60_000).toISOString()},product.deviceId);
      responses.push({id,notePath:path,epoch:1,revision:1,active:index===1,input:index===3,complete:index!==1&&index!==3});
    }
    const unbound=await this.app.vault.create(`${folder}/Ordinary note without streams.md`,'# This note must not appear in the inbox\n');created.push(unbound.path);
    product.deviceInline.explorerResponses=()=>[...original.explorer.call(product.deviceInline),...responses];
    // The installed product still owns grouping, rendering, actions and local
    // persistence. Block shared publication of all synthetic fixture records.
    const bindings=Object.values(product.settings.responseBindings).map((entry:any)=>entry.request);
    for(const [index,action] of [[0,{kind:'pin',value:true}],[4,{kind:'snoozed',until:Date.now()+3_600_000}],[5,{kind:'settled'}]] as const){
      const note=inboxNotes(bindings as any,[],new Map(),product.settings.noteInbox??{},product.settings.vaultId,()=>true).find(note=>note.path===created[index])!;
      product.settings.noteInbox=changeNoteInbox(product.settings.noteInbox??{},note,action,product.deviceId);
    }
    product.refreshFolderIndicators();
    this.cleanup=async()=>{
      product.save=original.save;product.deviceInline.explorerResponses=original.explorer;
      product.settings.responseBindings=original.bindings;
      for(const id of ids)delete product.settings.noteInbox[id];
      for(const [id,receipt] of product.completionGlow.receipts)if(receipt.notePath.startsWith(folder+'/'))product.completionGlow.receipts.delete(id);
      product.completionGlow.persist();
      await deviceState(`note-inbox:${product.deviceId}:${product.settings.vaultId}`,product.settings.noteInbox);
      product.inboxViewState=original.view;this.app.saveLocalStorage(`t3-note-inbox-view:${product.settings.vaultId}`,original.view);
      for(const path of created){const file=this.app.vault.getAbstractFileByPath(path);if(file instanceof TFile)await this.app.vault.delete(file);}
      const directory=this.app.vault.getAbstractFileByPath(folder);if(directory)await this.app.vault.delete(directory,true);
      // Native note opening creates identity receipts even without dispatch.
      // Remove only this lab's history from both replicas after saves finish.
      await product.saving;
      const disk=await product.loadData();
      for(const smart of [disk.smartSend,product.smartReplica,product.settings.smartSend])if(smart){
        const owned=new Set(Object.entries(smart.notes??{}).filter(([,note]:[string,any])=>note.path.startsWith(folder+'/')).map(([id])=>id));
        for(const id of owned)delete smart.notes[id];
        for(const key of ['responses','heads','noteEdits','recoveries'])for(const [id,entry] of Object.entries(smart[key]??{}) as [string,any][])if(owned.has(entry.noteId))delete smart[key][id];
      }
      await deviceState(`smart-send:${product.deviceId}:${product.settings.vaultId}`,product.smartReplica);
      await product.saveData(disk);product.lastDiskSnapshot=JSON.stringify(disk);product.sharedBaseline=JSON.stringify(product.sharedSnapshot());
      product.refreshFolderIndicators();this.write({phase:'clean',version:product.manifest.version,ownedNotesRemoved:created.every(path=>!this.app.vault.getAbstractFileByPath(path)),fixtureBindingsRemoved:ids.every(id=>!product.settings.responseBindings[id]),fixtureStateRemoved:ids.every(id=>!product.settings.noteInbox[id]),actions});new Notice('Inbox validation fixtures removed.');
    };
    const first=this.app.vault.getAbstractFileByPath(created[0]);if(first instanceof TFile)await this.app.workspace.getLeaf(false).openFile(first);
    this.write({phase:'ready',version:product.manifest.version,scope:'Installed product; synthetic stream projections; no provider/Sync claim',notes:created,streamIds:ids,expected:{pinned:1,working:1,regular:3,snoozed:1,settled:1,unboundExcluded:true}});
    new Notice('Inbox validation ready. Open the T3 mode in Files.');
  }
}
