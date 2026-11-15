import {logFailure} from '../app/diagnostics';
import {type FolderLink} from './folder-link';
import {type NoteIndicator} from '../responses/explorer-responses';
import {activeResponseFolders,setActiveTitle} from '../ui/activity-titles';
import {unreadCompletionFolders} from '../responses/completion-glow';

export const LINKED_FOLDER_BADGE_CLASS='send-to-t3-linked-folder-badge';
export const NOTE_INDICATOR_CLASS='send-to-t3-note-indicator';
// Lucide link, matching Obsidian's Link to T3 Code menu icon.
const LINK_PATHS=['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71','M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'];

/** Decorates exact linked folders without marking every descendant they route. */
export function decorateLinkedFolders(root:ParentNode,links:FolderLink[]):void{
  const linked=new Map(links.filter(link=>link.folderPath!=='/').map(link=>[link.folderPath,link]));
  for(const title of Array.from(root.querySelectorAll<HTMLElement>('.nav-folder-title[data-path]'))){
    const link=linked.get(title.getAttribute('data-path')??'');
    let badge=title.querySelector<HTMLElement>('.'+LINKED_FOLDER_BADGE_CLASS);
    if(!link){badge?.remove();continue;}
    if(!badge){
      const doc=title.ownerDocument;
      badge=doc.win.createSpan();badge.className=LINKED_FOLDER_BADGE_CLASS;
      badge.setAttribute('data-t3-linked-folder','true');badge.setAttribute('role','img');
      const icon=doc.win.createSvg('svg');
      for(const [key,value] of Object.entries({class:'send-to-t3-linked-folder-logo',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))icon.setAttribute(key,value);
      for(const d of LINK_PATHS){const path=doc.win.createSvg('path');path.setAttribute('d',d);icon.appendChild(path);}
      badge.appendChild(icon);title.appendChild(badge);
    }
    const label=`Linked to T3 Code project: ${link.projectTitle}`;
    if(badge.title!==label)badge.title=label;
    if(badge.getAttribute('aria-label')!==label)badge.setAttribute('aria-label',label);
  }
}
export function decorateNoteIndicators(root:ParentNode,notes:Map<string,NoteIndicator>,folderNote:(title:HTMLElement)=>string|undefined=()=>undefined):void {
  const folders=activeResponseFolders(notes);
  const unreadFolders=unreadCompletionFolders(notes);
  for(const title of Array.from(root.querySelectorAll<HTMLElement>('.nav-file-title[data-path], .nav-folder-title[data-path]'))){
    const folder=title.classList.contains('nav-folder-title');
    const path=folder?folderNote(title):title.getAttribute('data-path')??'';
    const note=path?notes.get(path):undefined;
    const active=!!note?.active,input=!!note?.input;
    const unread=!!note?.unread,collapsed=folder&&title.parentElement?.classList.contains('is-collapsed');
    const glow=unread?'note':collapsed&&unreadFolders.has(title.getAttribute('data-path')??'')?'branch':undefined;
    if(glow){if(title.getAttribute('data-t3-completion-glow')!==glow)title.setAttribute('data-t3-completion-glow',glow);}
    else if(title.hasAttribute('data-t3-completion-glow'))title.removeAttribute('data-t3-completion-glow');
    setActiveTitle(title.querySelector<HTMLElement>(folder?'.nav-folder-title-content':'.nav-file-title-content'),active||folder&&folders.has(title.getAttribute('data-path')??''));
    let indicator=title.querySelector<HTMLElement>('.'+NOTE_INDICATOR_CLASS);
    if(!active&&!input){indicator?.remove();continue;}
    if(!indicator){indicator=title.ownerDocument.win.createSpan();indicator.className=NOTE_INDICATOR_CLASS;indicator.setAttribute('role','img');title.appendChild(indicator);}
    const mode=[active?'active':'',input?'input':''].filter(Boolean).join(' ');
    if(indicator.getAttribute('data-t3-state')!==mode){
      indicator.setAttribute('data-t3-state',mode);
      indicator.replaceChildren();
    }
    const label=[active?`${note.active} active T3 ${note.active===1?'response':'responses'}`:'',input?`${note.input} T3 ${note.input===1?'response needs':'responses need'} input`:''].filter(Boolean).join('; ');
    if(indicator.title!==label)indicator.title=label;
    if(indicator.getAttribute('aria-label')!==label)indicator.setAttribute('aria-label',label);
  }
}
export interface FolderIndicatorController {refresh():void;dispose():void}
export function installFolderIndicators(root:HTMLElement|(()=>Iterable<HTMLElement>),getLinks:()=>FolderLink[],getNotes:()=>Map<string,NoteIndicator>=()=>new Map(),folderNote:(title:HTMLElement)=>string|undefined=()=>undefined,decorateTabs:(notes:Map<string,NoteIndicator>)=>void=()=>{}):FolderIndicatorController{
  let stopped=false,scheduled=false;
  const observers=new Map<HTMLElement,MutationObserver>(),ownedRoots=new Set<HTMLElement>();
  const roots=()=>typeof root==='function'?Array.from(root()):[root];
  const clearRoot=(element:HTMLElement)=>{
    for(const title of Array.from(element.querySelectorAll<HTMLElement>('[data-t3-completion-glow]')))title.removeAttribute('data-t3-completion-glow');
    for(const title of Array.from(element.querySelectorAll<HTMLElement>('.nav-file-title-content[data-t3-active-title], .nav-folder-title-content[data-t3-active-title]')))setActiveTitle(title,false);
    for(const badge of Array.from(element.querySelectorAll('.'+LINKED_FOLDER_BADGE_CLASS+', .'+NOTE_INDICATOR_CLASS)))badge.remove();
  };
  const schedule=()=>{if(stopped||scheduled)return;scheduled=true;void Promise.resolve().then(()=>{scheduled=false;refresh();}).catch(error=>{scheduled=false;logFailure('folder.indicators.refresh.failed',error);});};
  const refresh=()=>{
    if(stopped)return;
    const currentRoots=new Set(roots()),notes=getNotes();
    for(const previous of ownedRoots)if(!currentRoots.has(previous)){clearRoot(previous);ownedRoots.delete(previous);}
    for(const current of currentRoots)ownedRoots.add(current);
    const explorers=new Set(Array.from(currentRoots).flatMap(current=>Array.from(current.querySelectorAll<HTMLElement>('.nav-files-container'))));
    decorateTabs(notes);
    for(const [explorer,observer] of observers)if(!explorers.has(explorer)){observer.disconnect();observers.delete(explorer);}
    for(const explorer of explorers){
      if(!observers.has(explorer)){
        const observer=new MutationObserver(schedule);observer.observe(explorer,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-path']});observers.set(explorer,observer);
      }
      decorateLinkedFolders(explorer,getLinks());decorateNoteIndicators(explorer,notes,folderNote);
    }
  };
  refresh();
  return {refresh,dispose(){stopped=true;decorateTabs(new Map());for(const observer of observers.values())observer.disconnect();observers.clear();for(const current of ownedRoots)clearRoot(current);ownedRoots.clear();}};
}
