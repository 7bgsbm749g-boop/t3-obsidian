import {parseHTML} from 'linkedom';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
const compiled=build({entryPoints:['src/notes/note-inbox-view.ts','src/notes/native-inbox-tree.ts','src/projects/folder-indicator.ts'],bundle:true,platform:'browser',format:'cjs',outdir:'fixture',write:false});
export async function nativeInboxFixture(saved?:unknown){
 const {document,window}=parseHTML('<html><body><div class="workspace-tab-header-container"><div class="workspace-tab-header is-active" data-type="file-explorer"></div><div class="workspace-tab-header" data-type="t3-codebase"></div></div><div data-type="file-explorer" class="workspace-leaf-content"><div class="nav-header"><div class="nav-buttons-container"><button>Native button</button></div></div><div class="nav-files-container"></div></div></body></html>');
 const proto=window.HTMLElement.prototype as any;
 proto.createEl=function(tag:string,options:any={}){const el=document.createElement(tag);el.textContent=options.text??'';el.className=options.cls??'';for(const [key,value] of Object.entries(options.attr??{}))el.setAttribute(key,String(value));this.appendChild(el);return el;};
 proto.setCssProps=function(props:Record<string,string>){for(const [key,value] of Object.entries(props))this.style.setProperty(key,value);};
 proto.createDiv=function(options:any){return this.createEl('div',options);};proto.createSpan=function(options:any){return this.createEl('span',options);};
 const frames=new Map<number,Function>();let serial=0;window.requestAnimationFrame=(fn:Function)=>{frames.set(++serial,fn);return serial;};window.cancelAnimationFrame=(id:number)=>frames.delete(id);
 class TFile {parent:any;constructor(public path:string){this.parent={path:'Docs'};}}
 const opened:string[]=[],dragged:string[]=[],changes:any[]=[],notices:string[]=[],handlers=new Map<string,Function>();let disconnected=0,sorts=0,foldSaves=0,foldRequests=0,foldCancels=0;
 const root=document.querySelector<HTMLElement>('.workspace-leaf-content[data-type=file-explorer]')!,treeEl=root.querySelector<HTMLElement>('.nav-files-container')!;
 class FileItem {
  el:any;selfEl:any;info={height:25,hidden:false,computed:true};parent:any;selectable=true;rendered=true;
  constructor(public file:any){this.el=document.createElement('div');this.el.className='nav-file tree-item';this.selfEl=this.el.createDiv({cls:'nav-file-title tree-item-self is-clickable',attr:{'data-path':file.path,draggable:'true'}});this.selfEl.createSpan({cls:'native-plugin-icon',text:'native icon'});this.selfEl.createSpan({cls:'nav-file-title-content',text:file.path.split('/').at(-1)!.slice(0,-3)});this.selfEl.addEventListener('click',()=>opened.push(this.file.path));this.selfEl.addEventListener('dragstart',()=>dragged.push(this.file.path));}
  onRender(){}getTitle(){return this.file.path;}
 }
 const makeChildren=(owner:any)=>({children:[] as any[],setChildren(children:any[]){this.children=children;for(const child of children)child.parent=owner;}});
 const folder:any={file:{path:'Docs',parent:{path:'/'}},el:document.createElement('div'),selfEl:document.createElement('div'),collapsed:true,info:{height:25},selectable:true};folder.el.className='nav-folder is-collapsed';folder.selfEl.className='nav-folder-title';folder.selfEl.textContent='Docs';folder.el.appendChild(folder.selfEl);folder.childrenEl=folder.el.createDiv({cls:'nav-folder-children'});folder.vChildren=makeChildren(folder);
 const nativeRoot:any={file:{path:'/'},el:document.createElement('div'),selfEl:document.createElement('div'),info:{height:0},selectable:false};nativeRoot.el.className='nav-folder mod-root';nativeRoot.childrenEl=nativeRoot.el.createDiv({cls:'nav-folder-children'});nativeRoot.vChildren=makeChildren(nativeRoot);treeEl.appendChild(nativeRoot.el);
 const fileItems:any={Docs:folder},rows=new Map<string,any>();
 for(const name of ['Pinned','Working','Regular','Snoozed','Settled','Unbound']){const file=new TFile(`Docs/${name}.md`),item=new FileItem(file);fileItems[file.path]=item;rows.set(file.path,{row:item.el,title:item.selfEl,item});}
 const view:any={containerEl:root,fileItems,getNodeId:(item:any)=>item.file.path,isItem:(item:any)=>item instanceof FileItem||item===folder,
  getSortedFolderItems:(file:any)=>file.path==='/'?[folder]:file.path==='Docs'?[...rows.values()].map(row=>row.item).filter(item=>fileItems[item.file.path]===item):[],
  sort(){sorts++;folder.vChildren.setChildren(this.getSortedFolderItems(folder.file));nativeRoot.vChildren.setChildren(this.getSortedFolderItems(nativeRoot.file));this.render();},
  render(){folder.childrenEl.replaceChildren(...folder.vChildren.children.map((item:any)=>item.el));nativeRoot.childrenEl.replaceChildren(...nativeRoot.vChildren.children.map((item:any)=>item.el));},
  tree:{root:nativeRoot,saveFolds(){foldSaves++;},requestSaveFolds:Object.assign(()=>{foldRequests++;},{cancel:()=>{foldCancels++;},run:()=>{foldRequests++;}}),selectedDoms:new Set(),focusedItem:null,clearSelectedDoms(){this.selectedDoms.clear();},deselectItem(item:any){this.selectedDoms.delete(item);},infinityScroll:{invalidateAll(){view.render();}}}};
 view.sort();
 const tabs=document.querySelector<HTMLElement>('.workspace-tab-header-container')!,fileTab=tabs.querySelector<HTMLElement>('[data-type=file-explorer]')!,codebaseTab=tabs.querySelector<HTMLElement>('[data-type=t3-codebase]')!,leaf={view,tabHeaderEl:fileTab};
 let leaves:any[]=[leaf];let revealed=0;
 const activate=(tab:HTMLElement)=>{fileTab.classList.toggle('is-active',tab===fileTab);codebaseTab.classList.toggle('is-active',tab===codebaseTab);};fileTab.addEventListener('click',()=>activate(fileTab));codebaseTab.addEventListener('click',()=>activate(codebaseTab));
 const app:any={workspace:{getLeavesOfType:(type:string)=>type==='file-explorer'?leaves:type==='t3-codebase'?[{tabHeaderEl:codebaseTab}]:[],revealLeaf:async()=>{revealed++;activate(fileTab);},on:(name:string,fn:Function)=>{handlers.set(name,fn);return {name};},offref:(ref:any)=>{handlers.delete(ref.name);disconnected++;}},vault:{}};
 const files=await compiled,load=(name:string)=>{const module={exports:{} as any};runInNewContext(files.outputFiles.find(file=>file.path.endsWith(name+'.js'))!.text,{module,exports:module.exports,require:()=>({TFile,setIcon:(element:any,icon:string)=>element.setAttribute('data-icon',icon),Notice:class {constructor(text:string){notices.push(text);}}}),console,setTimeout,clearTimeout,Date,document,window,MutationObserver:name==='folder-indicator'?window.MutationObserver:class {observe(){}disconnect(){}}});return module.exports;};
 const ui=load('note-inbox-view'),native=load('native-inbox-tree');
 const make=(path:string,section='regular',extra:any={})=>({path,ids:[path],title:path.split('/').at(-1)!.slice(0,-3),folder:'Docs',activity:'a',updatedAt:1,section,pinned:section==='pinned',indicator:{active:0,input:0,total:1,complete:section==='regular'?1:0},...extra});
 let notes:any[]=[make('Docs/Pinned.md','pinned'),make('Docs/Working.md','working',{indicator:{active:1,input:0,total:1,complete:0}}),make('Docs/Regular.md'),make('Docs/Snoozed.md','snoozed',{until:Date.now()+60_000}),make('Docs/Settled.md','settled')],state=ui.loadInboxViewState(saved);
 const host={notes:()=>notes,change:async(note:any,action:any)=>{changes.push({note,action});},state:()=>state,saveState:(next:any)=>{state=next;}};
 const controller=new ui.NoteInboxView(app,host);controller.refresh();
 const indicators=(changed:()=>void)=>load('folder-indicator').installFolderIndicators(root,()=>[],()=>new Map(),()=>undefined,changed);
 const menu=(path:string,source='file-explorer-context-menu')=>{const items:any[]=[{title:'Rename'},{title:'Delete'}],result:any={addSeparator:()=>{},addItem:(fn:Function)=>{const item:any={};for(const name of ['setTitle','setIcon','setDisabled','onClick'])item[name]=(value:any)=>{item[name==='onClick'?'click':name.slice(3).toLowerCase()]=value;return item;};fn(item);items.push(item);}};handlers.get('file-menu')!(result,new TFile(path),source);return items;};
 const toggle=()=>tabs.querySelector<HTMLButtonElement>('.t3-note-inbox-toggle')!.click();
 const projected=()=>Array.from(nativeRoot.vChildren.children) as any[];
 const visibleFiles=()=>projected().filter((item:any)=>view.isItem(item)).map((item:any)=>item.file.path);
 const selectRange=(from:string,to:string)=>{const list=projected().filter((item:any)=>view.isItem(item)),a=list.findIndex((item:any)=>item.file.path===from),b=list.findIndex((item:any)=>item.file.path===to);for(const item of list.slice(Math.min(a,b),Math.max(a,b)+1))view.tree.selectedDoms.add(item);return [...view.tree.selectedDoms].map((item:any)=>item.file.path);};
 return {controller,indicators,ui,native,app,view,host,document,window,root,tabs,fileTab,codebaseTab,revealed:()=>revealed,opened,dragged,changes,notices,rows,folder,nativeRoot,menu,toggle,projected,visibleFiles,selectRange,state:()=>state,setNotes:(value:any[])=>{notes=value;},setLeaves:(value:any[])=>{leaves=value;},sorts:()=>sorts,folds:()=>({saves:foldSaves,requests:foldRequests,cancels:foldCancels}),disconnected:()=>disconnected};
}
