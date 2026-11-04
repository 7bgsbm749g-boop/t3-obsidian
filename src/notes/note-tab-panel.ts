import {Modal,type App,type MarkdownView,type EventRef} from 'obsidian';

const panels=new WeakMap<App,NoteTabPanel>();

/** Native Obsidian controls in an overlay owned by one note tab. Other tabs
 * remain usable. A non-note workspace keeps Obsidian's standard modal. */
export class NoteTabPanel extends Modal {
  private panelHost?:HTMLElement;
  private panelView?:MarkdownView;
  private previousFocus?:HTMLElement;
  private leafEvent?:EventRef;
  private fileEvent?:EventRef;
  private openedPath?:string;
  private keydown?: (event:KeyboardEvent)=>void;
  private viewportChanged?:()=>void;
  private presentation:'closed'|'panel'|'modal'='closed';
  constructor(app:App,private notePath?:string){super(app);}
  open(){
    if(this.panelHost){this.onOpen();return;}
    const leaves=this.app.workspace?.getLeavesOfType?.('markdown')??[];
    const active=leaves.find(leaf=>leaf.view===this.app.workspace?.activeLeaf?.view)?.view as MarkdownView|undefined;
    const view=(active&&(!this.notePath||active.file?.path===this.notePath)?active:leaves.map(leaf=>leaf.view as MarkdownView).find(view=>view.file?.path===this.notePath));
    const host=view?.containerEl;
    if(!host?.isConnected||!this.modalEl?.classList){this.presentation='modal';super.open();return;}
    panels.get(this.app)?.close(false);panels.set(this.app,this);
    this.presentation='panel';this.panelHost=host;this.panelView=view;this.openedPath=view?.file?.path;
    const doc=host.ownerDocument;
    this.previousFocus=doc.activeElement instanceof (doc.defaultView?.HTMLElement??HTMLElement)?doc.activeElement as HTMLElement:undefined;
    host.classList.add('send-to-t3-panel-host');this.modalEl.classList.add('send-to-t3-tab-panel');
    this.modalEl.setAttribute('role','dialog');this.modalEl.setAttribute('aria-modal','false');
    host.appendChild(this.modalEl);
    this.keydown=event=>{if(event.key==='Escape'&&this.modalEl.contains(event.target as Node)){event.preventDefault();event.stopPropagation();this.close();}};
    doc.addEventListener('keydown',this.keydown,true);
    this.leafEvent=this.app.workspace.on('active-leaf-change',leaf=>{if(leaf?.view!==this.panelView)this.close(false);});
    this.fileEvent=this.app.workspace.on('file-open',()=>{if(this.panelView?.file?.path!==this.openedPath)this.close(false);});
    this.viewportChanged=()=>{const height=doc.defaultView?.visualViewport?.height;if(height)this.modalEl.style.setProperty('--t3-panel-viewport-height',`${Math.max(120,height*0.75)}px`);};
    doc.defaultView?.visualViewport?.addEventListener('resize',this.viewportChanged);this.viewportChanged();
    this.onOpen();
    this.modalEl.setAttribute('aria-label',this.titleEl?.textContent||this.contentEl.querySelector('h2')?.textContent||'T3 Code');
    this.modalEl.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),button:not(:disabled):not([hidden])')?.focus({preventScroll:true});
  }
  close(restoreFocus=true){
    if(this.presentation==='closed')return;
    this.presentation='closed';const host=this.panelHost;if(!host){super.close();return;}
    const focus=restoreFocus&&this.app.workspace?.activeLeaf?.view===this.panelView&&this.panelView?.file?.path===this.openedPath;
    this.panelHost=undefined;this.panelView=undefined;
    if(panels.get(this.app)===this)panels.delete(this.app);
    if(this.keydown)host.ownerDocument.removeEventListener('keydown',this.keydown,true);
    if(this.viewportChanged)host.ownerDocument.defaultView?.visualViewport?.removeEventListener('resize',this.viewportChanged);
    if(this.leafEvent)this.app.workspace.offref(this.leafEvent);
    if(this.fileEvent)this.app.workspace.offref(this.fileEvent);
    this.leafEvent=undefined;this.fileEvent=undefined;this.openedPath=undefined;this.modalEl.remove();this.modalEl.classList.remove('send-to-t3-tab-panel');host.classList.remove('send-to-t3-panel-host');
    this.onClose();
    if(focus&&this.previousFocus?.isConnected)this.previousFocus.focus({preventScroll:true});
    this.previousFocus=undefined;
  }
}

export function closeNoteTabPanel(app:App){panels.get(app)?.close(false);}
