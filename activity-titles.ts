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

/** Mobile Tab Bar owns separate labels. Its public leaf order keeps duplicate
 * names distinct; overview rows expose their exact file paths in the detail. */
export function decorateMobileActivityTabs(root:ParentNode,paths:Array<string|undefined>,current:number,wrap:boolean,notes:Map<string,NoteIndicator>):void {
  const adjacent=(offset:number)=>{
    if(current<0||current>=paths.length||offset!==0&&paths.length<2)return;
    const index=current+offset;
    return index>=0&&index<paths.length?paths[index]:wrap?paths[(index+paths.length)%paths.length]:undefined;
  };
  for(const [name,offset] of [['previous',-1],['current',0],['next',1]] as const){
    const path=adjacent(offset);
    for(const title of Array.from(root.querySelectorAll<HTMLElement>(`.mtb-title-${name}`)))setActiveTitle(title,!!path&&!!notes.get(path)?.active);
  }
  for(const row of Array.from(root.querySelectorAll<HTMLElement>('.mtb-tab-row'))){
    const path=/^\d+ · (.+)$/.exec(row.querySelector('.mtb-tab-detail')?.textContent??'')?.[1];
    setActiveTitle(row.querySelector('.mtb-tab-name'),!!path&&!!notes.get(path)?.active);
  }
}
