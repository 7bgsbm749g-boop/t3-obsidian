import {Notice,TFile,setIcon,type App,type EventRef,type Menu,type WorkspaceLeaf} from 'obsidian';
import {NativeInboxTree,nativeExplorerTree,type NativeExplorerTree,type NativeTreeItem} from './native-inbox-tree';
import {NoteInboxDrag} from './note-inbox-drag';
import {INBOX_SECTIONS,type InboxAction,type InboxNote,type InboxSection} from './note-inbox';

const SHELVES=['working','snoozed','settled'] as const;
type Shelf=typeof SHELVES[number];
const labels:Record<Shelf,string>={working:'Working',snoozed:'Snoozed',settled:'Settled'};
// T3 Code's wordmark, MIT © 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.
const T3_PATH='M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z';
export interface InboxViewState {enabled:boolean;collapsed:InboxSection[]}
export function loadInboxViewState(value:unknown):InboxViewState {
  const raw=value as Partial<InboxViewState>|null;
  return {enabled:raw?.enabled===true,collapsed:Array.isArray(raw?.collapsed)?SHELVES.filter(section=>raw.collapsed?.includes(section)):[...SHELVES]};
}
export interface InboxHost {notes():InboxNote[];change(note:InboxNote,action:InboxAction):Promise<void>;state():InboxViewState;saveState(state:InboxViewState):void}
interface Explorer {drag:NoteInboxDrag;root:HTMLElement;tree:HTMLElement;toolbar:HTMLElement;tab:HTMLElement;restoreFiles:()=>void;view:NativeExplorerTree;button:HTMLButtonElement;projection?:NativeInboxTree;headers:Map<Shelf,HTMLElement>;spacer?:HTMLElement;frame?:number;observer:MutationObserver}
/** The existing file explorer renders the notes and handles their interactions.
 * Only its native virtual children are filtered and grouped for this mode. */
export class NoteInboxView {
  private explorers=new Map<HTMLElement,Explorer>();private stopped=false;private scheduled=false;private wake?:number;private menuEvent:EventRef;
  constructor(private app:App,private host:InboxHost){
    this.menuEvent=app.workspace.on('file-menu',(menu,file,source)=>{
      if(!this.host.state().enabled||!(file instanceof TFile)||source!=='file-explorer-context-menu')return;
      const note=this.host.notes().find(note=>note.path===file.path);if(note)this.menu(menu,note);
    });
  }
  refresh(){
    if(this.stopped)return;
    const leaves=this.app.workspace.getLeavesOfType('file-explorer'),roots=new Set(leaves.map(leaf=>leaf.view.containerEl)),notes=this.host.notes();
    for(const [root,explorer] of this.explorers)if(!roots.has(root)||!root.contains(explorer.tree)||!explorer.toolbar.contains(explorer.button)||explorer.tab.parentElement!==explorer.toolbar){this.remove(explorer);this.explorers.delete(root);}
    for(const leaf of leaves){
      const root=leaf.view.containerEl;let explorer=this.explorers.get(root);
      if(!explorer){
        const tab=(leaf as WorkspaceLeaf&{tabHeaderEl?:HTMLElement}).tabHeaderEl,toolbar=tab?.parentElement,tree=root.querySelector<HTMLElement>('.nav-files-container'),view=nativeExplorerTree(leaf.view);
        if(!tab||!toolbar||!tree||!view||[...this.explorers.values()].some(other=>other.toolbar===toolbar))continue;
        explorer=this.mount(root,toolbar,tab,leaf,tree,view);this.explorers.set(root,explorer);
      }
      explorer.drag.refresh();this.placeButton(explorer);
      const enabled=this.host.state().enabled,selected=enabled&&explorer.tab.classList.contains('is-active');root.classList.toggle('t3-note-inbox-mode',enabled);explorer.button.classList.toggle('is-active',selected);
      this.attribute(explorer.button,'aria-pressed',String(selected));
      if(enabled){
        try{this.project(explorer,notes);}catch(error){
          // Return to the ordinary tree if the native capability changes.
          // A partially filtered tree must never retain hidden selections.
          this.host.saveState({...this.host.state(),enabled:false});
          try{this.unproject(explorer);}finally{root.classList.remove('t3-note-inbox-mode');explorer.button.classList.remove('is-active');this.attribute(explorer.button,'aria-pressed','false');this.report(error);}
        }
      }else this.unproject(explorer);
    }
    if(this.wake)window.clearTimeout(this.wake);
    const now=Date.now(),next=Math.min(...notes.flatMap(note=>note.until&&note.until>now?[note.until]:[]));
    if(Number.isFinite(next))this.wake=window.setTimeout(()=>this.refresh(),Math.min(2_147_483_647,Math.max(1,next-now+1)));
  }
  private schedule(){if(this.scheduled||this.stopped)return;this.scheduled=true;void Promise.resolve().then(()=>{this.scheduled=false;this.refresh();}).catch(error=>this.report(error));}
  private mount(root:HTMLElement,toolbar:HTMLElement,tab:HTMLElement,leaf:WorkspaceLeaf,tree:HTMLElement,view:NativeExplorerTree):Explorer {
    const button=toolbar.createEl('button',{cls:'clickable-icon t3-note-inbox-toggle',attr:{type:'button','aria-label':'T3 inbox','aria-pressed':'false',title:'T3 inbox — filter notes with T3 streams'}});
    const svg=root.ownerDocument.win.createSvg('svg');svg.setAttribute('viewBox','10 27 108 76');svg.setAttribute('aria-hidden','true');svg.classList.add('svg-icon');const path=root.ownerDocument.win.createSvg('path');path.setAttribute('d',T3_PATH);path.setAttribute('fill','currentColor');path.setAttribute('stroke','none');svg.appendChild(path);button.appendChild(svg);
    const observer=new MutationObserver(()=>this.schedule()),restoreFiles=()=>{const state=this.host.state();if(state.enabled){this.host.saveState({...state,enabled:false});this.refresh();}},drag=new NoteInboxDrag(root,tree,{enabled:()=>this.host.state().enabled,notes:()=>this.host.notes(),selected:path=>{
      const item=view.fileItems[path],selected=[...view.tree.selectedDoms];
      return selected.includes(item)?selected.flatMap(item=>item.file&&this.host.notes().some(note=>note.path===item.file?.path)?[item.file.path]:[]):[path];
    },change:async(note,action)=>{await this.host.change(note,action);this.refresh();},error:error=>this.report(error)}),explorer:Explorer={drag,root,tree,toolbar,tab,restoreFiles,view,button,headers:new Map(),observer};
    tab.addEventListener('click',restoreFiles);
    button.addEventListener('click',()=>{const state=this.host.state();this.host.saveState({...state,enabled:!tab.classList.contains('is-active')||!state.enabled});this.refresh();void this.app.workspace.revealLeaf(leaf).then(()=>this.refresh()).catch(error=>this.report(error));});
    observer.observe(tree,{childList:true,subtree:true,attributes:true,attributeFilter:['data-path']});
    observer.observe(toolbar,{childList:true});observer.observe(tab,{attributes:true,attributeFilter:['class']});
    return explorer;
  }
  private placeButton(explorer:Explorer){
    const codebase=this.app.workspace.getLeavesOfType('t3-codebase').map(leaf=>(leaf as WorkspaceLeaf&{tabHeaderEl?:HTMLElement}).tabHeaderEl).find(tab=>tab?.parentElement===explorer.toolbar);
    if(codebase&&codebase.nextSibling!==explorer.button)explorer.toolbar.insertBefore(explorer.button,codebase.nextSibling);
  }
  private attribute(element:HTMLElement,name:string,value:string){if(element.getAttribute(name)!==value)element.setAttribute(name,value);}
  private unproject(explorer:Explorer){try{explorer.projection?.dispose();}finally{explorer.projection=undefined;explorer.headers.clear();explorer.spacer=undefined;if(explorer.frame!==undefined)window.cancelAnimationFrame(explorer.frame);explorer.frame=undefined;}}
  private project(explorer:Explorer,notes:InboxNote[]){
    const projection=explorer.projection??=new NativeInboxTree(explorer.view);
    const sample=notes.map(note=>explorer.view.fileItems[note.path]).find(Boolean);
    if(!sample){projection.update([]);return;}
    const state=this.host.state(),items:NativeTreeItem[]=[],firstShelf=SHELVES.find(shelf=>notes.some(note=>note.section===shelf)||shelf==='settled');
    for(const section of INBOX_SECTIONS){
      const members=notes.filter(note=>note.section===section),shelf=SHELVES.find(shelf=>shelf===section);
      if(shelf&&(members.length||shelf==='settled')){
        if(shelf===firstShelf){
          if(!explorer.spacer){explorer.spacer=explorer.root.ownerDocument.win.createDiv({cls:'t3-note-inbox-spacer',attr:{'aria-hidden':'true'}});}
          items.push(projection.control(explorer.spacer,'t3-inbox-gap',sample));
        }
        let header=explorer.headers.get(shelf);
        if(!header){
          header=explorer.root.ownerDocument.win.createEl('button',{cls:'clickable-icon t3-note-inbox-heading',attr:{type:'button','data-t3-inbox-shelf':shelf}});
          header.createSpan({text:labels[shelf]});header.createSpan({cls:'t3-note-inbox-rule',attr:{'aria-hidden':'true'}});header.createSpan({cls:'t3-note-inbox-count'});setIcon(header.createSpan({cls:'t3-note-inbox-chevron'}),'chevron-down');
          header.addEventListener('click',event=>{event.stopPropagation();const current=this.host.state();this.host.saveState({...current,collapsed:current.collapsed.includes(shelf)?current.collapsed.filter(item=>item!==shelf):[...current.collapsed,shelf]});this.refresh();});
          explorer.headers.set(shelf,header);
        }
        this.attribute(header,'aria-expanded',String(!state.collapsed.includes(shelf)));this.attribute(header,'aria-label',`${labels[shelf]}, ${members.length} notes`);
        const count=header.querySelector<HTMLElement>('.t3-note-inbox-count')!;if(count.textContent!==String(members.length))count.textContent=String(members.length);
        items.push(projection.control(header,'t3-inbox-'+shelf,sample));
      }
      if(!shelf||!state.collapsed.includes(shelf))for(const note of members){const item=explorer.view.fileItems[note.path];if(item)items.push(item);}
    }
    projection.update(items);
    if(explorer.frame===undefined)explorer.frame=window.requestAnimationFrame(()=>{
      explorer.frame=undefined;if(this.stopped||!this.host.state().enabled||!explorer.spacer)return;
      const padding=window.getComputedStyle(explorer.tree),space=parseFloat(padding.paddingTop||'0')+parseFloat(padding.paddingBottom||'0');
      const normalHeight=sample.selfEl.getBoundingClientRect().height||25;
      const height=projection.items.filter(item=>item.el!==explorer.spacer).reduce((sum,item)=>sum+(item.info.height||(item.file?normalHeight:32)),0);
      const gap=Math.max(8,explorer.tree.clientHeight-space-height),previous=parseFloat(explorer.spacer.style.getPropertyValue('--t3-inbox-gap'))||8;
      if(Number.isFinite(gap)&&Math.abs(gap-previous)>0.5){explorer.spacer.setCssProps({'--t3-inbox-gap':gap+'px'});projection.layout();}
    });
  }
  private change(note:InboxNote,action:InboxAction){void this.host.change(note,action).then(()=>this.refresh()).catch(error=>this.report(error));}
  private report(error:unknown){new Notice(error instanceof Error?error.message:String(error));}
  private menu(menu:Menu,note:InboxNote){
    menu.addSeparator();
    menu.addItem(item=>item.setTitle(note.pinned?'Unpin note':'Pin note').setIcon(note.pinned?'pin-off':'pin').onClick(()=>this.change(note,{kind:'pin',value:!note.pinned})));
    if(note.section==='settled'||note.section==='snoozed')menu.addItem(item=>item.setTitle(note.section==='settled'?'Reopen note':'Wake note').setIcon('undo-2').onClick(()=>this.change(note,{kind:'regular'})));
    else {
      const busy=!!note.indicator.active||!!note.indicator.input;
      menu.addItem(item=>item.setTitle('Settle note').setIcon('check').setDisabled(busy).onClick(()=>this.change(note,{kind:'settled'})));
      for(const [label,delay] of [['Snooze for 1 hour',60*60_000],['Snooze until tomorrow',24*60*60_000],['Snooze for 1 week',7*24*60*60_000]] as const)menu.addItem(item=>item.setTitle(label).setIcon('alarm-clock').setDisabled(busy).onClick(()=>this.change(note,{kind:'snoozed',until:Date.now()+delay})));
    }
  }
  private remove(explorer:Explorer){explorer.drag.dispose();explorer.observer.disconnect();explorer.tab.removeEventListener('click',explorer.restoreFiles);if(explorer.frame!==undefined)window.cancelAnimationFrame(explorer.frame);try{explorer.projection?.dispose();}finally{explorer.root.classList.remove('t3-note-inbox-mode');explorer.button.remove();}}
  dispose(){if(this.stopped)return;this.stopped=true;if(this.wake)window.clearTimeout(this.wake);this.app.workspace.offref(this.menuEvent);for(const explorer of this.explorers.values())this.remove(explorer);this.explorers.clear();}
}
