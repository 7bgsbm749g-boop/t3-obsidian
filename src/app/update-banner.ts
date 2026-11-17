import {sanitizeHTMLToDom} from 'obsidian';
import {micromark} from 'micromark';
import {updateTitle,type UpdateState} from './plugin-updates';

/** A non-modal notification at the top of the main workspace. */
export class UpdateBanner {
  private element?:HTMLElement;
  constructor(private container:HTMLElement,private update:()=>void,private dismiss:()=>void){}
  render(state:UpdateState|null){
    this.element?.remove();this.element=undefined;if(!state)return;
    const doc=this.container.ownerDocument,element=doc.win.createDiv();element.className='t3-update-banner';element.setAttribute('role','region');element.setAttribute('aria-label','T3 Code update');
    const header=doc.win.createDiv();header.className='t3-update-banner-header';element.append(header);
    const title=doc.win.createEl('strong');title.className='t3-update-banner-title';title.textContent=updateTitle(state.release.version);header.append(title);
    const actions=doc.win.createDiv();actions.className='t3-update-banner-actions';header.append(actions);
    const update=doc.win.createEl('button');update.textContent=state.busy?'Updating…':'Update';update.className='mod-cta';update.disabled=state.busy;update.addEventListener('click',this.update);actions.append(update);
    const dismiss=doc.win.createEl('button');dismiss.textContent='Dismiss';dismiss.disabled=state.busy;dismiss.addEventListener('click',this.dismiss);actions.append(dismiss);
    const notes=doc.win.createDiv();notes.className='t3-update-banner-notes markdown-rendered';notes.setAttribute('role','region');notes.setAttribute('aria-label','Release notes');notes.tabIndex=0;
    if(state.release.body.trim()){
      // CommonMark escapes raw HTML and unsafe URLs. The host sanitizer adds
      // its native DOM rules without enabling vault embeds or post-processors.
      notes.append(sanitizeHTMLToDom(micromark(state.release.body)));
      for(const link of Array.from(notes.querySelectorAll('a'))){link.setAttribute('target','_blank');link.setAttribute('rel','noopener noreferrer');}
    }else notes.textContent='No release notes were provided for this release.';
    element.append(notes);
    if(state.message!==title.textContent){const status=doc.win.createDiv();status.className='t3-update-banner-message';status.setAttribute('role','status');status.textContent=state.message;element.append(status);}
    this.container.prepend(element);this.element=element;
  }
  dispose(){this.render(null);}
}
