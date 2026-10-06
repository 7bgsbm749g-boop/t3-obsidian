import {App,EditorSuggest,type Editor,type EditorPosition,type EditorSuggestContext,ItemView,MarkdownView,Menu,Modal,Setting,Notice,TFile,TFolder,FuzzySuggestModal,WorkspaceLeaf,type Plugin} from 'obsidian';
import {CODEBASE_PREFIX,CodebaseDocument,contextualCandidates,linkedCodebases,relativeCodebasePath,scopeKey,virtualPath,type CodebaseScope,type CodebaseIO,type CodebaseEntry} from './codebase-core';
import {registerProjectReferences} from './project-reference';
import type {FolderLink} from './folder-link';
import {replyReferences,type ReplyReference} from './reply-assets';
import type {HostedInlineRequest} from './hosted-inline';
import type {ThreadAccess} from './thread-stream';
export interface CodebaseState {version:1;references:Record<string,SavedReference>;choices:Record<string,string>}
export interface CodebaseStorage {load():CodebaseState|undefined;save(state:CodebaseState):Promise<void>}
const VIEW='t3-codebase';
const MEDIA=/\.(?:png|jpe?g|gif|webp|svg|bmp|avif|pdf|mp[34]|wav|ogg|webm)$/i;
interface RegisteredFile {scope:CodebaseScope;path:string;file:TFile;document:CodebaseDocument;resource?:{url:string;expiresAt:number};text?:string}
export interface SavedReference {scope:CodebaseScope;path:string;note:string;name:string}
class FileChoice extends FuzzySuggestModal<RegisteredFile>{
  constructor(app:App,private items:RegisteredFile[],private finish:(file:RegisteredFile|undefined)=>void){super(app);this.setPlaceholder('Choose the project file');}
  getItems(){return this.items;}
  getItemText(item:RegisteredFile){return `${item.scope.title} / ${item.path}${item.scope.threadId?' (thread workspace)':''}`;}
  onChooseItem(item:RegisteredFile){this.finish(item);}
  onClose(){this.finish(undefined);}
}
export class CodebaseBridge {
  private files=new Map<string,RegisteredFile>();
  private folders=new Map<string,TFolder>();
  private undo:Array<()=>void>=[];
  private records:SavedReference[]=[];
  private choices:Record<string,string>={};
  private persistence:Promise<void>=Promise.resolve();
  private stopped=false;
  private views=new Set<CodebaseView>();
  private draftsKey:string;
  private metadataPath:string;
  private drafts:Record<string,string>;
  constructor(readonly app:App,private plugin:Plugin,readonly io:CodebaseIO,readonly links:()=>FolderLink[],vaultId:string,private storage?:CodebaseStorage){
    this.draftsKey=`t3-codebase-drafts:${vaultId}`;this.metadataPath=`${app.vault.configDir}/t3-code/codebase-v1.json`;
    this.drafts=app.loadLocalStorage(this.draftsKey)??{};
  }
  async install(){
    this.undo.push(registerProjectReferences(this.app,(reference,request,access)=>this.reply(reference,request,access)));
    try{const saved=this.storage?.load()??JSON.parse(await this.app.vault.adapter.read(this.metadataPath));this.adopt(saved);}catch{/* First use or unavailable metadata. */}
    const vault=this.app.vault,cache=this.app.metadataCache,workspace=this.app.workspace;
    for(const method of ['getFileByPath','getAbstractFileByPath'])this.patch(vault,method,(original:any)=>(path:string)=>this.files.get(path)?.file??this.folders.get(path)??original(path));
    for(const method of ['read','cachedRead'])this.patch(vault,method,(original:any)=>async(file:TFile)=>{
      const item=this.files.get(file.path);if(item){await this.prepare(item);item.text=await item.document.read();await this.prepareEmbeds(item.text,file.path);return item.text;}
      const text=await original(file);await this.prepareEmbeds(text,file.path);return text;
    });
    this.patch(vault,'modify',(original:any)=>async(file:TFile,text:string,options:any)=>{const item=this.files.get(file.path);if(!item)return original(file,text,options);await this.prepare(item);try{await item.document.save(text);}catch(error){new Notice(`${error instanceof Error?error.message:String(error)} Use Review unsaved project edit to compare versions.`,10000);throw error;}item.text=text;file.stat.mtime=Date.now();file.stat.size=new TextEncoder().encode(text).length;});
    this.patch(vault,'process',(original:any)=>async(file:TFile,change:(text:string)=>string,options:any)=>{const item=this.files.get(file.path);if(!item)return original(file,change,options);const text=change(await vault.read(file));await vault.modify(file,text);return text;});
    this.patch(vault,'append',(original:any)=>async(file:TFile,text:string,options:any)=>{const item=this.files.get(file.path);if(!item)return original(file,text,options);await vault.process(file,old=>old+text);});
    this.patch(vault,'readBinary',(original:any)=>async(file:TFile)=>{const item=this.files.get(file.path);if(!item)return original(file);await this.prepare(item);const response=await fetch(item.resource!.url,{credentials:'omit'});if(!response.ok)throw Error('The project file is unavailable.');return response.arrayBuffer();});
    this.patch(vault,'getResourcePath',(original:any)=>(file:TFile)=>{const item=this.files.get(file.path);return item?this.resource(item):original(file);});
    // Native viewers sometimes read the adapter directly. No list, getRoot,
    // getFiles, getAllLoadedFiles, fileMap, or global vault event is changed.
    for(const method of ['read','readBinary','write','writeBinary','append','exists','stat','getResourcePath','remove','rename','mkdir','trashLocal','trashSystem'])this.patch(vault.adapter,method,(original:any)=>(path:string,...args:any[])=>{
      if(!path.startsWith(CODEBASE_PREFIX))return original(path,...args);
      if(this.stopped)throw Error('The T3 project file bridge is stopped. Project bytes cannot be written to the vault.');
      const item=this.files.get(path);
      if(method==='exists')return Promise.resolve(!!item||this.folders.has(path));
      if(method==='stat')return Promise.resolve(item?{type:'file',...item.file.stat}:this.folders.has(path)?{type:'folder',ctime:0,mtime:0,size:0}:null);
      if(!item)throw Error('The project file is unavailable.');
      if(method==='read')return vault.read(item.file);
      if(method==='readBinary')return vault.readBinary(item.file);
      if(method==='write')return vault.modify(item.file,args[0]);
      if(method==='append')return vault.append(item.file,args[0]);
      if(method==='getResourcePath')return this.resource(item);
      throw Error('This operation is not supported for project files.');
    });
    for(const method of ['rename','delete','trash','modifyBinary'])this.patch(vault,method,(original:any)=>(file:TFile,...args:any[])=>{if(file.path.startsWith(CODEBASE_PREFIX))throw Error('This operation is not supported for project files.');return original(file,...args);});
    const physicalLink=cache.getFirstLinkpathDest.bind(cache);
    this.patch(cache,'getFirstLinkpathDest',(original:any)=>(name:string,source:string)=>original(name,source)??this.resolve(name,source)?.file??null);
    this.patch(cache,'fileToLinktext',(original:any)=>(file:TFile,...args:any[])=>this.files.has(file.path)?file.name:original(file,...args));
    this.patch(cache,'getFileCache',(original:any)=>(file:TFile)=>this.files.has(file.path)?this.fileCache(file.path):original(file));
    this.patch(cache,'getCache',(original:any)=>(path:string)=>this.files.has(path)?this.fileCache(path):original(path));
    this.patch(workspace,'openLinkText',(original:any)=>async(link:string,source:string,newLeaf:any,state:any)=>{
      if(physicalLink(link.split('#')[0],source))return original(link,source,newLeaf,state);
      const sourceItem=this.files.get(source);if(sourceItem&&link.split('#')[0].includes('/')&&!this.resolve(link,source)){const parts=sourceItem.path.split('/').slice(0,-1);for(const part of link.split('#')[0].split('/')){if(part==='.')continue;if(part==='..'){if(!parts.length)throw Error('The link leaves the project workspace.');parts.pop();}else parts.push(part);}this.register(sourceItem.scope,parts.join('/'));}
      let candidates=contextualCandidates([...this.files.values()],link,source,this.links());
      if(!candidates.length&&this.scopes().length){await this.search(link.split('#')[0],source);candidates=contextualCandidates([...this.files.values()],link,source,this.links());}
      const resolved=this.resolve(link,source);
      const item=resolved??(candidates.length===1?candidates[0]:candidates.length?await this.choose(candidates,link,source):undefined);
      if(item){this.choices[JSON.stringify([source,link.split('#')[0]])]=item.file.path;await this.persist();await this.prepare(item);if(MEDIA.test(item.path))return original(link,source,newLeaf,state);const leaf=workspace.getLeaf(newLeaf);return this.open(item,leaf,state,link.includes('#')?'#'+link.split('#').slice(1).join('#'):undefined);}
      if(candidates.length||link.startsWith(CODEBASE_PREFIX))return;
      return original(link,source,newLeaf,state);
    });
    this.plugin.registerEvent(workspace.on('editor-change',(editor,view)=>{const file=view.file,item=file?this.files.get(file.path):undefined;if(!item||item.document.base===undefined)return;const text=editor.getValue();if(text!==item.document.base){item.document.draft=text;this.retain(item.file.path,text);}}));
    this.plugin.registerEditorSuggest(new CodebaseLinkSuggest(this.app,this));
    this.plugin.registerView(VIEW,leaf=>new CodebaseView(leaf,this));
    this.plugin.addCommand({id:'codebase-view',name:'Open Codebase view',callback:()=>void this.show()});
    this.plugin.addCommand({id:'review-codebase-edit',name:'Review unsaved project edit',checkCallback:checking=>{const file=workspace.getActiveViewOfType(MarkdownView)?.file,item=file?this.files.get(file.path):undefined;if(!item||this.drafts[item.file.path]===undefined)return false;if(!checking)void this.review(item).catch(error=>new Notice(error.message,10000));return true;}});
    this.plugin.addCommand({id:'refresh-codebase',name:'Refresh Codebase view',callback:()=>void this.refresh()});
    this.plugin.registerInterval(window.setInterval(()=>{void this.refresh().catch(()=>{});},15000));
    workspace.onLayoutReady(()=>void this.show(false));
  }
  adopt(saved:CodebaseState|undefined){if(saved?.version!==1)return;this.choices={...this.choices,...saved.choices};for(const record of Object.values(saved.references??{}))try{if(this.allowed(record.scope))this.register(record.scope,record.path);}catch{/* Invalid or stale identities are not opened. */}}
  private patch(target:any,key:string,wrap:(original:any)=>any){if(typeof target[key]!=='function')return;const original=target[key],replacement=wrap(original.bind(target));target[key]=replacement;this.undo.push(()=>{if(target===this.app.vault.adapter)return;/* Keep a fail-closed prefix guard while old native leaves unload. */if(target[key]===replacement)target[key]=original;});}
  private allowed(scope:CodebaseScope){return this.scopes().some(s=>s.environmentId===scope.environmentId&&s.projectId===scope.projectId);}
  scopes(){return linkedCodebases(this.links());}
  private retain(path:string,draft:string|undefined){if(draft===undefined)delete this.drafts[path];else this.drafts[path]=draft;this.app.saveLocalStorage(this.draftsKey,this.drafts);}
  register(scope:CodebaseScope,path:string):RegisteredFile {
    relativeCodebasePath(path);const key=virtualPath(scope,path),existing=this.files.get(key);if(existing)return existing;
    const file:TFile=new (TFile as any)(this.app.vault,key);file.vault=this.app.vault;file.path=key;file.name=path.split('/').at(-1)!;const dot=file.name.lastIndexOf('.');file.basename=dot<0?file.name:file.name.slice(0,dot);file.extension=dot<0?'':file.name.slice(dot+1);file.stat={ctime:0,mtime:0,size:0};
    const parent=key.slice(0,key.lastIndexOf('/'));let folder=this.folders.get(parent);if(!folder){folder=new (TFolder as any)(this.app.vault,parent) as TFolder;folder.vault=this.app.vault;folder.path=parent;folder.name=path.split('/').slice(0,-1).at(-1)??scope.title;folder.parent=null;folder.children=[];this.folders.set(parent,folder);}file.parent=folder;folder.children.push(file);
    const document=new CodebaseDocument(scope,path,this.io,draft=>this.retain(key,draft));if(this.drafts[key]!==undefined)document.uncertain=true;const item={scope,path,file,document};this.files.set(key,item);if(!this.records.some(r=>virtualPath(r.scope,r.path)===key))this.records.push({scope,path,note:'',name:file.name});return item;
  }
  remember(file:TFile,source:string){if(this.files.has(file.path)){this.choices[JSON.stringify([source,file.name])]=file.path;void this.persist();}}
  label(file:TFile){const item=this.files.get(file.path);return item?`${item.scope.title} / ${item.path}`:file.path;}
  candidates(name:string,source:string){return contextualCandidates([...this.files.values()],name,source,this.links());}
  async suggestions(query:string,source:string){if(query.length>2)try{await this.search(query,source);}catch{}const linked=this.links().filter(l=>source.startsWith(l.folderPath+'/')).sort((a,b)=>b.folderPath.length-a.folderPath.length)[0];return [...this.files.values()].filter(f=>(!linked||f.scope.projectId===linked.projectId&&f.scope.environmentId===linked.environmentId)&&f.file.name.toLowerCase().includes(query.toLowerCase())).slice(0,100);}
  private resolve(name:string,source:string){const sourceItem=this.files.get(source);if(sourceItem){const clean=name.split('#')[0];if(!clean)return sourceItem;if(clean.includes('/')){const parts=sourceItem.path.split('/').slice(0,-1);for(const part of clean.split('/')){if(part==='.')continue;if(part==='..'){if(!parts.length)return undefined;parts.pop();}else parts.push(part);}const relative=this.files.get(virtualPath(sourceItem.scope,parts.join('/')));if(relative)return relative;}}const own=this.files.get(name.split('#')[0]);if(own)return own;const remembered=this.choices[JSON.stringify([source,name.split('#')[0]])];if(remembered&&this.files.has(remembered))return this.files.get(remembered);const sourceFile=this.files.get(source);const candidates=contextualCandidates([...this.files.values()],name,source,this.links());if(sourceFile){const same=candidates.filter(f=>scopeKey(f.scope)===scopeKey(sourceFile.scope));if(same.length===1)return same[0];}return candidates.length===1?candidates[0]:undefined;}
  private choose(items:RegisteredFile[],name:string,source:string){return new Promise<RegisteredFile|undefined>(resolve=>{new FileChoice(this.app,items,item=>{if(item){this.choices[JSON.stringify([source,name.split('#')[0]])]=item.file.path;void this.persist();}resolve(item);}).open();});}
  private persist(){this.persistence=this.persistence.catch(()=>{}).then(async()=>{const state:CodebaseState={version:1,references:Object.fromEntries(this.records.map(record=>[virtualPath(record.scope,record.path),record])),choices:this.choices};if(this.storage){if(JSON.stringify(state)!==JSON.stringify(this.storage.load()))await this.storage.save(state);return;}const adapter=this.app.vault.adapter,dir=this.metadataPath.slice(0,this.metadataPath.lastIndexOf('/'));if(!await adapter.exists(dir))await adapter.mkdir(dir);await adapter.write(this.metadataPath,JSON.stringify(state));});return this.persistence;}

  async search(name:string,source:string){
    const link=this.links().filter(l=>source.startsWith(l.folderPath+'/')).sort((a,b)=>b.folderPath.length-a.folderPath.length)[0];
    const scopes=this.scopes(),ordered=link?[...scopes.filter(s=>s.projectId===link.projectId&&s.environmentId===link.environmentId),...scopes.filter(s=>s.projectId!==link.projectId||s.environmentId!==link.environmentId)]:scopes;
    let failure:unknown;
    for(const scope of ordered){
      try{const workspaces=[scope,...this.records.filter(r=>r.scope.threadId&&r.scope.projectId===scope.projectId&&r.scope.environmentId===scope.environmentId).map(r=>r.scope)];for(const workspace of new Map(workspaces.map(s=>[scopeKey(s),s])).values()){const entries=await this.io.search(workspace,name);for(const entry of entries)if(entry.kind==='file')this.register(workspace,entry.path);}if(link&&scope.projectId===link.projectId&&this.candidates(name,source).length)break;}
      catch(error){failure=error;}
    }
    await this.persist();if(failure&&!this.candidates(name,source).length)throw failure;
  }

  async list(scope:CodebaseScope,directory:string){const result=await this.io.list(scope,directory);for(const entry of result.entries)if(entry.kind==='file')this.register(scope,entry.path);if(result.truncated)throw Error('T3 returned an incomplete folder.');await this.persist();return result.entries;}
  private resource(item:RegisteredFile){if(!item.resource||item.resource.expiresAt<Date.now()+5000){void this.prepare(item).catch(()=>{});return '';}return item.resource.url;}
  async prepare(item:RegisteredFile){if(!this.allowed(item.scope))throw Error('This project is no longer linked to the vault.');if(MEDIA.test(item.path)&&(!item.resource||item.resource.expiresAt<Date.now()+60000))item.resource=await this.io.resource(item.scope,item.path);}
  private async prepareEmbeds(text:string,source:string){
    const refs=replyReferences(text).filter(r=>r.image&&MEDIA.test(r.source.split('#')[0]));
    for(const ref of refs){
      try{let item=this.resolve(ref.source,source);if(!item&&!this.app.metadataCache.getFirstLinkpathDest(ref.source,source)){
        const sourceItem=this.files.get(source);
        if(sourceItem){const parts=sourceItem.path.split('/').slice(0,-1);for(const part of ref.source.split('#')[0].split('/')){if(part==='.')continue;if(part==='..'){if(!parts.length)throw Error('The image leaves the project.');parts.pop();}else parts.push(part);}item=this.register(sourceItem.scope,parts.join('/'));}
        else if(!/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(ref.source)){await this.search(ref.source,source);item=this.resolve(ref.source,source);}
      }if(item)await this.prepare(item);}catch{/* Offline previews must not block note reading. */}
    }
  }

  private fileCache(path:string){const text=this.files.get(path)?.text??'',headings:any[]=[];let offset=0;for(const [line,content] of text.split('\n').entries()){const match=/^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(content);if(match)headings.push({heading:match[2],level:match[1].length,position:{start:{line,col:0,offset},end:{line,col:content.length,offset:offset+content.length}}});offset+=content.length+1;}return {headings};}
  async open(item:RegisteredFile,leaf=this.app.workspace.getLeaf(false),state?:any,subpath?:string){
    await this.prepare(item);
    if(MEDIA.test(item.path))return leaf.openFile(item.file,state);
    const text=await this.app.vault.read(item.file);item.text=text;
    await leaf.setViewState({type:'markdown',state:{file:item.file.path,mode:'source',source:item.file.extension!=='md'},active:true});
    if(!(leaf.view instanceof MarkdownView))throw Error('Obsidian could not open its native editor.');
    const draft=this.drafts[item.file.path];if(draft!==undefined&&draft!==text){new Notice('A saved local edit is available. It has not been sent to T3.');leaf.view.editor.setValue(draft);}
    if(subpath)await leaf.view.setState({...leaf.view.getState(),subpath},{history:true});
  }
  async reply(reference:ReplyReference,request:HostedInlineRequest,access:ThreadAccess){
    let source=reference.source.replace(/^sandbox:/,'');if(/^file:\/\//.test(source))source=decodeURIComponent(new URL(source).pathname);
    if(/^[a-z][a-z0-9+.-]*:/i.test(source)&&!/^\w:\//.test(source)||source.startsWith('//'))return undefined;
    source=decodeURIComponent(source.split('#')[0].split('?')[0]).replace(/:\d+(?::\d+)?$/,'').replace(/\\/g,'/');
    const existing=this.app.metadataCache.getFirstLinkpathDest(source,request.notePath);if(existing&&!existing.path.startsWith(CODEBASE_PREFIX))return undefined;
    const shell=await access.api('/api/orchestration/shell'),project=shell.projects?.find((p:any)=>p.id===request.projectId),thread=shell.threads?.find((t:any)=>t.id===request.threadId);
    if(!project)return undefined;
    const scope:CodebaseScope={environmentId:request.threadEnvironmentId,projectId:project.id,title:project.title,root:thread?.worktreePath??project.workspaceRoot,...(thread?.worktreePath?{threadId:request.threadId}:{})};
    if(!this.allowed(scope))return undefined;
    const root=scope.root.replace(/\\/g,'/').replace(/\/$/,'');if(source.startsWith(root+'/'))source=source.slice(root.length+1);
    try{relativeCodebasePath(source);}catch{return undefined;}
    const item=this.register(scope,source);this.choices[JSON.stringify([request.notePath,item.file.name])]=item.file.path;
    if(!this.records.some(r=>r.note===request.notePath&&virtualPath(r.scope,r.path)===item.file.path))this.records.push({scope,path:source,note:request.notePath,name:item.file.name});
    await this.prepare(item);await this.persist();void this.refresh().catch(()=>{});const heading=reference.source.includes('#')?'#'+reference.source.split('#').slice(1).join('#'):'';const alias=reference.label&&reference.label!==item.file.name?'|'+reference.label.replace(/[\]\n|]/g,''):'';return `${reference.image?'!':''}[[${item.file.name}${heading}${alias}]]`;
  }
  private async review(item:RegisteredFile){const remote=await this.io.read(item.scope,item.path),draft=this.drafts[item.file.path];if(draft===undefined)return;const modal=new Modal(this.app);modal.titleEl.setText('Review unsaved project edit');modal.contentEl.createEl('h3',{text:'Current project file'});modal.contentEl.createEl('pre',{text:remote});modal.contentEl.createEl('h3',{text:'Your local edit'});modal.contentEl.createEl('pre',{text:draft});new Setting(modal.contentEl).addButton(b=>b.setButtonText('Keep project version').onClick(()=>{item.document=new CodebaseDocument(item.scope,item.path,this.io,text=>this.retain(item.file.path,text));this.retain(item.file.path,undefined);modal.close();void this.open(item);})).addButton(b=>b.setButtonText('Save local edit').onClick(async()=>{b.setDisabled(true);try{if(await this.io.read(item.scope,item.path)!==remote)throw Error('The project changed again. Close this window and compare again.');item.document=new CodebaseDocument(item.scope,item.path,this.io,text=>this.retain(item.file.path,text));await item.document.read();await item.document.save(draft);modal.close();}catch(error){new Notice(String(error),10000);b.setDisabled(false);}}));modal.open();}
  menu(item:RegisteredFile,event:MouseEvent){const menu=new Menu();menu.addItem(entry=>entry.setTitle('Open in new tab').setIcon('file').onClick(()=>{void this.open(item,this.app.workspace.getLeaf('tab')).catch(error=>new Notice(error.message));}));menu.addItem(entry=>entry.setTitle('Copy link').setIcon('link').onClick(()=>{void navigator.clipboard.writeText(`[[${item.file.name}]]`);}));menu.addItem(entry=>entry.setTitle('Insert link').setIcon('link').onClick(()=>{const view=this.app.workspace.getActiveViewOfType(MarkdownView);if(view?.file){this.choices[JSON.stringify([view.file.path,item.file.name])]=item.file.path;view.editor.replaceSelection(`[[${item.file.name}]]`);void this.persist();}}));menu.showAtMouseEvent(event);}
  async show(active=true){let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getLeftLeaf(false)!;await leaf.setViewState({type:VIEW,active});}if(active)await this.app.workspace.revealLeaf(leaf);}
  attach(view:CodebaseView){this.views.add(view);}detach(view:CodebaseView){this.views.delete(view);}
  async refresh(){if(this.stopped)return;for(const view of this.views)await view.refresh();for(const leaf of this.app.workspace.getLeavesOfType('markdown')){const view=leaf.view as MarkdownView,item=view.file?this.files.get(view.file.path):undefined;if(!item||item.document.base===undefined||this.drafts[item.file.path]!==undefined||view.editor.getValue()!==item.document.base)continue;try{const text=await this.io.read(item.scope,item.path);if(text!==item.document.base&&this.drafts[item.file.path]===undefined&&view.editor.getValue()===item.document.base){item.document.base=text;item.text=text;view.setViewData(text,false);}}catch{/* Keep the editor and its data when the machine is offline. */}}}
  dispose(){this.stopped=true;this.app.workspace.iterateAllLeaves?.(leaf=>{const view=leaf.view as MarkdownView,item=view.file?this.files.get(view.file.path):undefined;if(item){const text=view.editor?.getValue();if(text!==undefined&&text!==item.document.base)this.retain(item.file.path,text);leaf.detach();}});for(const undo of this.undo.reverse())undo();}
}
export class CodebaseView extends ItemView {
  private expanded=new Set<string>();private refreshing=false;
  constructor(leaf:WorkspaceLeaf,private bridge:CodebaseBridge){super(leaf);}
  getViewType(){return VIEW;}getDisplayText(){return 'Codebase view';}getIcon(){return 'code-xml';}
  async onOpen(){this.bridge.attach(this);await this.refresh();}async onClose(){this.bridge.detach(this);}
  async refresh(){if(this.refreshing)return;this.refreshing=true;try{this.contentEl.empty();const heading=this.contentEl.createDiv({cls:'t3-codebase-heading'});heading.createSpan({text:'Codebase view'});const refresh=heading.createEl('button',{text:'Refresh'});refresh.onclick=()=>void this.refresh();const scopes=this.bridge.scopes();if(!scopes.length)this.contentEl.createEl('p',{text:'Link a vault folder to a T3 project to see its files here.'});for(const scope of scopes)await this.folder(scope,'',this.contentEl);}finally{this.refreshing=false;}}
  private async folder(scope:CodebaseScope,path:string,parent:HTMLElement){const key=scopeKey(scope)+'/'+path;const row=parent.createEl('button',{cls:'t3-codebase-folder',text:`${this.expanded.has(key)?'▾':'▸'} ${path?path.split('/').at(-1):scope.title}`});row.onclick=()=>{if(this.expanded.has(key))this.expanded.delete(key);else this.expanded.add(key);void this.refresh();};if(!this.expanded.has(key))return;const children=parent.createDiv({cls:'t3-codebase-children'});try{if(!path&&!scope.threadId&&this.bridge.io.workspaces){for(const worktree of await this.bridge.io.workspaces(scope))await this.folder(worktree,'',children);}
const entries=await this.bridge.list(scope,path);for(const entry of entries.sort((a,b)=>a.kind.localeCompare(b.kind)||a.path.localeCompare(b.path))){if(entry.kind==='directory')await this.folder(scope,entry.path,children);else{const item=this.bridge.register(scope,entry.path),file=children.createEl('button',{cls:'t3-codebase-file',text:item.file.name});file.onclick=()=>void this.bridge.open(item).catch(error=>new Notice(error.message,10000));file.oncontextmenu=event=>{event.preventDefault();this.bridge.menu(item,event);};}}}catch(error){children.createEl('p',{text:error instanceof Error?error.message:String(error),cls:'t3-codebase-error'});}}
}

class CodebaseLinkSuggest extends EditorSuggest<TFile> {
  constructor(app:App,private bridge:CodebaseBridge){super(app);}
  onTrigger(cursor:EditorPosition,editor:Editor,file:TFile|null){if(!file||!this.bridge.scopes().length)return null;const line=editor.getLine(cursor.line).slice(0,cursor.ch),match=/\[\[([^\]\n#|]*)$/.exec(line);if(!match)return null;return {start:{line:cursor.line,ch:cursor.ch-match[1].length},end:cursor,query:match[1]};}
  async getSuggestions(context:EditorSuggestContext){const project=await this.bridge.suggestions(context.query,context.file.path),physical=this.app.vault.getFiles().filter(f=>f.name.toLowerCase().includes(context.query.toLowerCase())).slice(0,100);return [...physical,...project.map(p=>p.file)];}
  renderSuggestion(file:TFile,el:HTMLElement){el.createDiv({text:file.name});if(file.path.startsWith(CODEBASE_PREFIX))el.createDiv({text:this.bridge.label(file),cls:'suggestion-note'});}
  selectSuggestion(file:TFile){const context=this.context;if(!context)return;this.bridge.remember(file,context.file.path);const text=file.path.startsWith(CODEBASE_PREFIX)?file.name:this.app.metadataCache.fileToLinktext(file,context.file.path);const line=context.editor.getLine(context.end.line),end=line.slice(context.end.ch).startsWith(']]')?{line:context.end.line,ch:context.end.ch+2}:context.end;context.editor.replaceRange(text+']]',context.start,end);this.close();}
}
