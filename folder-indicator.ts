import type {FolderLink} from './folder-link';

export const LINKED_FOLDER_BADGE_CLASS='send-to-t3-linked-folder-badge';
const PROJECT_NAME_CLASS='send-to-t3-linked-folder-project';
// T3 Code's T3Wordmark, rendered with the surrounding theme's text color.
const T3_WORDMARK_PATH='M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z';

/** Decorates exact linked folders without marking every descendant they route. */
export function decorateLinkedFolders(root:ParentNode,links:FolderLink[]):void{
  const linked=new Map(links.filter(link=>link.folderPath!=='/').map(link=>[link.folderPath,link]));
  for(const title of Array.from(root.querySelectorAll('.nav-folder-title[data-path]')) as HTMLElement[]){
    const link=linked.get(title.getAttribute('data-path')??'');
    let badge=title.querySelector('.'+LINKED_FOLDER_BADGE_CLASS) as HTMLElement|null;
    if(!link){badge?.remove();continue;}
    const doc=title.ownerDocument;
    if(!badge){
      badge=doc.createElement('span');badge.className=LINKED_FOLDER_BADGE_CLASS;
      badge.setAttribute('data-t3-linked-folder','true');title.appendChild(badge);
    }
    let name=badge.querySelector('.'+PROJECT_NAME_CLASS) as HTMLElement|null;
    if(!name){
      const logo=doc.createElementNS('http://www.w3.org/2000/svg','svg');
      logo.setAttribute('class','send-to-t3-linked-folder-logo');
      logo.setAttribute('viewBox','15.5309 37 94.3941 56.96');
      logo.setAttribute('aria-hidden','true');logo.setAttribute('focusable','false');
      const path=doc.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d',T3_WORDMARK_PATH);path.setAttribute('fill','currentColor');logo.appendChild(path);
      name=doc.createElement('span');name.className=PROJECT_NAME_CLASS;
      badge.replaceChildren(logo,name);
    }
    if(name.textContent!==link.projectTitle)name.textContent=link.projectTitle;
    const label=`Linked to T3 Code project: ${link.projectTitle}`;
    if(badge.title!==label)badge.title=label;
    if(badge.getAttribute('aria-label')!==label)badge.setAttribute('aria-label',label);
  }
}

export interface FolderIndicatorController {refresh():void;dispose():void}

export function installFolderIndicators(root:HTMLElement,getLinks:()=>FolderLink[]):FolderIndicatorController{
  let stopped=false,scheduled=false;
  const refresh=()=>{if(!stopped)decorateLinkedFolders(root,getLinks());};
  const schedule=()=>{if(stopped||scheduled)return;scheduled=true;Promise.resolve().then(()=>{scheduled=false;refresh();});};
  const observer=new MutationObserver(schedule);observer.observe(root,{childList:true,subtree:true});refresh();
  return {refresh,dispose(){stopped=true;observer.disconnect();for(const badge of Array.from(root.querySelectorAll('.'+LINKED_FOLDER_BADGE_CLASS)))badge.remove();}};
}
