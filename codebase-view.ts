import {ItemView,Notice,setIcon,type WorkspaceLeaf} from 'obsidian';
import {folderKey} from './codebase-cache';
import type {CodebaseScope} from './codebase-core';
import type {CodebaseBridge} from './codebase-native';
export const CODEBASE_VIEW='t3-codebase';
interface Row {key:string;scope:CodebaseScope;path:string;folder:boolean;node:HTMLElement;self:HTMLElement;inner:HTMLElement;children?:HTMLElement;arrow?:HTMLElement;status?:HTMLElement;parent?:Row;childKeys?:string[];snapshot?:unknown;worktrees?:unknown}
/** Keyed native explorer rows: network work never clears the visible tree. */
export class CodebaseView extends ItemView {
  private expanded:Set<string>;
  private rows=new Map<string,Row>();
  private dirty=new Set<string>();
  private elements=new WeakMap<HTMLElement,Row>();
  private tree?:HTMLElement;
  private empty?:HTMLElement;
  private selected?:Row;
  private closed=false;
  private refreshing?:Promise<void>;
  readonly timings:Array<{operation:string;milliseconds:number}>=[];
  constructor(leaf:WorkspaceLeaf,private bridge:CodebaseBridge){super(leaf);const saved=bridge.local('expanded');this.expanded=new Set(Array.isArray(saved)?saved:[]);}
  getViewType(){return CODEBASE_VIEW;}getDisplayText(){return 'Codebase view';}getIcon(){return 'code-xml';}
  async onOpen(){this.bridge.attach(this);this.setup();this.render();void this.refresh();}
  async onClose(){this.closed=true;this.bridge.detach(this);}
  visible(){return this.containerEl?.offsetWidth!==0&&this.containerEl?.offsetHeight!==0;}
  private setup(){if(this.tree)return;this.contentEl.addClass('nav-files-container','t3-codebase-explorer');this.contentEl.setAttribute('role','tree');this.contentEl.setAttribute('aria-label','Codebase view');const header=this.contentEl.createDiv({cls:'nav-header'}),actions=header.createDiv({cls:'nav-buttons-container'});for(const [icon,label,action] of [['refresh-cw','Refresh folders',()=>void this.refresh(true)],['chevrons-up-down','Collapse all',()=>{this.expanded.clear();if(this.selected){let row=this.selected;while(row.parent)row=row.parent;this.select(row);}this.saveExpansion();this.invalidate();this.render();}]] as const){const button=actions.createDiv({cls:'clickable-icon nav-action-button',attr:{'aria-label':label,role:'button',tabindex:'0'}});setIcon(button,icon);button.onclick=action;button.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();action();}};}this.tree=this.contentEl.createDiv({cls:'nav-folder mod-root'});this.empty=this.contentEl.createDiv({cls:'t3-codebase-message',text:'Link a vault folder to a T3 project to see its files here.'});}
  invalidate(key?:string){if(!key){for(const row of this.rows.values())this.dirty.add(row.key);return;}let row=this.rows.get('folder:'+key.replace(/^workspaces:/,''));while(row){this.dirty.add(row.key);row=row.parent;}}
  private markSeen(row:Row,seen:Set<string>){for(const key of row.childKeys??[]){seen.add(key);const child=this.rows.get(key);if(child)this.markSeen(child,seen);}}
  render(){if(this.closed)return;this.setup();const start=performance.now(),seen=new Set<string>();const scopes=this.bridge.scopes();this.empty!.hidden=!!scopes.length;this.reconcile(scopes.map(scope=>({scope,path:'',folder:true})),this.tree!,undefined,seen);for(const [key,row] of this.rows)if(!seen.has(key)){row.node.remove();this.rows.delete(key);if(this.selected===row)this.selected=undefined;}this.timings.push({operation:'render',milliseconds:performance.now()-start});if(this.timings.length>100)this.timings.shift();}
  private reconcile(items:Array<{scope:CodebaseScope;path:string;folder:boolean}>,parent:HTMLElement,parentRow:Row|undefined,seen:Set<string>){let previous:HTMLElement|undefined;for(const item of items){const key=(item.folder?'folder:':'file:')+folderKey(item.scope,item.path);seen.add(key);let row=this.rows.get(key);if(!row){const node=parent.createDiv({cls:item.folder?'nav-folder':'nav-file'}),self=node.createDiv({cls:`${item.folder?'nav-folder-title':'nav-file-title'} tree-item-self`,attr:{role:'treeitem',tabindex:'-1'}}),arrow=item.folder?self.createDiv({cls:'tree-item-icon collapse-icon'}):undefined;if(arrow)setIcon(arrow,'chevron-right');const inner=self.createDiv({cls:`${item.folder?'nav-folder-title-content':'nav-file-title-content'} tree-item-inner`}),children=item.folder?node.createDiv({cls:'nav-folder-children tree-item-children',attr:{role:'group'}}):undefined;row={...item,key,node,self,inner,arrow,children};this.rows.set(key,row);this.elements.set(self,row);self.onclick=event=>{this.select(row!);if(row!.folder)this.toggle(row!);else{const file=this.bridge.register(row!.scope,row!.path);void this.bridge.open(file,event.ctrlKey||event.metaKey?this.bridge.app.workspace.getLeaf('tab'):undefined).catch(error=>new Notice(error.message,10000));}};self.onkeydown=event=>this.keydown(event,row!);self.oncontextmenu=event=>{if(row!.folder)return;event.preventDefault();this.bridge.menu(this.bridge.register(row!.scope,row!.path),event);};}
      row.parent=parentRow;row.scope=item.scope;const name=item.path?item.path.split('/').at(-1)!:item.scope.title,label=!item.folder&&name.endsWith('.md')?name.slice(0,-3):name;if(row.inner.textContent!==label)row.inner.setText(label);row.self.setAttribute('title',item.path||item.scope.root);row.self.setAttribute('aria-level',String(this.depth(row)));row.self.tabIndex=this.selected===row?0:this.selected||parentRow||previous?-1:0;
      // Insert only changed/new positions. Existing nodes and focus remain intact.
      const expected=previous?previous.nextSibling:parent.firstChild;if(expected!==row.node)parent.insertBefore(row.node,expected);previous=row.node;
      if(!item.folder){this.bridge.register(item.scope,item.path);continue;}
      const expanded=this.expanded.has(folderKey(item.scope,item.path));row.node.toggleClass('is-collapsed',!expanded);row.arrow!.toggleClass('is-collapsed',!expanded);row.self.setAttribute('aria-expanded',String(expanded));row.children!.hidden=!expanded;
      const snapshot=this.bridge.browse.get(item.scope,item.path),entries=snapshot?.entries??[];
      const worktrees=!item.path&&!item.scope.threadId?this.bridge.browse.workspaces(item.scope):undefined;
      if(row.childKeys&&row.snapshot===snapshot&&row.worktrees===worktrees&&!this.dirty.has(key)){this.markSeen(row,seen);continue;}
      row.snapshot=snapshot;row.worktrees=worktrees;this.dirty.delete(key);
      const childItems=[...(worktrees?.map(scope=>({scope,path:'',folder:true}))??[]),...entries.slice().sort((a,b)=>a.kind.localeCompare(b.kind)||a.path.localeCompare(b.path)).map(entry=>({scope:item.scope,path:entry.path,folder:entry.kind==='directory'}))];
      // Keep collapsed cached branches in the DOM too, so reopen needs no reconstruction.
      this.reconcile(childItems,row.children!,row,seen);row.childKeys=childItems.map(child=>(child.folder?'folder:':'file:')+folderKey(child.scope,child.path));
      const error=this.bridge.browse.errors.get(folderKey(item.scope,item.path)),loading=this.bridge.browse.loading(item.scope,item.path);row.self.setAttribute('aria-busy',String(loading));const status=expanded&&!snapshot?(error??(loading?'Loading…':'Folder is empty')):expanded&&error?'Offline · showing saved files':undefined;
      if(status){row.status??=row.children!.createDiv({cls:'t3-codebase-message',attr:{role:'status'}});row.status.setText(status);row.status.setAttribute('title',error??'');}else{row.status?.remove();row.status=undefined;}
    }}
  private depth(row:Row):number{return row.parent?this.depth(row.parent)+1:1;}
  private saveExpansion(){this.bridge.local('expanded',[...this.expanded]);}
  private select(row:Row){this.selected?.self.removeClass('is-active');if(this.selected)this.selected.self.tabIndex=-1;this.selected=row;row.self.addClass('is-active');row.self.tabIndex=0;}
  private toggle(row:Row,expand=!this.expanded.has(folderKey(row.scope,row.path))){const key=folderKey(row.scope,row.path);if(expand)this.expanded.add(key);else this.expanded.delete(key);this.saveExpansion();this.invalidate(folderKey(row.scope,row.path));const start=performance.now();this.render();this.timings.push({operation:'reveal',milliseconds:performance.now()-start});if(expand)void this.refresh();}
  private visibleRows(){return Array.from(this.tree!.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter(el=>{const row=this.elements.get(el);return row&&this.visibleRow(row);});}
  private keydown(event:KeyboardEvent,row:Row){const visible=this.visibleRows(),index=visible.indexOf(row.self);let target:HTMLElement|undefined;if(event.key==='ArrowDown')target=visible[index+1];else if(event.key==='ArrowUp')target=visible[index-1];else if(event.key==='Home')target=visible[0];else if(event.key==='End')target=visible.at(-1);else if(event.key==='ArrowRight'&&row.folder){if(!this.expanded.has(folderKey(row.scope,row.path)))this.toggle(row,true);else if(this.elements.get(visible[index+1])?.parent===row)target=visible[index+1];}else if(event.key==='ArrowLeft'){if(row.folder&&this.expanded.has(folderKey(row.scope,row.path)))this.toggle(row,false);else target=row.parent?.self;}else if(event.key==='Enter'||event.key===' '){row.self.click();}else return;event.preventDefault();if(target){const next=this.elements.get(target);if(next)this.select(next);target.focus();}}
  private visibleRow(row:Row){let parent=row.parent;while(parent){if(!this.expanded.has(folderKey(parent.scope,parent.path)))return false;parent=parent.parent;}return true;}
  refresh(force=false):Promise<void>{if(this.closed)return Promise.resolve();if(this.refreshing)return this.refreshing;this.render();const work=(async()=>{const attempted=new Set<string>();while(!this.closed){const jobs:Promise<void>[]=[];for(const row of this.rows.values())if(row.folder&&this.visibleRow(row)&&this.expanded.has(folderKey(row.scope,row.path))&&!attempted.has(row.key)){attempted.add(row.key);jobs.push(this.bridge.browse.load(row.scope,row.path,force));if(!row.path&&!row.scope.threadId)jobs.push(this.bridge.browse.loadWorkspaces(row.scope,force));}if(!jobs.length)break;await Promise.all(jobs);if(!this.closed)this.render();}})();this.refreshing=work;void work.finally(()=>{if(this.refreshing===work)this.refreshing=undefined;}).catch(()=>{});return work;}
}
