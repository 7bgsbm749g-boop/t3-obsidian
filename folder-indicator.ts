import {type FolderLink} from './folder-link';
import {type NoteIndicator} from './explorer-responses';

export const LINKED_FOLDER_BADGE_CLASS='send-to-t3-linked-folder-badge';
export const NOTE_INDICATOR_CLASS='send-to-t3-note-indicator';
// Lucide link, matching Obsidian's Link to T3 Code menu icon.
const LINK_PATHS=['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71','M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'];

/** Decorates exact linked folders without marking every descendant they route. */
export function decorateLinkedFolders(root:ParentNode,links:FolderLink[]):void{
  const linked=new Map(links.filter(link=>link.folderPath!=='/').map(link=>[link.folderPath,link]));
  for(const title of Array.from(root.querySelectorAll('.nav-folder-title[data-path]')) as HTMLElement[]){
    const link=linked.get(title.getAttribute('data-path')??'');
    let badge=title.querySelector('.'+LINKED_FOLDER_BADGE_CLASS) as HTMLElement|null;
    if(!link){badge?.remove();continue;}
    if(!badge){
      const doc=title.ownerDocument;
      badge=doc.createElement('span');badge.className=LINKED_FOLDER_BADGE_CLASS;
      badge.setAttribute('data-t3-linked-folder','true');badge.setAttribute('role','img');
      const icon=doc.createElementNS('http://www.w3.org/2000/svg','svg');
      for(const [key,value] of Object.entries({class:'send-to-t3-linked-folder-logo',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))icon.setAttribute(key,value);
      for(const d of LINK_PATHS){const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);icon.appendChild(path);}
      badge.appendChild(icon);title.appendChild(badge);
    }
    const label=`Linked to T3 Code project: ${link.projectTitle}`;
    if(badge.title!==label)badge.title=label;
    if(badge.getAttribute('aria-label')!==label)badge.setAttribute('aria-label',label);
  }
}
export function decorateNoteIndicators(root:ParentNode,notes:Map<string,NoteIndicator>,folderNote:(title:HTMLElement)=>string|undefined=()=>undefined):void {
  for(const title of Array.from(root.querySelectorAll('.nav-file-title[data-path], .nav-folder-title[data-path]')) as HTMLElement[]){
    const path=title.classList.contains('nav-folder-title')?folderNote(title):title.getAttribute('data-path')??'';
    const note=path?notes.get(path):undefined;
    const active=!!note?.active,input=!!note?.input,complete=!!note&&note.complete===note.total&&!active&&!input;
    let indicator=title.querySelector('.'+NOTE_INDICATOR_CLASS) as HTMLElement|null;
    if(!active&&!input&&!complete){indicator?.remove();continue;}
    if(!indicator){indicator=title.ownerDocument.createElement('span');indicator.className=NOTE_INDICATOR_CLASS;indicator.setAttribute('role','img');title.appendChild(indicator);}
    const mode=[active?'active':'',input?'input':complete?'complete':''].filter(Boolean).join(' ');
    if(indicator.getAttribute('data-t3-state')!==mode){
      indicator.setAttribute('data-t3-state',mode);
      const children:HTMLElement[]=[];
      for(const state of mode.split(' ')){const dot=title.ownerDocument.createElement('span');dot.className=`send-to-t3-note-${state}`;dot.setAttribute('aria-hidden','true');children.push(dot);}
      indicator.replaceChildren(...children);
    }
    const label=[active?`${note!.active} active T3 ${note!.active===1?'response':'responses'}`:'',input?`${note!.input} T3 ${note!.input===1?'response needs':'responses need'} input`:complete?`${note!.complete} completed T3 ${note!.complete===1?'response':'responses'}`:''].filter(Boolean).join('; ');
    if(indicator.title!==label)indicator.title=label;
    if(indicator.getAttribute('aria-label')!==label)indicator.setAttribute('aria-label',label);
  }
}
export interface FolderIndicatorController {refresh():void;dispose():void}
export function installFolderIndicators(root:HTMLElement,getLinks:()=>FolderLink[],getNotes:()=>Map<string,NoteIndicator>=()=>new Map(),folderNote:(title:HTMLElement)=>string|undefined=()=>undefined):FolderIndicatorController{
  let stopped=false,scheduled=false;
  const observers=new Map<HTMLElement,MutationObserver>();
  const schedule=()=>{if(stopped||scheduled)return;scheduled=true;Promise.resolve().then(()=>{scheduled=false;refresh();});};
  const refresh=()=>{
    if(stopped)return;
    const explorers=new Set(Array.from(root.querySelectorAll('.nav-files-container')) as HTMLElement[]),notes=getNotes();
    for(const [explorer,observer] of observers)if(!explorers.has(explorer)){observer.disconnect();observers.delete(explorer);}
    for(const explorer of explorers){
      if(!observers.has(explorer)){
        const observer=new MutationObserver(schedule);observer.observe(explorer,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-path']});observers.set(explorer,observer);
      }
      decorateLinkedFolders(explorer,getLinks());decorateNoteIndicators(explorer,notes,folderNote);
    }
  };
  refresh();
  return {refresh,dispose(){stopped=true;for(const observer of observers.values())observer.disconnect();observers.clear();for(const badge of Array.from(root.querySelectorAll('.'+LINKED_FOLDER_BADGE_CLASS+', .'+NOTE_INDICATOR_CLASS)))badge.remove();}};
}
