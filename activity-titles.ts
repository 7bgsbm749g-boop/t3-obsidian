import type {NoteIndicator} from './explorer-responses';

/** Fold active notes into their ancestor folders once per indicator refresh. */
export function activeResponseFolders(notes:Map<string,NoteIndicator>):Set<string> {
  const folders=new Set<string>();
  for(const [path,note] of notes)if(note.active){
    let at=path.lastIndexOf('/');
    while(at>0){folders.add(path.slice(0,at));at=path.lastIndexOf('/',at-1);}
  }
  return folders;
}
export function setActiveTitle(element:HTMLElement|null,active:boolean):void {
  if(!element)return;
  if(active){if(element.getAttribute('data-t3-active-title')!=='true')element.setAttribute('data-t3-active-title','true');}
  else if(element.hasAttribute('data-t3-active-title'))element.removeAttribute('data-t3-active-title');
}
export interface ActivityTab {path?:string;title:HTMLElement|null}
/** Bind by the leaf's file path, never its possibly duplicate display title. */
export function decorateActivityTabs(tabs:ActivityTab[],notes:Map<string,NoteIndicator>):void {
  for(const tab of tabs)setActiveTitle(tab.title,!!tab.path&&!!notes.get(tab.path)?.active);
}
