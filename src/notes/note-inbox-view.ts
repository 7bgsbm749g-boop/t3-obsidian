import {Menu,Notice,TFile,setIcon,type App} from 'obsidian';
import {INBOX_SECTIONS,type InboxAction,type InboxNote,type InboxSection} from './note-inbox';

const labels:Record<InboxSection,string>={pinned:'Pinned',working:'Working',regular:'Inbox',snoozed:'Snoozed',settled:'Settled'};
const icons:Record<InboxSection,string>={pinned:'pin',working:'loader-circle',regular:'circle',snoozed:'alarm-clock',settled:'check'};
// T3 Code's wordmark, MIT © 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.
const T3_PATH='M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z';
export interface InboxViewState {enabled:boolean;collapsed:InboxSection[]}
export function loadInboxViewState(value:unknown):InboxViewState {
  const raw=value as Partial<InboxViewState>|null;
  return {enabled:raw?.enabled===true,collapsed:Array.isArray(raw?.collapsed)?INBOX_SECTIONS.filter(section=>raw.collapsed?.includes(section)):['snoozed','settled']};
}
export interface InboxHost {notes():InboxNote[];change(note:InboxNote,action:InboxAction):Promise<void>;state():InboxViewState;saveState(state:InboxViewState):void}
interface Explorer {root:HTMLElement;tree:HTMLElement;button:HTMLButtonElement;panel:HTMLElement;list:HTMLElement;search:HTMLInputElement;signature?:string}
/** One mode inside each native file explorer. No workspace view replacement,
 * vault scan, note rewrite, or private explorer method patch is needed. */
export class NoteInboxView {
  private explorers=new Map<HTMLElement,Explorer>();private stopped=false;private wake?:number;
  constructor(private app:App,private host:InboxHost){}
  refresh(){
    if(this.stopped)return;
    const roots=new Set(this.app.workspace.getLeavesOfType('file-explorer').map(leaf=>leaf.view.containerEl));
    for(const [root,explorer] of this.explorers)if(!roots.has(root)||!root.contains(explorer.tree)||!root.contains(explorer.button)){this.remove(explorer);this.explorers.delete(root);}
    const notes=this.host.notes();
    for(const root of roots){
      let explorer=this.explorers.get(root);
      if(!explorer){
        const toolbar=root.querySelector<HTMLElement>('.nav-buttons-container'),tree=root.querySelector<HTMLElement>('.nav-files-container');if(!toolbar||!tree)continue;
        explorer=this.mount(root,toolbar,tree);this.explorers.set(root,explorer);
      }
      const state=this.host.state();root.classList.toggle('t3-note-inbox-mode',state.enabled);explorer.button.classList.toggle('is-active',state.enabled);explorer.button.setAttribute('aria-pressed',String(state.enabled));explorer.panel.hidden=!state.enabled;
      if(state.enabled)this.render(explorer,notes);
    }
    if(this.wake)window.clearTimeout(this.wake);
    const now=Date.now(),next=Math.min(...notes.flatMap(note=>note.until&&note.until>now?[note.until]:[]));
    if(Number.isFinite(next))this.wake=window.setTimeout(()=>this.refresh(),Math.min(2_147_483_647,Math.max(1,next-Date.now()+1)));
  }
  private mount(root:HTMLElement,toolbar:HTMLElement,tree:HTMLElement):Explorer {
    const button=toolbar.createEl('button',{cls:'clickable-icon nav-action-button t3-note-inbox-toggle',attr:{type:'button','aria-label':'T3 inbox','aria-pressed':'false',title:'T3 inbox — switch file explorer mode'}});
    const svg=root.ownerDocument.win.createSvg('svg');svg.setAttribute('viewBox','10 27 108 76');svg.setAttribute('aria-hidden','true');svg.classList.add('svg-icon');const path=root.ownerDocument.win.createSvg('path');path.setAttribute('d',T3_PATH);path.setAttribute('fill','currentColor');path.setAttribute('stroke','none');svg.appendChild(path);button.appendChild(svg);
    const panel=root.createDiv({cls:'t3-note-inbox',attr:{'aria-label':'T3 note inbox'}});panel.hidden=true;
    const header=panel.createDiv({cls:'t3-note-inbox-search'});setIcon(header.createSpan(),'search');
    const search=header.createEl('input',{attr:{type:'search',placeholder:'Search notes','aria-label':'Search T3 inbox'}});
    const list=panel.createDiv({cls:'t3-note-inbox-list'}),explorer:Explorer={root,tree,button,panel,list,search};
    button.addEventListener('click',()=>{const state=this.host.state();this.host.saveState({...state,enabled:!state.enabled});this.refresh();});
    search.addEventListener('input',()=>this.render(explorer,this.host.notes()));
    return explorer;
  }
  private render(explorer:Explorer,all:InboxNote[]){
    const query=explorer.search.value.trim().toLocaleLowerCase(),notes=all.filter(note=>note.path.toLocaleLowerCase().includes(query)),state=this.host.state();
    const active=this.app.workspace.getActiveFile()?.path,signature=JSON.stringify([notes,state.collapsed,active,query]);if(signature===explorer.signature)return;explorer.signature=signature;
    const focused=explorer.list.ownerDocument.activeElement as HTMLElement|null,focusKey=focused&&explorer.list.contains(focused)?focused.dataset.inboxFocus:undefined;
    explorer.list.empty();
    if(!notes.length){explorer.list.createDiv({cls:'t3-note-inbox-empty',text:query?'No matching notes.':'No notes with T3 streams yet.'});return;}
    for(const section of INBOX_SECTIONS){
      const members=notes.filter(note=>note.section===section);if(!members.length)continue;
      const group=explorer.list.createDiv({cls:'t3-note-inbox-section',attr:{'data-inbox-section':section}}),collapsed=state.collapsed.includes(section)&&!query;
      const header=group.createEl('button',{cls:'t3-note-inbox-heading',attr:{type:'button','aria-expanded':String(!collapsed),'data-inbox-focus':'section:'+section}});
      setIcon(header.createSpan({cls:'t3-note-inbox-chevron'}),collapsed?'chevron-right':'chevron-down');header.createSpan({text:labels[section]});header.createSpan({cls:'t3-note-inbox-count',text:String(members.length)});
      header.addEventListener('click',()=>{const current=this.host.state();this.host.saveState({...current,collapsed:current.collapsed.includes(section)?current.collapsed.filter(item=>item!==section):[...current.collapsed,section]});this.refresh();});
      if(!collapsed)for(const note of members)this.row(group,note,note.path===active);
    }
    if(focusKey)Array.from(explorer.list.querySelectorAll<HTMLElement>('[data-inbox-focus]')).find(element=>element.dataset.inboxFocus===focusKey)?.focus();
  }
  private row(group:HTMLElement,note:InboxNote,active:boolean){
    const row=group.createDiv({cls:'t3-note-inbox-row'+(active?' is-active':''),attr:{'data-note-path':note.path}});
    row.addEventListener('contextmenu',event=>{event.preventDefault();this.menu(note,event);});
    const open=row.createEl('button',{cls:'t3-note-inbox-open',attr:{type:'button',title:note.path,'aria-label':'Open '+note.path,'data-inbox-focus':'open:'+note.path}});
    const status=open.createSpan({cls:'t3-note-inbox-status'});setIcon(status,note.indicator.input?'message-circle-question':note.indicator.active?'loader-circle':icons[note.section]);if(note.indicator.active)status.classList.add('is-working');
    if(note.indicator.input)status.classList.add('needs-input');
    const copy=open.createSpan({cls:'t3-note-inbox-copy'}),title=copy.createSpan({cls:'t3-note-inbox-title',text:note.title});
    if(note.indicator.active)title.setAttribute('data-t3-active-title','true');
    if(note.indicator.unread)row.setAttribute('data-t3-completion-glow','note');
    copy.createSpan({cls:'t3-note-inbox-detail',text:note.indicator.input?'Needs your input':note.section==='snoozed'?'Until '+new Date(note.until!).toLocaleString():note.folder||'Vault root'});
    open.addEventListener('click',event=>{void this.open(note,event.ctrlKey||event.metaKey).catch(error=>this.report(error));});
    const actions=row.createDiv({cls:'t3-note-inbox-actions'});
    if(!note.indicator.active&&!note.indicator.input){const settled=note.section==='settled';this.iconButton(actions,settled?'Reopen note':'Settle note',settled?'undo-2':'check',()=>this.change(note,{kind:settled?'regular':'settled'}),'settle:'+note.path);}
    this.iconButton(actions,'Note actions','ellipsis',event=>this.menu(note,event),'menu:'+note.path);
  }
  private iconButton(parent:HTMLElement,label:string,icon:string,click:(event:MouseEvent)=>void,focus:string){const button=parent.createEl('button',{cls:'clickable-icon',attr:{type:'button','aria-label':label,title:label,'data-inbox-focus':focus}});setIcon(button,icon);button.addEventListener('click',click);}
  private async open(note:InboxNote,tab=false){const file=this.app.vault.getAbstractFileByPath(note.path);if(!(file instanceof TFile)){this.refresh();return;}await this.app.workspace.getLeaf(tab?'tab':false).openFile(file);}
  private change(note:InboxNote,action:InboxAction){void this.host.change(note,action).then(()=>this.refresh()).catch(error=>this.report(error));}
  private report(error:unknown){new Notice(error instanceof Error?error.message:String(error));}
  private menu(note:InboxNote,event:MouseEvent){
    const menu=new Menu();
    menu.addItem(item=>item.setTitle('Open in new tab').setIcon('file').onClick(()=>void this.open(note,true).catch(error=>this.report(error))));
    menu.addItem(item=>item.setTitle(note.pinned?'Unpin note':'Pin note').setIcon(note.pinned?'pin-off':'pin').onClick(()=>this.change(note,{kind:'pin',value:!note.pinned})));
    menu.addSeparator();
    if(note.section==='settled'||note.section==='snoozed')menu.addItem(item=>item.setTitle(note.section==='settled'?'Reopen note':'Wake note').setIcon('undo-2').onClick(()=>this.change(note,{kind:'regular'})));
    else {
      const busy=!!note.indicator.active||!!note.indicator.input;
      menu.addItem(item=>item.setTitle('Settle note').setIcon('check').setDisabled(busy).onClick(()=>this.change(note,{kind:'settled'})));
      for(const [label,delay] of [['Snooze for 1 hour',60*60_000],['Snooze until tomorrow',24*60*60_000],['Snooze for 1 week',7*24*60*60_000]] as const)menu.addItem(item=>item.setTitle(label).setIcon('alarm-clock').setDisabled(busy).onClick(()=>this.change(note,{kind:'snoozed',until:Date.now()+delay})));
    }
    menu.showAtMouseEvent(event);
  }
  private remove(explorer:Explorer){explorer.root.classList.remove('t3-note-inbox-mode');explorer.button.remove();explorer.panel.remove();}
  dispose(){this.stopped=true;if(this.wake)window.clearTimeout(this.wake);for(const explorer of this.explorers.values())this.remove(explorer);this.explorers.clear();}
}
