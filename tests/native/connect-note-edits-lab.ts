import {Plugin,MarkdownView,FileSystemAdapter,apiVersion} from 'obsidian';
const fs=require('node:fs'),path=require('node:path');
/** A controller in a new unsynced test vault. The subject is the separately
 * loaded, unmodified product bundle; this controller never enters that bundle. */
export default class ConnectNoteEditsLab extends Plugin {
  private root='';private subject:any;private working=false;private timer?:number;
  private owned=new Set(['Completion.md','Stop.md','Conflict.md','Ordinary.md','Created by agent.md','Settled/Created by agent.md']);
  private held=new Set<string>();private config:any;
  async onload(){
    if(!(this.app.vault.adapter instanceof FileSystemAdapter))throw Error('A local isolated lab is required.');
    this.root=path.dirname(this.app.vault.adapter.getBasePath());
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Refuse a non-lab vault.');
    this.config=JSON.parse(fs.readFileSync(path.join(this.root,'CONFIG.json'),'utf8'));
    if(this.app.vault.adapter.getBasePath()!==path.join(this.root,'vault'))throw Error('The lab vault path changed.');
    this.app.workspace.onLayoutReady(()=>void this.start().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})));
    this.register(()=>{if(this.timer)window.clearInterval(this.timer);});
  }
  private write(name:string,value:unknown){fs.mkdirSync(path.dirname(path.join(this.root,name)),{recursive:true});fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2)+'\n');}
  private async start(){
    const tokenPath=path.join(this.root,'SESSION.json');
    if(fs.existsSync(tokenPath)){
      const session=JSON.parse(fs.readFileSync(tokenPath,'utf8'));
      this.app.saveLocalStorage('send-to-t3-code-device-v1',{deviceId:this.config.clientId,mode:'direct',pairedSessions:{'lab-connection':{token:session.token,expiresAt:typeof session.expiresAt==='number'?session.expiresAt:Date.parse(session.expiresAt),url:this.config.origin,environmentId:this.config.environmentId,permissions:['filesystem:read','filesystem:write','orchestration:read','orchestration:operate']}}});
      fs.unlinkSync(tokenPath);
    }
    await (this.app as any).plugins.enablePluginAndSave('t-three-code');this.subject=(this.app as any).plugins.plugins['t-three-code'];
    if(!this.subject)throw Error('The actual product plugin did not load.');
    if(!this.app.vault.getFolderByPath('Settled'))await this.app.vault.createFolder('Settled');
    for(const name of ['Completion.md','Stop.md','Conflict.md','Ordinary.md'])if(!this.app.vault.getFileByPath(name))await this.app.vault.create(name,`# ${name}\n\nAGENT FIELD: before\n\nUSER TAIL: before\n\nSynthetic bounded plugin test. Do not inspect files, use tools, or delegate. Reply exactly NATIVE_CHECKED_EDIT_OK.\n`);
    const io=this.subject.deviceInline.io,normalSync=io.syncReady;
    io.syncReady=(note:string)=>this.held.has(note)?false:normalSync?.(note)??true;
    await this.open('Completion.md');
    this.timer=window.setInterval(()=>{if(this.working)return;const file=path.join(this.root,'action.json');if(!fs.existsSync(file))return;this.working=true;void(async()=>{
      const input=JSON.parse(fs.readFileSync(file,'utf8'));fs.unlinkSync(file);if(!/^[a-f0-9-]{36}$/.test(input.id))throw Error('Invalid action ID.');
      try{const result=await this.action(input);this.write('actions/'+input.id+'.json',{ok:true,result});}catch(error){this.write('actions/'+input.id+'.json',{ok:false,error:String(error),stack:(error as Error).stack});}
    })().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.working=false);},100);
    this.write('READY.json',{vaultId:this.config.vaultId,clientId:this.config.clientId,apiVersion,productVersion:this.subject.manifest.version,instanceId:this.subject.clientMaintenance.client.instanceId,profileIsolated:true,connectedTransport:this.config.transportRoot,sourceBundleSha256:this.config.sourceBundleSha256});
  }
  private async open(note:string){
    if(!this.owned.has(note))throw Error('This note is not a fixture.');const file=this.app.vault.getFileByPath(note);if(!file)throw Error('Fixture unavailable.');const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:note,mode:'source',source:false},active:true});return leaf.view as MarkdownView;
  }
  private async state(){
    const notes:any[]=[];for(const note of this.owned){const file=this.app.vault.getFileByPath(note);if(!file)continue;const view=this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.file?.path===note);notes.push({path:note,disk:await this.app.vault.read(file),display:view?.editor?.getValue(),viewData:view?.getViewData(),rendered:view?.contentEl.innerText});}
    return {apiVersion,notes,responses:this.subject.deviceInline.explorerResponses(),bindings:Object.values(this.subject.settings.responseBindings??{}),held:[...this.held],client:this.subject.clientMaintenance.client};
  }
  private async action(input:any):Promise<unknown>{
    if(input.kind==='state')return this.state();
    if(input.kind==='open'){await this.open(input.note);return this.state();}
    if(input.kind==='hold-final'){if(!this.owned.has(input.note))throw Error('Unknown fixture.');if(input.hold)this.held.add(input.note);else this.held.delete(input.note);this.subject.deviceInline.resume();return {held:[...this.held],faultInjection:'Only the isolated fixture final-save Sync gate is held; network and rendering remain real.'};}
    if(input.kind==='edit'){
      const view=await this.open(input.note),text=view.editor.getValue(),at=text.indexOf(input.before);if(at<0||text.indexOf(input.before,at+1)>=0)throw Error('The fixture edit is not unique.');view.editor.replaceRange(input.after,view.editor.offsetToPos(at),view.editor.offsetToPos(at+input.before.length));await view.save();return this.state();
    }
    if(input.kind==='relocate-without-rename'){
      if(!this.owned.has(input.note)||!this.owned.has(input.destination)||input.note===input.destination)throw Error('Unknown fixture path.');
      const file=this.app.vault.getFileByPath(input.note);if(!file||this.app.vault.getAbstractFileByPath(input.destination))throw Error('Fixture move unavailable.');
      const before=await this.app.vault.read(file),previous=/<!-- t3-note-id:([a-f0-9]{64}) -->/.exec(before)?.[1];if(!previous)throw Error('A saved source identity is required.');
      await this.app.vault.delete(file);await this.app.vault.create(input.destination,before);await this.open(input.destination);
      await this.subject.ensureNoteIdentity(input.destination);
      const after=await this.app.vault.read(this.app.vault.getFileByPath(input.destination)!),next=/<!-- t3-note-id:([a-f0-9]{64}) -->/.exec(after)?.[1];
      if(!next||next===previous||before.replace(previous,next)!==after)throw Error('The relocated note did not retain its exact text with a fresh identity.');
      return {note:input.destination,freshIdentity:true,contentPreserved:true,sourceAbsent:!this.app.vault.getFileByPath(input.note),noRenameEvent:true};
    }
    if(input.kind==='stop'){
      const record=this.subject.deviceInline.localResponse(input.bindingId)?.record;if(!record||!this.owned.has(record.request.notePath))throw Error('Unknown fixture binding.');
      const runtime=this.subject.deviceInline.local.jobs.get(input.bindingId),body=runtime?.update?.body??'';
      return this.subject.deviceInline.stopResponse(record.request.host,input.bindingId,body);
    }
    if(input.kind==='cleanup'){
      await (this.app as any).plugins.disablePluginAndSave('t-three-code');this.held.clear();
      for(const note of this.owned){const file=this.app.vault.getFileByPath(note);if(file)await this.app.vault.delete(file);}
      const folder=this.app.vault.getFolderByPath('Settled');if(folder&&folder.children.length===0)await this.app.vault.delete(folder,true);
      const value={productDisabled:!(this.app as any).plugins.plugins['t-three-code'],ownedNotes:[...this.owned],remainingOwnedNotes:[...this.owned].filter(note=>this.app.vault.getAbstractFileByPath(note)),externalThreadCleanupRequired:true};this.write('CLEANUP.json',value);return value;
    }
    if(input.kind==='quit'){setTimeout(()=>require('@electron/remote').app.quit(),200);return {quitScheduled:true};}
    throw Error('Unknown fixture action.');
  }
}
