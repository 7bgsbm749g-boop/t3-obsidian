import {Modal,type App,MarkdownView,setIcon,type EventRef} from 'obsidian';

const panels=new WeakMap<App,Set<NoteTabPanel>>();

/** Native Obsidian controls in an overlay owned by one note tab. Other tabs
 * remain usable. A non-note workspace keeps Obsidian's standard modal. */
export class NoteTabPanel extends Modal {
  private panelHost?:HTMLElement;
  private panelView?:MarkdownView;
  private previousFocus?:HTMLElement;
  private leafEvent?:EventRef;
  private fileEvent?:EventRef;
  private layoutEvent?:EventRef;
  private openedPath?:string;
  private keydown?: (event:KeyboardEvent)=>void;
  private viewportChanged?:()=>void;
  private presentation:'closed'|'panel'|'modal'='closed';
  private minimized=false;
  private concealed=false;
  private launcher?:HTMLButtonElement;
  private tools?:HTMLElement;
  constructor(app:App,private notePath?:string,private panelKind='composer'){super(app);}
  private updateVisibility(){
    const active=this.app.workspace.getActiveViewOfType(MarkdownView)===this.panelView;
    this.modalEl.hidden=!active||this.concealed||this.minimized;
    if(this.launcher)this.launcher.hidden=!active||this.concealed||!this.minimized;
  }
  toggleHidden(){this.concealed=!this.concealed;this.updateVisibility();}
  toggleMinimized(){
    this.minimized=!this.minimized;this.concealed=false;this.updateVisibility();
    if(this.minimized)this.launcher?.focus({preventScroll:true});
    else this.modalEl.querySelector<HTMLElement>('textarea,input,button')?.focus({preventScroll:true});
  }
  isActive(){return this.app.workspace.getActiveViewOfType(MarkdownView)===this.panelView;}
  private installTools(host:HTMLElement){
    this.tools=this.modalEl.createDiv({cls:'t3-floating-tools'});
    for(const [label,icon,action] of [
      ['Minimize panel','minus',()=>this.toggleMinimized()],
      ['Hide panel','eye-off',()=>this.toggleHidden()],
    ] as const){const button=this.tools.createEl('button',{cls:'clickable-icon',attr:{'aria-label':label,title:label}});setIcon(button,icon);button.addEventListener('click',action);}
    this.launcher=host.createEl('button',{cls:'t3-floating-launcher',attr:{'aria-label':`Restore ${this.titleEl.textContent||'T3 Code'}`,title:`Restore ${this.titleEl.textContent||'T3 Code'}`}});
    this.launcher.dataset.panel=this.panelKind;setIcon(this.launcher,this.panelKind==='workspace'?'git-branch':this.panelKind==='pull-requests'?'git-pull-request':'message-circle');
    this.launcher.addEventListener('click',()=>this.toggleMinimized());this.updateVisibility();
  }
  open(){
    if(this.panelHost){void this.onOpen();this.updateVisibility();return;}
    const leaves=this.app.workspace?.getLeavesOfType?.('markdown')??[];
    const active=this.app.workspace?.getActiveViewOfType?.(MarkdownView)??undefined;
    const view=(active&&(!this.notePath||active.file?.path===this.notePath)?active:leaves.map(leaf=>leaf.view as MarkdownView).find(view=>view.file?.path===this.notePath));
    const host=view?.containerEl;
    if(!host?.isConnected||!this.modalEl?.classList){this.presentation='modal';super.open();return;}
    let group=panels.get(this.app);if(!group){group=new Set();panels.set(this.app,group);}
    for(const panel of group)if(panel.panelKind===this.panelKind&&panel.panelView===view)panel.close(false);group.add(this);
    this.presentation='panel';this.panelHost=host;this.panelView=view;this.openedPath=view?.file?.path;
    const doc=host.ownerDocument;
    this.previousFocus=doc.activeElement instanceof (doc.defaultView?.HTMLElement??HTMLElement)?doc.activeElement:undefined;
    host.classList.add('send-to-t3-panel-host');this.modalEl.classList.add('send-to-t3-tab-panel');
    this.modalEl.setAttribute('role','dialog');this.modalEl.setAttribute('aria-modal','false');
    host.appendChild(this.modalEl);
    this.keydown=event=>{if(event.key==='Escape'&&this.modalEl.contains(event.target as Node)){event.preventDefault();event.stopPropagation();this.close();}};
    doc.addEventListener('keydown',this.keydown,true);
    this.leafEvent=this.app.workspace.on('active-leaf-change',()=>this.updateVisibility());
    this.layoutEvent=this.app.workspace.on('layout-change',()=>{if(!this.panelHost?.isConnected)this.close(false);});
    this.fileEvent=this.app.workspace.on('file-open',()=>{if(this.panelView?.file?.path!==this.openedPath)this.close(false);});
    this.viewportChanged=()=>{const height=doc.defaultView?.visualViewport?.height;if(height)this.modalEl.style.setProperty('--t3-panel-viewport-height',`${Math.max(120,height*0.75)}px`);};
    doc.defaultView?.visualViewport?.addEventListener('resize',this.viewportChanged);this.viewportChanged();
    void this.onOpen();this.installTools(host);
    this.modalEl.setAttribute('aria-label',this.titleEl?.textContent||this.contentEl.querySelector('h2')?.textContent||'T3 Code');
    this.modalEl.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),button:not(:disabled):not([hidden])')?.focus({preventScroll:true});
  }
  close(restoreFocus=true){
    if(this.presentation==='closed')return;
    this.presentation='closed';const host=this.panelHost;if(!host){super.close();return;}
    const focus=restoreFocus&&this.app.workspace.getActiveViewOfType(MarkdownView)===this.panelView&&this.panelView?.file?.path===this.openedPath;
    this.panelHost=undefined;this.panelView=undefined;
    panels.get(this.app)?.delete(this);
    if(this.keydown)host.ownerDocument.removeEventListener('keydown',this.keydown,true);
    if(this.viewportChanged)host.ownerDocument.defaultView?.visualViewport?.removeEventListener('resize',this.viewportChanged);
    if(this.leafEvent)this.app.workspace.offref(this.leafEvent);
    if(this.fileEvent)this.app.workspace.offref(this.fileEvent);
    if(this.layoutEvent)this.app.workspace.offref(this.layoutEvent);this.layoutEvent=undefined;
    this.leafEvent=undefined;this.fileEvent=undefined;this.openedPath=undefined;this.modalEl.remove();this.modalEl.classList.remove('send-to-t3-tab-panel');host.classList.remove('send-to-t3-panel-host');
    this.tools?.remove();this.tools=undefined;this.launcher?.remove();this.launcher=undefined;this.minimized=false;this.concealed=false;this.modalEl.hidden=false;
    if([...panels.get(this.app)??[]].some(panel=>panel.panelHost===host))host.classList.add('send-to-t3-panel-host');
    this.onClose();
    if(focus&&this.previousFocus?.isConnected)this.previousFocus.focus({preventScroll:true});
    this.previousFocus=undefined;
  }
}

export function closeNoteTabPanel(app:App){for(const panel of [...panels.get(app)??[]])panel.close(false);}

export function toggleNoteTabPanels(app:App){for(const panel of panels.get(app)??[])if(panel.isActive())panel.toggleHidden();}
export function minimizeNoteTabPanels(app:App){for(const panel of panels.get(app)??[])if(panel.isActive())panel.toggleMinimized();}
