import {App,EditorSuggest,type Editor,type EditorPosition,type EditorSuggestContext,ItemView,MarkdownView,Menu,Modal,Setting,Notice,TFile,TFolder,FuzzySuggestModal,WorkspaceLeaf,type Plugin,editorInfoField} from 'obsidian';
import {CODEBASE_PREFIX,CodebaseDocument,codebaseRootLabels,contextualCandidates,linkedCodebases,relativeCodebasePath,scopeKey,virtualPath,catalogCodebases,type CodebaseScope,type CodebaseIO,type CodebaseEntry} from './codebase-core';
import {projectLink,projectMarkdownLink,projectPathRoutes} from './codebase-links';
import {registerProjectReferences} from './project-reference';
import type {FolderLink} from './folder-link';
import type {ReplyReference} from './reply-assets';
import type {ResponseRequest} from './response-model';
import type {ThreadAccess} from './thread-stream';
import {CodebaseBrowseCache,type BrowseState} from './codebase-cache';
import {CODEBASE_VIEW as VIEW,CodebaseView} from './codebase-view';
import {timingSummaries} from './codebase-performance';
import {NativeLanguageViews} from './language-views';
import {contentHash} from './completion';
import {nativeMediaSource,originalMediaSource,codebaseMediaExtension} from './codebase-media';
export {CodebaseView} from './codebase-view';
export interface CodebaseState {version:1;references:Record<string,SavedReference>;choices:Record<string,string>;automaticChoices?:Record<string,string[]>;vaultAliases?:Record<string,string>}
export interface CodebaseStorage {environments?():string[];load():CodebaseState|undefined;save(state:CodebaseState):Promise<void>;projectChanged?(scope:CodebaseScope,change:{title?:string;deleted?:boolean}):Promise<void>}
const MEDIA=/\.(?:png|jpe?g|gif|webp|svg|bmp|avif|pdf|mp[34]|wav|m4a|3gp|flac|ogg|oga|opus|webm|ogv|mov|mkv)$/i;
export interface RegisteredFile {scope:CodebaseScope;path:string;file:TFile;document:CodebaseDocument;resource?:{url:string;expiresAt:number};preparing?:Promise<void>;text?:string}
export interface SavedReference {scope:CodebaseScope;path:string;note:string;name:string}
class FileChoice extends FuzzySuggestModal<RegisteredFile>{
  private settled=false;
  constructor(app:App,private items:RegisteredFile[],private finish:(file:RegisteredFile|undefined)=>void,private title:(scope:CodebaseScope)=>string=scope=>scope.title){super(app);this.setPlaceholder('Choose the project file');}
  getItems(){return this.items;}
  getItemText(item:RegisteredFile){return `${this.title(item.scope)} / ${item.path}${item.scope.threadId?' (thread workspace)':''}`;}
  onChooseItem(item:RegisteredFile){if(!this.settled){this.settled=true;this.finish(item);}}
  onClose(){super.onClose?.();setTimeout(()=>{if(!this.settled){this.settled=true;this.finish(undefined);}},0);}
}
export class CodebaseBridge {
  private files=new Map<string,RegisteredFile>();
  private folders=new Map<string,TFolder>();
  private undo:Array<()=>void>=[];
  private records=new Map<string,SavedReference>();
  private choices:Record<string,string>={};
  private automaticChoices=new Map<string,Set<string>>();
  private persistence:Promise<void>=Promise.resolve();
  private stopped=false;
  private views=new Set<CodebaseView>();
  private draftsKey:string;
  private metadataPath:string;
  private drafts:Record<string,string>;
  readonly browse:CodebaseBrowseCache;
  readonly languageViews:NativeLanguageViews;
  private localKey:string;
  private browseTimer?:ReturnType<typeof setTimeout>;
  private persistTimer?:ReturnType<typeof setTimeout>;
  private rendering=false;
  private refreshing?:Promise<void>;
  private searches=new Map<string,Promise<void>>();
  private searchAt=new Map<string,number>();
  private viewBases=new WeakMap<MarkdownView,{path:string;text:string}>();
  private draftAliases:Record<string,string>;
  private chrome=new Map<any,MutationObserver>();
  private legacyPaths:Record<string,string>;
  private vaultAliases:Record<string,string>={};
  private physicalFileLookup?:(path:string)=>TFile|null;
  private recoveryNotices=new Set<string>();
  private projectReconciliation?:Promise<void>;
  private sourceOrigins=new Map<string,Map<string,{environmentId:string;projectId:string}>>();
  private knownScopes=new Map<string,CodebaseScope>();
  private workspaceScopes=new Map<string,{at:number;value:CodebaseScope[];error?:boolean;pending?:Promise<void>}>();
  constructor(readonly app:App,private plugin:Plugin,readonly io:CodebaseIO,readonly links:()=>FolderLink[],vaultId:string,private storage?:CodebaseStorage){
    this.languageViews=new NativeLanguageViews(app,plugin);
    this.draftsKey=`t3-codebase-drafts:${vaultId}`;this.metadataPath=`${app.vault.configDir}/t3-code/codebase-v1.json`;
    this.drafts=app.loadLocalStorage(this.draftsKey)??{};
    this.localKey=`t3-codebase-browser:${vaultId}:`;
    this.draftAliases=app.loadLocalStorage(this.localKey+'draft-aliases')??{};
    this.legacyPaths=app.loadLocalStorage(this.localKey+'legacy-paths')??{};
    this.browse=new CodebaseBrowseCache(io,key=>this.renderViews(key),state=>{if(this.stopped){this.local('cache',state);return;}clearTimeout(this.browseTimer);this.browseTimer=setTimeout(()=>this.local('cache',state),250);});
    this.browse.adopt(this.local('cache') as BrowseState|undefined);
  }
  local(name:string,value?:unknown):any{if(value===undefined)return this.app.loadLocalStorage(this.localKey+name);this.app.saveLocalStorage(this.localKey+name,value);}
  private renderViews(key?:string){if(this.stopped)return;for(const view of this.views)view.invalidate(key);if(this.rendering)return;this.rendering=true;setTimeout(()=>{this.rendering=false;if(!this.stopped)for(const view of this.views)view.render();},16);}
  async install(){
    this.languageViews.install();
    this.undo.push(registerProjectReferences(this.app,(reference,request,access)=>this.reply(reference,request,access)));
    try{const saved=this.storage?.load()??JSON.parse(await this.app.vault.adapter.read(this.metadataPath));this.adopt(saved);}catch{/* First use or unavailable metadata. */}
    const vault=this.app.vault,cache=this.app.metadataCache,workspace=this.app.workspace;
    this.physicalFileLookup=vault.getFileByPath?.bind(vault);
    await this.reconcileProjectChanges().catch(error=>new Notice(`T3 project changed; folder link update pending: ${error.message}`,10000));
    this.nativeSwitcher();
    this.nativeFileOpen();
    this.nativePathLinks();
    if(this.plugin.registerEditorExtension)this.plugin.registerEditorExtension(codebaseMediaExtension(editorInfoField,(root,source,original,current)=>this.renderMedia(root,source,original,current)));
    for(const method of ['getFileByPath','getAbstractFileByPath'])this.patch(vault,method,(original:any)=>(path:string)=>this.files.get(path)?.file??this.files.get(this.legacyPaths[path])?.file??this.folders.get(path)??original(path)??this.vaultAlias(path)?.file??null);
    for(const method of ['read','cachedRead'])this.patch(vault,method,(original:any)=>async(file:TFile)=>{
      const item=this.files.get(file.path);if(item){this.captureBases(item);await this.prepare(item);const before=item.document.base;item.text=await item.document.read();this.synchronizePeers(item,before,item.text);return item.text;}
      return original(file);
    });
    this.patch(vault,'modify',(original:any)=>async(file:TFile,text:string,options:any)=>{const item=this.files.get(file.path);if(!item)return original(file,text,options);if(text===item.document.base)return;await this.prepare(item);const before=item.document.base,peers=this.editorLeaves().map(leaf=>leaf.view as MarkdownView).filter(view=>view.file?.path===file.path),matching=peers.filter(view=>this.viewText(view)===text),origins=peers.map(view=>({view,basis:this.viewBase(view,item)})).filter(({view,basis})=>{const native=view as MarkdownView&{lastSavedData?:string;saving?:unknown};return basis?.text===before&&!!native.saving&&native.data===text&&native.lastSavedData===text;});if(text===before)return;try{if(matching.some(view=>{const basis=this.viewBase(view,item);return basis&&basis.text!==before;})){item.document.uncertain=true;item.document.draft=text;this.retain(file.path,text);}await item.document.save(text);for(const {view,basis} of origins)if(view.file?.path===file.path&&this.viewBase(view,item)===basis)this.setViewBase(view,item,text);}catch(error){new Notice(`${error instanceof Error?error.message:String(error)} Use Review unsaved project edit to compare versions.`,10000);throw error;}item.text=text;this.synchronizePeers(item,before,text);file.stat.mtime=Date.now();file.stat.size=new TextEncoder().encode(text).length;});
    this.patch(vault,'process',(original:any)=>async(file:TFile,change:(text:string)=>string,options:any)=>{const item=this.files.get(file.path);if(!item)return original(file,change,options);const text=change(await vault.read(file));await vault.modify(file,text);return text;});
    this.patch(vault,'append',(original:any)=>async(file:TFile,text:string,options:any)=>{const item=this.files.get(file.path);if(!item)return original(file,text,options);await vault.process(file,old=>old+text);});
    this.patch(vault,'readBinary',(original:any)=>async(file:TFile)=>{const item=this.files.get(file.path);if(!item)return original(file);await this.prepare(item,true);const response=await fetch(item.resource!.url,{credentials:'omit'});if(!response.ok)throw Error('The project file is unavailable.');return response.arrayBuffer();});
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
    this.patch(cache,'getFirstLinkpathDest',(original:any)=>(name:string,source:string)=>{if(this.vaultWikiLink(name,source))return original(name,source);const route=this.pathRoute(name,source);return route.owned?route.items.length===1?route.items[0].file:null:original(name,source)??this.resolve(name,source)?.file??null;});
    this.patch(cache,'fileToLinktext',(original:any)=>(file:TFile,...args:any[])=>this.files.has(file.path)?file.name:original(file,...args));
    this.patch(cache,'getFileCache',(original:any)=>(file:TFile)=>this.files.has(file.path)?this.fileCache(file.path):original(file));
    this.patch(cache,'getCache',(original:any)=>(path:string)=>this.files.has(path)?this.fileCache(path):original(path));
    this.patch(workspace,'openLinkText',(original:any)=>async(link:string,source:string,newLeaf:any,state:any)=>{
      if(this.vaultWikiLink(link,source))return original(link,source,newLeaf,state);
      let route=this.pathRoute(link,source);
      if(!route.owned&&this.absoluteReference(link)){const discovered=await this.discoverWorkspaces();route=this.pathRoute(link,source);if(!route.owned&&!discovered){new Notice('Project locations are unavailable. No vault note was created.');return;}}
      if(route.owned){const item=route.items.length===1?route.items[0]:route.items.length?await this.choose(route.items,link,source):undefined;if(!item){new Notice('The project file is unavailable or its location is ambiguous.');return;}try{this.choices[JSON.stringify([source,link.split('#')[0]])]=item.file.path;this.pin(item,source);const parsed=projectLink(link)!;return await this.open(item,workspace.getLeaf(newLeaf),{...state,eState:{...state?.eState,...(parsed.line===undefined?{}:{line:parsed.line,startLoc:{line:parsed.line,col:parsed.column??0},endLoc:{line:parsed.line,col:parsed.column??0},cursor:{from:{line:parsed.line,ch:parsed.column??0},to:{line:parsed.line,ch:parsed.column??0}}})}},parsed.subpath);}catch(error){new Notice(`The project file is unavailable: ${error instanceof Error?error.message:String(error)}`,10000);return;}}
      if(physicalLink(link.split('#')[0],source))return original(link,source,newLeaf,state);
      if(this.absoluteReference(link)&&(this.environmentIds().length||this.sourceOrigins.has(source))){new Notice('This path is not available in a linked project workspace.');return;}
      const sourceItem=this.files.get(source);if(sourceItem&&link.split('#')[0].includes('/')&&!this.resolve(link,source)){const parts=sourceItem.path.split('/').slice(0,-1);for(const part of link.split('#')[0].split('/')){if(part==='.')continue;if(part==='..'){if(!parts.length)throw Error('The link leaves the project workspace.');parts.pop();}else parts.push(part);}this.register(sourceItem.scope,parts.join('/'));}
      let candidates=this.candidates(link,source);
      // Unclaimed vault links belong to Obsidian, including newly typed wiki
      // links that have not reached the metadata cache yet. No network lookup
      // may delay or prevent native missing-note creation.
      if(!candidates.length&&!this.resolve(link,source)&&!sourceItem){if(link.startsWith(CODEBASE_PREFIX))return;return original(link,source,newLeaf,state);}
      if(!candidates.length&&!this.resolve(link,source)&&this.scopes().length){await this.search(link.split('#')[0],source);candidates=this.candidates(link,source);}
      const resolved=this.resolve(link,source);
      const item=resolved??(candidates.length===1?candidates[0]:candidates.length?await this.choose(candidates,link,source):undefined);
      if(item){this.choices[JSON.stringify([source,link.split('#')[0]])]=item.file.path;this.pin(item,source);await this.prepare(item);if(MEDIA.test(item.path))return original(link,source,newLeaf,state);const leaf=workspace.getLeaf(newLeaf);const parsed=projectLink(link);return this.open(item,leaf,parsed?.line===undefined?state:{...state,eState:{...state?.eState,line:parsed.line,startLoc:{line:parsed.line,col:parsed.column??0},endLoc:{line:parsed.line,col:parsed.column??0},cursor:{from:{line:parsed.line,ch:parsed.column??0},to:{line:parsed.line,ch:parsed.column??0}}}},parsed?.subpath);}
      if(candidates.length||link.startsWith(CODEBASE_PREFIX))return;
      return original(link,source,newLeaf,state);
    });
    this.plugin.registerEvent(workspace.on('editor-change',(editor,view)=>{const file=view.file,item=file?this.files.get(file.path):undefined;if(!item||item.document.base===undefined||(view as MarkdownView).getMode?.()==='preview')return;const text=editor.getValue(),basis=this.viewBase(view as MarkdownView,item);if(!basis)return;if(text!==item.document.base){if(basis.text!==item.document.base)item.document.uncertain=true;item.document.draft=text;this.retain(item.file.path,text);}}));
    this.plugin.registerEvent(workspace.on('file-open',file=>{this.app.workspace.iterateAllLeaves?.(leaf=>this.nativeChrome(leaf.view));const item=file?this.files.get(file.path):undefined;if(!item)return;this.captureBases(item);}));
    this.plugin.registerEditorSuggest(new CodebaseLinkSuggest(this.app,this));
    this.plugin.registerView(VIEW,leaf=>new CodebaseView(leaf,this));
    this.plugin.addCommand({id:'codebase-view',name:'Open Codebase view',callback:()=>void this.show()});
    this.plugin.addCommand({id:'review-codebase-edit',name:'Review unsaved project edit',checkCallback:checking=>{const file=workspace.getActiveViewOfType(MarkdownView)?.file,item=file?this.files.get(file.path):undefined;if(!item||this.drafts[item.file.path]===undefined)return false;if(!checking)void this.review(item).catch(error=>new Notice(error.message,10000));return true;}});
    this.plugin.addCommand({id:'review-codebase-edits',name:'Review all unsaved project edits',checkCallback:checking=>{const items=[...this.files.values()].filter(item=>this.drafts[item.file.path]!==undefined||Object.entries(this.draftAliases).some(([old,path])=>path===item.file.path&&this.drafts[old]!==undefined));if(!items.length)return false;if(!checking)new FileChoice(this.app,items,item=>{if(item)void this.review(item).catch(error=>new Notice(error.message));},scope=>this.scopeTitle(scope)).open();return true;}});
    this.plugin.addCommand({id:'refresh-codebase',name:'Refresh Codebase view',callback:()=>void this.refresh()});
    this.plugin.addCommand({id:'copy-codebase-performance',name:'Copy Codebase performance report',callback:()=>{void navigator.clipboard.writeText(JSON.stringify(this.performanceReport(),null,2)).then(()=>new Notice('Codebase performance report copied.')).catch(error=>new Notice(String(error)));}});
    this.plugin.registerInterval(window.setInterval(()=>{void this.refresh(false).catch(()=>{});},15000));
    workspace.onLayoutReady(()=>void this.show(false));
  }
  adopt(saved:CodebaseState|undefined){
    if(saved?.version!==1)return;for(const [key,paths] of Object.entries(saved.automaticChoices??{}))this.automaticChoices.set(key,new Set(paths));const migrated:Record<string,string>={};
    for(const [oldKey,record] of Object.entries(saved.references??{}))try{
      const key=virtualPath(record.scope,record.path);migrated[oldKey]=key;
      const legacy=CODEBASE_PREFIX+scopeKey(record.scope)+'/'+record.path;this.legacyPaths[legacy]??=key;
      if(oldKey!==key&&this.drafts[oldKey]!==undefined){this.draftAliases[oldKey]=key;if(this.drafts[key]===undefined)this.retain(key,this.drafts[oldKey]);}
      this.knownScopes.set(virtualPath(record.scope,'identity'),record.scope);this.records.set(key,record);
      if(this.allowed(record.scope)||this.drafts[key]!==undefined){const item=this.register(record.scope,record.path);this.records.set(key,record);if(oldKey!==key&&this.drafts[oldKey]!==undefined)item.document.uncertain=true;}
    }catch{/* Invalid identities cannot enter the registry. */}
    this.local('draft-aliases',this.draftAliases);
    this.local('legacy-paths',this.legacyPaths);
    for(const [key,path] of Object.entries(saved.choices??{})){let choice=key;try{const [source,name]=JSON.parse(key);choice=JSON.stringify([migrated[source]??this.legacyPaths[source]??source,name]);}catch{}this.choices[choice]=migrated[path]??this.legacyPaths[path]??path;}
    for(const [source,path] of Object.entries(saved.vaultAliases??{}))if(/^T3 Code Attachments\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{16}-[^/]+$/i.test(source)&&this.records.has(migrated[path]??path))this.vaultAliases[source]=migrated[path]??path;
  }

  private patch(target:any,key:string,wrap:(original:any)=>any){if(typeof target[key]!=='function')return;const original=target[key],replacement=wrap(original.bind(target));target[key]=replacement;this.undo.push(()=>{if(target===this.app.vault.adapter)return;/* Keep a fail-closed prefix guard while old native leaves unload. */if(target[key]===replacement)target[key]=original;});}
  private environmentIds(){return [...new Set(this.storage?.environments?.()??this.scopes().map(scope=>scope.environmentId))];}
  private allowed(scope:CodebaseScope,linked=this.scopes()){
    if(this.storage?.environments)return this.environmentIds().includes(scope.environmentId)&&!this.links().some(link=>link.self&&link.environmentId===scope.environmentId&&link.projectId===scope.projectId);
    return linked.some(s=>s.environmentId===scope.environmentId&&s.projectId===scope.projectId&&(!!scope.threadId||s.root===scope.root));
  }
  private editorLeaves(){return [...new Set(['markdown',...this.languageViews.types()].flatMap(type=>this.app.workspace.getLeavesOfType(type)))];}
  private canRead(path:string){return !this.editorLeaves().some(leaf=>{const view=leaf.view as MarkdownView&{saving?:unknown};return view.file?.path===path&&!!view.saving;});}
  private viewText(view:MarkdownView){return view.getMode?.()==='preview'?view.getViewData():view.editor?.getValue();}
  private viewBase(view:MarkdownView,item:RegisteredFile){const basis=this.viewBases.get(view);return basis?.path===item.file.path?basis:undefined;}
  private setViewBase(view:MarkdownView,item:RegisteredFile,text:string){this.viewBases.set(view,{path:item.file.path,text});}
  private captureBases(item:RegisteredFile){if(item.document.base===undefined)return;for(const leaf of this.editorLeaves()){const view=leaf.view as MarkdownView;if(view.file?.path!==item.file.path)continue;const basis=this.viewBase(view,item),text=this.viewText(view),saved=(view as MarkdownView&{lastSavedData?:string}).lastSavedData;
    if(text===item.document.base&&(!basis||saved===item.document.base))this.setViewBase(view,item,item.document.base);
    else if(!basis&&item.text!==undefined&&text===item.text&&saved===item.text)this.setViewBase(view,item,item.text);
  }}
  private savedViewText(view:MarkdownView,item:RegisteredFile,before:string|undefined,text:string){
    if(view.file?.path!==item.file.path)return false;
    const value=this.viewText(view);if(value!==before&&value!==text)return false;
    const native=view as MarkdownView&{lastSavedData?:string;saving?:unknown};
    const canSync='data' in native&&'lastSavedData' in native&&!native.saving&&(native.data===before||native.data===text)&&(native.lastSavedData===before||native.lastSavedData===text);
    // A verified own save already has these buffers; advance its basis without changing core state.
    if(value===text&&view.getViewData()===text&&native.data===text&&native.lastSavedData===text)return true;
    // Adopt visible and saved text together; a pending core save must settle first.
    if('data' in native&&'lastSavedData' in native&&!canSync)return false;
    if(value!==text)view.setViewData(text,false);
    // Mirror the saved buffer only for this confirmed, unchanged native file.
    // Keep in-flight saves and unexpected/dirty native state under core control.
    if(canSync&&view.file?.path===item.file.path&&this.viewText(view)===text&&(typeof view.getViewData!=='function'||view.getViewData()===text)&&!native.saving&&(native.lastSavedData===before||native.lastSavedData===text)){native.data=text;native.lastSavedData=text;}
    return view.file?.path===item.file.path&&this.viewText(view)===text&&view.getViewData()===text;
  }
  private synchronizePeers(item:RegisteredFile,_before:string|undefined,text:string){if(this.stopped)return;for(const leaf of this.editorLeaves()){const view=leaf.view as MarkdownView,basis=this.viewBase(view,item);if(view.file?.path!==item.file.path||!basis)continue;const value=this.viewText(view);if(value===basis.text||value===text){try{if(this.savedViewText(view,item,basis.text,text))this.setViewBase(view,item,text);}catch{/* A native editor that did not adopt the text keeps its old basis for retry. */}}}}
  private nativeChrome(view:any){
    const item=view.file?this.files.get(view.file.path):undefined,header=view.containerEl?.querySelector('.view-header-title-container');
    this.chrome.get(view)?.disconnect();this.chrome.delete(view);if(!header)return;
    if(!item){for(const el of header.querySelectorAll('[data-t3-codebase-hidden]'))el.removeAttribute('data-t3-codebase-hidden');return;}
    const label=()=>{if(this.stopped||view.file?.path!==item.file.path)return;const crumbs=Array.from(header.querySelectorAll('.view-header-breadcrumb')) as HTMLElement[];if(crumbs.length<5)return;for(const el of Array.from(header.querySelector('.view-header-title-parent')?.children??[]) as HTMLElement[])if(crumbs.indexOf(el)>=0&&crumbs.indexOf(el)<4||el.classList.contains('view-header-breadcrumb-separator')&&Array.from(el.parentElement!.children).indexOf(el)<8)el.setAttribute('data-t3-codebase-hidden','true');const project=crumbs[4];const title=this.scopeTitle(item.scope);if(project.textContent!==title)project.setText(title);project.setAttribute('aria-label',title);project.draggable=false;};
    label();if(typeof MutationObserver!=='undefined'){const observer=new MutationObserver(label);observer.observe(header,{childList:true,subtree:true});this.chrome.set(view,observer);}
  }
  scopes(){return linkedCodebases(this.links());}
  scopeTitle(scope:CodebaseScope){return scope.threadId?scope.title:codebaseRootLabels(this.scopes()).get(scopeKey(scope))??scope.title;}
  /** On demand, durations/counts only. No journal, content, identities or paths. */
  performanceReport(){
    return {version:1,release:this.plugin.manifest.version,scopeCount:this.scopes().length,views:[...this.views].map(view=>({rowCount:view.rowCount,synchronousCpu:timingSummaries(view.timings,['render','reveal'])})),transport:timingSummaries(this.io.timings??[],['connect','catalog','projects.listEntries','projects.searchEntries','projects.readFile','projects.writeFile','assets.createUrl'],200)};
  }
  /** Decorate native recent-file rows at render time, preserving their targets. */
  private nativeSwitcher(){
    const prototype=(this.app as any).internalPlugins?.getPluginById?.('switcher')?.instance?.QuickSwitcherModal?.prototype;
    if(!prototype||typeof prototype.renderSuggestion!=='function')return;
    const own=Object.getOwnPropertyDescriptor(prototype,'renderSuggestion'),original=prototype.renderSuggestion,bridge=this;
    const replacement=function(this:any,suggestion:any,el:HTMLElement){
      const result=original.call(this,suggestion,el),item=!bridge.stopped&&suggestion?.type==='file'&&this.app===bridge.app?bridge.files.get(suggestion.file?.path):undefined;
      if(item){const title=el.querySelector<HTMLElement>('.suggestion-title'),content=el.querySelector<HTMLElement>('.suggestion-content');title?.setText(item.file.extension==='md'?item.file.basename:item.file.name);if(content){const note=content.querySelector<HTMLElement>('.suggestion-note')??content.createDiv({cls:'suggestion-note'}),folder=item.path.split('/').slice(0,-1).join('/');note.setText(bridge.scopeTitle(item.scope)+(folder?' / '+folder:''));}}
      return result;
    };
    try{Object.defineProperty(prototype,'renderSuggestion',{configurable:true,writable:true,value:replacement});}catch{return;}
    this.undo.push(()=>{if(prototype.renderSuggestion!==replacement)return;if(own)Object.defineProperty(prototype,'renderSuggestion',own);else delete prototype.renderSuggestion;});
  }
  /** Keep native callers on native views for external text and prepared media. */
  private nativeFileOpen(){
    const prototype=WorkspaceLeaf?.prototype;
    if(!prototype||typeof prototype.openFile!=='function')return;
    const own=Object.getOwnPropertyDescriptor(prototype,'openFile'),original:any=prototype.openFile,bridge=this;
    const replacement=function(this:WorkspaceLeaf&{app:App},file:TFile,...args:any[]){
      const item=!bridge.stopped&&this.app===bridge.app&&file?.path?bridge.files.get(file.path):undefined;
      if(!item)return original.call(this,file,...args);
      if(file.extension==='md'||MEDIA.test(item.path)||(bridge.app as any).viewRegistry?.getTypeByExtension?.(file.extension))return bridge.prepare(item).then(()=>original.call(this,file,...args));
      const options=args[0]??{};return bridge.open(item,this,{...options,active:options.active??(this===bridge.app.workspace.activeLeaf)});
    };
    try{Object.defineProperty(prototype,'openFile',{configurable:true,writable:true,value:replacement});}catch{return;}
    this.undo.push(()=>{if(prototype.openFile!==replacement)return;if(own)Object.defineProperty(prototype,'openFile',own);else delete (prototype as any).openFile;});
  }
  reconcileLinks(){this.renderViews();}
  private retain(path:string,draft:string|undefined){if(draft===undefined)delete this.drafts[path];else this.drafts[path]=draft;this.app.saveLocalStorage(this.draftsKey,this.drafts);}
  register(scope:CodebaseScope,path:string):RegisteredFile {
    relativeCodebasePath(path);this.knownScopes.set(virtualPath(scope,'identity'),scope);const key=virtualPath(scope,path),existing=this.files.get(key);if(existing)return existing;
    const file:TFile=new (TFile as any)(this.app.vault,key);file.vault=this.app.vault;file.path=key;file.name=path.split('/').at(-1)!;const dot=file.name.lastIndexOf('.');file.basename=dot<0?file.name:file.name.slice(0,dot);file.extension=dot<0?'':file.name.slice(dot+1);file.stat={ctime:0,mtime:0,size:0};
    const parent=key.slice(0,key.lastIndexOf('/'));let folder=this.folders.get(parent);if(!folder){folder=new (TFolder as any)(this.app.vault,parent) as TFolder;folder.vault=this.app.vault;folder.path=parent;folder.name=path.split('/').slice(0,-1).at(-1)??scope.title;folder.parent=null;folder.children=[];this.folders.set(parent,folder);}file.parent=folder;folder.children.push(file);
    const document=new CodebaseDocument(scope,path,this.io,draft=>this.retain(key,draft),()=>this.canRead(key));if(this.drafts[key]!==undefined)document.uncertain=true;const item={scope,path,file,document};this.files.set(key,item);return item;
  }
  private pin(item:RegisteredFile,source=''){this.records.set(item.file.path,{scope:item.scope,path:item.path,note:source||this.records.get(item.file.path)?.note||'',name:item.file.name});clearTimeout(this.persistTimer);this.persistTimer=setTimeout(()=>{this.persistTimer=undefined;void this.persist().catch(()=>{});},250);}
  remember(file:TFile,source:string){this.automaticChoices.delete(JSON.stringify([source,file.name]));const item=this.files.get(file.path);if(item){this.choices[JSON.stringify([source,file.name])]=file.path;this.pin(item,source);}}
  label(file:TFile){const item=this.files.get(file.path);return item?`${this.scopeTitle(item.scope)} / ${item.path}`:file.path;}
  candidates(name:string,source:string){const links=this.links(),scopes=linkedCodebases(links),collision=(this.automaticChoices.get(JSON.stringify([source,projectLink(name)?.path??name]))?.size??0)>1;return contextualCandidates([...this.files.values()].filter(item=>this.allowed(item.scope,scopes)),name,source,collision?[]:links);}
  async suggestions(query:string,source:string){if(query.length>2)try{await this.search(query,source);}catch{}const links=this.links(),scopes=linkedCodebases(links),linked=links.filter(l=>source.startsWith(l.folderPath+'/')).sort((a,b)=>b.folderPath.length-a.folderPath.length)[0],lower=query.toLowerCase();return [...this.files.values()].filter(f=>this.allowed(f.scope,scopes)&&(!linked||f.scope.projectId===linked.projectId&&f.scope.environmentId===linked.environmentId)&&f.file.name.toLowerCase().includes(lower)).slice(0,100);}
  private resolve(name:string,source:string){const route=this.pathRoute(name,source);if(route.owned)return route.items.length===1?route.items[0]:undefined;const sourceItem=this.files.get(source);if(sourceItem){const clean=name.split('#')[0];if(!clean)return sourceItem;if(clean.includes('/')){const parts=sourceItem.path.split('/').slice(0,-1);for(const part of clean.split('/')){if(part==='.')continue;if(part==='..'){if(!parts.length)return undefined;parts.pop();}else parts.push(part);}const relative=this.files.get(virtualPath(sourceItem.scope,parts.join('/')));if(relative)return relative;}}const own=this.files.get(name.split('#')[0]);if(own&&this.allowed(own.scope))return own;const remembered=this.choices[JSON.stringify([source,projectLink(name)?.path??name]) ]??this.choices[JSON.stringify([source,name.split('#')[0]])];if(remembered&&this.files.has(remembered)&&this.allowed(this.files.get(remembered)!.scope))return this.files.get(remembered);const sourceFile=this.files.get(source);const candidates=this.candidates(name,source);if(sourceFile){const same=candidates.filter(f=>scopeKey(f.scope)===scopeKey(sourceFile.scope));if(same.length===1)return same[0];}return candidates.length===1?candidates[0]:undefined;}
  private choose(items:RegisteredFile[],name:string,source:string){return new Promise<RegisteredFile|undefined>(resolve=>{new FileChoice(this.app,items,item=>{if(item){const key=JSON.stringify([source,projectLink(name)?.path??name]);this.automaticChoices.delete(key);this.choices[key]=item.file.path;void this.persist();}resolve(item);},scope=>this.scopeTitle(scope)).open();});}
  private persist(){this.persistence=this.persistence.catch(()=>{}).then(async()=>{const state:CodebaseState={version:1,references:Object.fromEntries(this.records),choices:this.choices,automaticChoices:Object.fromEntries([...this.automaticChoices].map(([key,paths])=>[key,[...paths]])),...(Object.keys(this.vaultAliases).length?{vaultAliases:this.vaultAliases}:{})};if(this.storage){if(JSON.stringify(state)!==JSON.stringify(this.storage.load()))await this.storage.save(state);return;}const adapter=this.app.vault.adapter,dir=this.metadataPath.slice(0,this.metadataPath.lastIndexOf('/'));if(!await adapter.exists(dir))await adapter.mkdir(dir);await adapter.write(this.metadataPath,JSON.stringify(state));});return this.persistence;}
  private vaultAlias(path:string){const item=this.files.get(this.vaultAliases[path]);return item&&this.allowed(item.scope)?item:undefined;}
  async archiveReplyImports(environmentId:string,projectId:string,directory:string,archive:typeof import('./legacy-reply-imports-desktop').archiveLegacyReplyImports){
    const scope=this.scopes().find(scope=>scope.environmentId===environmentId&&scope.projectId===projectId);
    if(!scope)throw Error('Choose a linked project outside the vault.');
    await this.io.list(scope,''); // Check the authenticated project's current workspace.
    return archive(this.app,scope,directory,async copies=>{
      for(const copy of copies)if(/\.(?:md|txt|json|jsonl|log|[cm]?jsx?|tsx?|css|py|ya?ml|csv|xml|html?)$/i.test(copy.path)&&contentHash(await this.io.read(scope,copy.path))!==copy.sha256)throw Error('T3 could not verify the archived project file.');
      for(const copy of copies){const item=this.register(scope,copy.path);this.pin(item);this.vaultAliases[copy.source]=item.file.path;}
      await this.persist();
    });
  }

  async search(name:string,source:string){
    const key=JSON.stringify([name,source]);if(Date.now()-(this.searchAt.get(key)??0)<15000)return;
    const pending=this.searches.get(key);if(pending)return pending;
    const task=this.searchUncached(name,source);this.searches.set(key,task);try{await task;this.searchAt.set(key,Date.now());}finally{this.searches.delete(key);}
  }
  private async searchUncached(name:string,source:string){
    const link=this.links().filter(l=>source.startsWith(l.folderPath+'/')).sort((a,b)=>b.folderPath.length-a.folderPath.length)[0];
    const scopes=this.scopes(),ordered=link?[...scopes.filter(s=>s.projectId===link.projectId&&s.environmentId===link.environmentId),...scopes.filter(s=>s.projectId!==link.projectId||s.environmentId!==link.environmentId)]:scopes;
    let failure:unknown;
    for(const scope of ordered){
      try{const workspaces=[scope,...[...this.records.values()].filter(r=>r.scope.threadId&&r.scope.projectId===scope.projectId&&r.scope.environmentId===scope.environmentId).map(r=>r.scope)];for(const workspace of new Map(workspaces.map(s=>[scopeKey(s),s])).values()){const entries=await this.io.search(workspace,name);for(const entry of entries)if(entry.kind==='file')this.register(workspace,entry.path);}if(link&&scope.projectId===link.projectId&&this.candidates(name,source).length)break;}
      catch(error){failure=error;}
    }
    if(failure&&!this.candidates(name,source).length)throw failure;
  }

  async list(scope:CodebaseScope,directory:string){await this.browse.load(scope,directory);const result=this.browse.get(scope,directory);if(!result)throw Error(this.browse.errors.get(JSON.stringify([scopeKey(scope),scope.root,directory]))??'The project folder is unavailable.');return result.entries;}
  private resource(item:RegisteredFile){if(this.stopped||!this.allowed(item.scope))return '';if(!item.resource||item.resource.expiresAt<Date.now()+5000){void this.prepare(item,true).catch(()=>{});return '';}return item.resource.url;}
  async prepare(item:RegisteredFile,binary=false){if(this.stopped)throw Error('The project file bridge is stopped.');if(!this.allowed(item.scope))throw Error(this.storage?.environments?'The project environment is disconnected or unavailable.':'This project is no longer linked to the vault.');if((binary||MEDIA.test(item.path))&&(!item.resource||item.resource.expiresAt<Date.now()+60000)){if(!item.preparing){item.preparing=this.io.resource(item.scope,item.path).then(resource=>{if(this.stopped||!this.allowed(item.scope))throw Error('The project file is no longer available.');item.resource=resource;});void item.preparing.finally(()=>{item.preparing=undefined;}).catch(()=>{});}await item.preparing;}}
  /** Only rendered media needs discovery or a signed resource. Vault reads
   * remain free of Markdown parsing and background project searches. */
  private async prepareRenderedEmbed(link:string,source:string){
    if(this.stopped||!MEDIA.test(link.split('#')[0].split('?')[0]))return;
    let item=this.resolve(link,source);
    if(!item&&(this.absoluteReference(link)||this.storage?.environments&&projectLink(link)?.path.includes('/')&&!this.app.metadataCache.getFirstLinkpathDest(link,source))){await this.discoverWorkspaces();item=this.resolve(link,source);}
    if(!item&&!this.app.metadataCache.getFirstLinkpathDest(link,source)){
      const sourceItem=this.files.get(source);
      if(sourceItem){
        const parts=sourceItem.path.split('/').slice(0,-1);
        for(const part of link.split('#')[0].split('/')){if(part==='.')continue;if(part==='..'){if(!parts.length)return;parts.pop();}else parts.push(part);}
        item=this.register(sourceItem.scope,parts.join('/'));
      }else if(!/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(link)){await this.search(link,source);item=this.resolve(link,source);}
    }
    if(item){await this.prepare(item);return item;}
  }

  private fileCache(path:string){const text=this.files.get(path)?.text??'',headings:any[]=[];let offset=0;for(const [line,content] of text.split('\n').entries()){const match=/^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(content);if(match)headings.push({heading:match[2],level:match[1].length,position:{start:{line,col:0,offset},end:{line,col:content.length,offset:offset+content.length}}});offset+=content.length+1;}return {headings};}
  async open(item:RegisteredFile,leaf=this.app.workspace.getLeaf(false),state?:any,subpath?:string){
    this.pin(item);await this.prepare(item);
    if(subpath)state={...state,eState:{...state?.eState,subpath}};
    if(MEDIA.test(item.path)||item.file.extension!=='md'&&(this.app as any).viewRegistry?.getTypeByExtension?.(item.file.extension)){await leaf.openFile(item.file,state);this.nativeChrome(leaf.view);return;}
    const text=await this.app.vault.read(item.file);if(this.stopped||!this.allowed(item.scope))throw Error('The project file is no longer available.');item.text=text;
    await leaf.setViewState({type:this.languageViews.type(item.file.extension)??'markdown',state:{...state?.state,file:item.file.path,mode:state?.state?.mode==='preview'?'preview':'source',source:item.file.extension.toLowerCase()!=='md'},active:state?.active??true,group:state?.group},state?.eState);
    if(!(leaf.view instanceof MarkdownView))throw Error('Obsidian could not open its native editor.');
    this.setViewBase(leaf.view,item,item.document.base!);
    this.nativeChrome(leaf.view);
    const draft=this.drafts[item.file.path];if(draft!==undefined&&draft!==text&&!this.recoveryNotices.has(item.file.path)){this.recoveryNotices.add(item.file.path);new Notice('An unsaved project edit is kept on this device. Use Review unsaved project edit to compare and recover it.',10000);}
    if(state?.eState&&Object.keys(state.eState).length)leaf.view.setEphemeralState(state.eState);
  }
  async reply(reference:ReplyReference,request:ResponseRequest,access:ThreadAccess){
    this.observeSource(request);
    const parsed=projectLink(reference.source);if(!parsed)return undefined;
    const shell=await access.api('/api/orchestration/shell');
    const scopes=catalogCodebases(request.threadEnvironmentId,shell).filter(scope=>scope.projectId===request.projectId&&(!scope.threadId||scope.threadId===request.threadId));
    if(!scopes.length)return undefined;
    for(const scope of scopes)this.knownScopes.set(virtualPath(scope,'identity'),scope);
    const route=projectPathRoutes(reference.source,scopes);let match=route.matches[0];
    if(!route.owned&&!/^(?:\/|[a-z]:\/)/i.test(parsed.path))try{relativeCodebasePath(parsed.path);match={scope:scopes.at(-1)!,path:parsed.path};}catch{}
    if(match&&this.allowed(match.scope)){const item=this.register(match.scope,match.path);this.automaticChoice(request.notePath,parsed.path,item.file.path);this.automaticChoice(request.notePath,item.file.name,item.file.path);this.pin(item,request.notePath);if(MEDIA.test(item.path)&&typeof this.io.resource==='function')await this.prepare(item);}
    // References retain their original spelling. Resolution is a plugin concern.
    return undefined;
  }
  private automaticChoice(source:string,name:string,path:string){const key=JSON.stringify([source,name]);let paths=this.automaticChoices.get(key);if(!paths&&this.choices[key])return;if(!paths){paths=new Set();this.automaticChoices.set(key,paths);}paths.add(path);if(paths.size===1)this.choices[key]=path;else delete this.choices[key];}
  /** Constant work per response update; no Markdown parse, file IO or network. */
  observeSource(request:ResponseRequest,note=request.notePath){
    let origins=this.sourceOrigins.get(note);if(!origins){origins=new Map();this.sourceOrigins.set(note,origins);}if(origins.has(request.id))return;origins.set(request.id,{environmentId:request.threadEnvironmentId,projectId:request.projectId});
  }
  /** Handle local file URLs that native Markdown classifies as external links. */
  private nativePathLinks(){
    const replay=new WeakSet<Element>();
    const sourceFor=(el:Element)=>{let source='';this.app.workspace.iterateAllLeaves?.(leaf=>{const view=leaf.view as MarkdownView;if(view.containerEl?.contains(el))source=view.file?.path??'';});return source;};
    if(this.plugin.registerDomEvent&&typeof document.addEventListener==='function')this.plugin.registerDomEvent(document,'click',event=>{
      const target=event.target as Element|null,anchor=target?.closest?.('a[data-href],a[href]');if(!anchor)return;
      if(anchor.classList?.contains('internal-link'))return;
      if(replay.delete(anchor))return;
      const link=anchor.getAttribute('data-href')??anchor.getAttribute('href');if(!link)return;
      const source=sourceFor(anchor),route=this.pathRoute(link,source),absolute=this.absoluteReference(link);
      if(!route.owned&&(!absolute||!this.io.workspaces&&!this.io.catalog||!this.environmentIds().length))return;
      event.preventDefault();event.stopImmediatePropagation();
      const open=async()=>{const discovered=route.owned||await this.discoverWorkspaces();if(this.stopped)return;if(this.pathRoute(link,source).owned)await this.app.workspace.openLinkText(link,source,event.ctrlKey||event.metaKey);else if(!discovered||this.sourceOrigins.has(source)||this.files.has(source)){new Notice('Project locations are unavailable.');}else{replay.add(anchor);anchor.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,altKey:event.altKey}));}};
      void open().catch(error=>new Notice(String(error),10000));
    },{capture:true});
    this.plugin.registerMarkdownPostProcessor?.((el,context)=>this.renderMedia(el,context.sourcePath,image=>{const section=context.getSectionInfo?.(el);return section?originalMediaSource(section.text,image.getAttribute('alt'),section):undefined;}));
  }

  private async renderMedia(el:HTMLElement,source:string,original?:(image:Element)=>string|undefined,current:()=>boolean=()=>true){
    for(const embed of Array.from(el.querySelectorAll('.internal-embed[src], .internal-embed[data-src]'))){
      if(this.stopped||!current())return;
      const link=embed.getAttribute('src')??embed.getAttribute('data-src');if(!link)continue;
      try{
        const item=await this.prepareRenderedEmbed(link,source);
        if(!item||this.stopped||!current()||!this.allowed(item.scope)||!item.resource||(embed.getAttribute('src')??embed.getAttribute('data-src'))!==link)continue;
        const media=embed.querySelector('img, video, audio, iframe, embed');
        if(media){if(media.getAttribute('src')!==item.resource.url)media.setAttribute('src',item.resource.url);}
        else if(/\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(item.path)){const image=embed.ownerDocument.createElement('img');image.setAttribute('src',item.resource.url);image.setAttribute('alt',link);embed.replaceChildren(image);}
      }catch{/* An unavailable embed cannot block the rest of the note. */}
    }
    for(const image of Array.from(el.querySelectorAll('img'))){
      if(this.stopped||!current())return;
      const rendered=image.getAttribute('src')??'',native=nativeMediaSource(rendered,this.app.vault.adapter.getResourcePath?.(''));
      if(native?.vaultRelative&&this.physicalFileLookup?.(native.vaultRelative))continue;
      const parent=image.closest?.('.internal-embed[src], .internal-embed[data-src]'),parentLink=parent?.getAttribute('src')??parent?.getAttribute('data-src');
      if(!native&&!parentLink)continue; // Signed resources and ordinary web images need no work.
      const originalLink=original?.(image),link=parentLink??originalLink??native?.link;if(!link)continue;
      try{
        const item=await this.prepareRenderedEmbed(link,source);
        if(!item||this.stopped||!current()||!this.allowed(item.scope)||!item.resource||(image.getAttribute('src')??'')!==rendered)continue;
        if(parentLink&&(parent?.getAttribute('src')??parent?.getAttribute('data-src'))!==parentLink)continue;
        if(!parentLink&&originalLink!==undefined&&original?.(image)!==originalLink)continue;
        if(image.getAttribute('src')!==item.resource.url)image.setAttribute('src',item.resource.url);
      }catch{/* Retain native alt text and allow an explicit refresh after access recovers. */}
    }
  }

  private absoluteReference(name:string){const path=projectLink(name)?.path;if(!path)return false;return /^(?:\/|[a-z]:\/)/i.test(path)||this.scopes().some(scope=>scope.root.startsWith('/')&&path.startsWith(scope.root.split('/')[1]+'/'));}
  private vaultWikiLink(name:string,source:string){
    if(this.files.has(source)||source.startsWith(CODEBASE_PREFIX)||name.startsWith(CODEBASE_PREFIX))return false;
    // Live Preview can dispatch a click before its edited link is cached.
    if(typeof window!=='undefined'&&(window.event?.target as Element|null)?.closest?.('.cm-hmd-internal-link'))return true;
    const path=name.split('#')[0];
    return this.app.metadataCache.getCache?.(source)?.links?.some(link=>link.original.startsWith('[[')&&link.link.split('#')[0]===path)??false;
  }
  private routeScopes(linked=this.scopes()){const scopes=[...linked,...this.knownScopes.values(),...linked.flatMap(scope=>this.browse.workspaces(scope)),...[...this.workspaceScopes.values()].flatMap(r=>r.value)];return [...new Map(scopes.map(s=>[virtualPath(s,'identity'),s])).values()];}
  private pathRoute(name:string,source:string){
    if(name.startsWith('T3 Code Attachments/')||name.startsWith('T3%20Code%20Attachments/')){
      const alias=projectLink(name)?.path??name.split('#')[0];
      if(this.vaultAliases[alias]&&!this.physicalFileLookup?.(alias)){const item=this.vaultAlias(alias);return {owned:true,items:item?[item]:[] as RegisteredFile[]};}
    }
    if(!/[\\/]/.test(name)||/^(?!file:|sandbox:)[a-z][a-z0-9+.-]*:/i.test(name)&&! /^[a-z]:[\\/]/i.test(name))return {owned:false,items:[] as RegisteredFile[]};
    const linked=this.scopes(),scopes=this.routeScopes(linked),parsed=projectLink(name);
    if(parsed&&!/^(?:\/|[a-z]:\/)/i.test(parsed.path)&&!scopes.some(scope=>scope.root.startsWith('/')&&parsed.path.startsWith(scope.root.split('/')[1]+'/')))return {owned:false,items:[] as RegisteredFile[]};
    const allowed=(scope:CodebaseScope)=>this.allowed(scope,linked),active=scopes.filter(allowed);
    const remembered=this.choices[JSON.stringify([source,projectLink(name)?.path??name]) ]??this.choices[JSON.stringify([source,name.split('#')[0]])],chosen=remembered?this.files.get(remembered):undefined;
    if(chosen&&!allowed(chosen.scope)&&projectPathRoutes(name,[chosen.scope]).owned)return {owned:true,items:[] as RegisteredFile[]};
    const origins=[...this.sourceOrigins.get(source)?.values()??[]],originKeys=new Set(origins.map(origin=>JSON.stringify(origin))),origin=originKeys.size===1?origins[0]:undefined;
    const sourceScope=this.files.get(source)?.scope,link=this.links().filter(l=>source===l.folderPath||source.startsWith(l.folderPath+'/')).sort((a,b)=>b.folderPath.length-a.folderPath.length)[0],collision=(this.automaticChoices.get(JSON.stringify([source,parsed?.path??name]))?.size??0)>1,context=sourceScope??(collision?undefined:origin??(originKeys.size>1?undefined:link));
    const preferred=[...(chosen&&allowed(chosen.scope)?[[chosen.scope]]:[]),...(context?[active.filter(s=>s.environmentId===context.environmentId&&s.projectId===context.projectId),active.filter(s=>s.environmentId===context.environmentId)]:[]),...(!sourceScope&&(!origin||collision)?[active]:[])];
    for(const candidates of preferred){const route=projectPathRoutes(name,candidates);if(route.owned)return {owned:true,items:route.matches.map(r=>this.register(r.scope,r.path))};}
    return {owned:projectPathRoutes(name,scopes).owned,items:[] as RegisteredFile[]};
  }
  private async discoverWorkspaces(){
    if(this.io.catalog&&this.storage?.environments){
      let complete=true;
      // Keep cross-machine discovery bounded; each transport shares its catalog request.
      for(const environmentId of this.environmentIds()){
        const key='environment:'+environmentId;let record=this.workspaceScopes.get(key);
        if(record?.pending){await record.pending;complete&&=!record.error;continue;}
        if(record&&Date.now()-record.at<15000){complete&&=!record.error;continue;}
        if(!record){record={at:0,value:[]};this.workspaceScopes.set(key,record);}const current=record;
        current.pending=this.io.catalog(environmentId).then(value=>{if(this.stopped)return;current.value=value;current.error=false;current.at=Date.now();}).catch(()=>{current.error=true;current.at=Date.now();}).finally(()=>{current.pending=undefined;});
        await current.pending;complete&&=!current.error;
      }
      return complete;
    }
    if(!this.io.workspaces)return false;
    const records=await Promise.all(this.scopes().map(async scope=>{
      const key=virtualPath(scope,'identity');let record=this.workspaceScopes.get(key);
      if(record?.pending){await record.pending;return record;}
      if(record&&Date.now()-record.at<15000)return record;
      if(!record){record={at:0,value:[]};this.workspaceScopes.set(key,record);}const current=record;
      current.pending=this.io.workspaces!(scope).then(value=>{current.value=value;current.error=false;current.at=Date.now();}).catch(()=>{current.error=true;current.at=Date.now();}).finally(()=>{current.pending=undefined;});
      await current.pending;return current;
    }));return records.every(record=>!record.error);
  }
  private async review(item:RegisteredFile){
    const previous=Object.entries(this.draftAliases).filter(([old,key])=>key===item.file.path&&this.drafts[old]!==undefined).map(([old])=>({key:old,text:this.drafts[old]}));
    const draft=this.drafts[item.file.path]??previous[0]?.text;if(draft===undefined)return;
    let remote:string|undefined,error='The project is no longer linked.';if(this.allowed(item.scope))try{remote=await this.io.read(item.scope,item.path);}catch(failure){error=String(failure);}
    const modal=new Modal(this.app);modal.titleEl.setText('Review unsaved project edit');modal.contentEl.createEl('h3',{text:remote===undefined?'Project file unavailable':'Current project file'});modal.contentEl.createEl('pre',{text:remote??error});modal.contentEl.createEl('h3',{text:'Your local edit'});modal.contentEl.createEl('pre',{text:draft});
    new Setting(modal.contentEl).addButton(button=>button.setButtonText('Copy local edit').onClick(()=>{void navigator.clipboard.writeText(draft);}));
    for(const old of previous)if(old.text!==draft){modal.contentEl.createEl('h3',{text:'Previous local edit'});modal.contentEl.createEl('pre',{text:old.text});new Setting(modal.contentEl).addButton(button=>button.setButtonText('Copy previous local edit').onClick(()=>{void navigator.clipboard.writeText(old.text);}));}
    if(remote!==undefined)new Setting(modal.contentEl).addButton(button=>button.setButtonText('Keep project version').onClick(()=>{item.document=new CodebaseDocument(item.scope,item.path,this.io,text=>this.retain(item.file.path,text),()=>this.canRead(item.file.path));this.retain(item.file.path,undefined);for(const old of previous)this.retain(old.key,undefined);modal.close();void this.open(item);})).addButton(button=>button.setButtonText('Save local edit').onClick(async()=>{button.setDisabled(true);try{if(!this.allowed(item.scope)||await this.io.read(item.scope,item.path)!==remote)throw Error('The project changed again. Close this window and compare again.');item.document=new CodebaseDocument(item.scope,item.path,this.io,text=>this.retain(item.file.path,text),()=>this.canRead(item.file.path));await item.document.read();await item.document.save(draft);item.text=draft;this.synchronizePeers(item,remote,draft);for(const old of previous)if(old.text===draft)this.retain(old.key,undefined);modal.close();}catch(failure){new Notice(String(failure),10000);button.setDisabled(false);}}));
    modal.open();return modal;
  }

  projectMenu(scope:CodebaseScope,event:MouseEvent){
    if(scope.threadId)return;
    const menu=new Menu();
    menu.addItem(item=>item.setTitle('Rename project…').setIcon('pencil').setDisabled(!this.io.renameProject||!this.storage?.projectChanged).onClick(()=>this.projectModal(scope,false)));
    menu.addItem(item=>item.setTitle('Delete project…').setIcon('trash').setDisabled(!this.io.deleteProject||!this.storage?.projectChanged).onClick(()=>this.projectModal(scope,true)));
    menu.showAtMouseEvent(event);
  }
  private projectModal(scope:CodebaseScope,deleting:boolean){
    const modal=new Modal(this.app);modal.titleEl.setText(deleting?'Delete T3 project':'Rename T3 project');
    modal.contentEl.createEl('p',{text:this.scopeTitle(scope)});modal.contentEl.createEl('code',{text:scope.root});
    let title=scope.title,applied=false;
    if(deleting)modal.contentEl.createEl('p',{text:'This removes the project and its threads from T3. The workspace folder and vault notes are kept. Unsaved project edits remain on this device.'});
    else new Setting(modal.contentEl).setName('Project name').addText(input=>input.setValue(title).onChange(value=>{title=value;confirm.setDisabled(!title.trim()||title.trim()===scope.title);}));
    const error=modal.contentEl.createEl('p',{attr:{role:'status'}});let confirm:any;
    new Setting(modal.contentEl).addButton(button=>button.setButtonText('Cancel').onClick(()=>modal.close())).addButton(button=>{
      confirm=button;button.setButtonText(deleting?'Delete project':'Rename');if(deleting)button.setWarning();else button.setCta().setDisabled(true);
      button.onClick(async()=>{button.setDisabled(true);error.setText('');try{
        if(!applied&&!this.allowed(scope))throw Error('This project is no longer linked to the vault.');
        if(!applied){
          if(deleting)await this.io.deleteProject!(scope);else await this.io.renameProject!(scope,title.trim());
          const change=deleting?{deleted:true}:{title:title.trim()};
          const pending=this.local('project-changes')??[];pending.push({id:crypto.randomUUID(),scope,change});this.local('project-changes',pending);applied=true;
        }
        await this.reconcileProjectChanges();modal.close();this.renderViews();this.app.workspace.iterateAllLeaves?.(leaf=>this.nativeChrome(leaf.view));
      }catch(failure){error.setText(failure instanceof Error?failure.message:String(failure));if(applied)button.setButtonText('Retry folder link update');button.setDisabled(false);}});
    });modal.open();return modal;
  }
  private async reconcileProjectChanges(){
    if(!this.storage?.projectChanged)return;
    if(this.projectReconciliation)return this.projectReconciliation;
    const work=(async()=>{
      while(!this.stopped){
        const pending=this.local('project-changes')??[],first=pending[0];if(!first)return;
        if(!first.id){first.id=crypto.randomUUID();this.local('project-changes',pending);}
        await this.storage!.projectChanged!(first.scope,first.change);
        // Another confirmed action may have appended while persistence waited.
        // Remove this exact record from the current queue, never an old snapshot.
        this.local('project-changes',(this.local('project-changes')??[]).filter((entry:any)=>entry.id!==first.id));
      }
    })();this.projectReconciliation=work;
    try{await work;}finally{if(this.projectReconciliation===work)this.projectReconciliation=undefined;}
  }

  menu(item:RegisteredFile,event:MouseEvent){const menu=new Menu(),link=projectMarkdownLink(item.scope,item.path,item.file.name);menu.addItem(entry=>entry.setTitle('Open in new tab').setIcon('file').onClick(()=>{void this.open(item,this.app.workspace.getLeaf('tab')).catch(error=>new Notice(error.message));}));menu.addItem(entry=>entry.setTitle('Copy link').setIcon('link').onClick(()=>{void navigator.clipboard.writeText(link);}));menu.addItem(entry=>entry.setTitle('Insert link').setIcon('link').onClick(()=>{const view=this.app.workspace.getActiveViewOfType(MarkdownView);if(view?.file){view.editor.replaceSelection(link);this.remember(item.file,view.file.path);}}));menu.showAtMouseEvent(event);}
  async show(active=true){let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getLeftLeaf(false)!;await leaf.setViewState({type:VIEW,active});}if(active)await this.app.workspace.revealLeaf(leaf);}
  attach(view:CodebaseView){this.views.add(view);}detach(view:CodebaseView){this.views.delete(view);}
  refresh(force=true):Promise<void>{
    if(this.stopped)return Promise.resolve();if(this.refreshing)return this.refreshing;
    const work=(async()=>{
      await Promise.all([...this.views].filter(view=>force||view.visible()).map(view=>view.refresh(force)));
      const groups=new Map<RegisteredFile,MarkdownView[]>();
      for(const leaf of this.editorLeaves()){const view=leaf.view as MarkdownView,item=view.file?this.files.get(view.file.path):undefined;if(item){const views=groups.get(item)??[];views.push(view);groups.set(item,views);}}
      await Promise.all([...groups].map(async([item,views])=>{
        this.captureBases(item);const base=item.document.base,bases=views.map(view=>this.viewBase(view,item));
        const clean=()=>views.every((view,index)=>view.file?.path===item.file.path&&!(view as MarkdownView&{saving?:unknown}).saving&&bases[index]&&this.viewBase(view,item)===bases[index]&&this.viewText(view)===bases[index]!.text);
        if(base===undefined||this.drafts[item.file.path]!==undefined||!clean())return;
        try{const text=await this.io.read(item.scope,item.path);if(this.stopped||this.drafts[item.file.path]!==undefined||item.document.base!==base||!clean())return;
          item.document.base=text;item.text=text;this.synchronizePeers(item,base,text);
        }catch{/* Keep both the native editors and cached tree when offline. */}
      }));
    })();this.refreshing=work;void work.finally(()=>{if(this.refreshing===work)this.refreshing=undefined;}).catch(()=>{});return work;
  }
  dispose(){this.stopped=true;this.languageViews.dispose();for(const observer of this.chrome.values())observer.disconnect();this.chrome.clear();clearTimeout(this.browseTimer);if(this.persistTimer){clearTimeout(this.persistTimer);void this.persist().catch(()=>{});}this.browse.flush();this.browse.dispose();void this.io.dispose?.();this.app.workspace.iterateAllLeaves?.(leaf=>{const view=leaf.view as MarkdownView,item=view.file?this.files.get(view.file.path):undefined;if(item){const text=this.viewText(view);if(text!==undefined&&text!==item.document.base&&text!==this.viewBase(view,item)?.text)this.retain(item.file.path,text);leaf.detach();}});for(const undo of this.undo.reverse())undo();}
}

class CodebaseLinkSuggest extends EditorSuggest<TFile> {
  constructor(app:App,private bridge:CodebaseBridge){super(app);}
  onTrigger(cursor:EditorPosition,editor:Editor,file:TFile|null){if(!file||!this.bridge.scopes().length)return null;const line=editor.getLine(cursor.line).slice(0,cursor.ch),match=/\[\[([^\]\n#|]*)$/.exec(line);if(!match)return null;return {start:{line:cursor.line,ch:cursor.ch-match[1].length},end:cursor,query:match[1]};}
  async getSuggestions(context:EditorSuggestContext){const project=await this.bridge.suggestions(context.query,context.file.path),physical=this.app.vault.getFiles().filter(f=>f.name.toLowerCase().includes(context.query.toLowerCase())).slice(0,100);return [...physical,...project.map(p=>p.file)];}
  renderSuggestion(file:TFile,el:HTMLElement){el.createDiv({text:file.name});if(file.path.startsWith(CODEBASE_PREFIX))el.createDiv({text:this.bridge.label(file),cls:'suggestion-note'});}
  selectSuggestion(file:TFile){const context=this.context;if(!context)return;this.bridge.remember(file,context.file.path);const text=file.path.startsWith(CODEBASE_PREFIX)?file.name:this.app.metadataCache.fileToLinktext(file,context.file.path);const line=context.editor.getLine(context.end.line),end=line.slice(context.end.ch).startsWith(']]')?{line:context.end.line,ch:context.end.ch+2}:context.end;context.editor.replaceRange(text+']]',context.start,end);this.close();}
}
